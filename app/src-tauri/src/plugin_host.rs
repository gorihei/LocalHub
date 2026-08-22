// サイドカー実行ファイルを子プロセスとして起動し、標準入出力上の簡易
// JSON-RPCでやり取りする。Phase 0でIPC・障害分離を検証し、Phase 2で
// マニフェスト・ライフサイクル状態(FR-PLUG-002)を組み込んだ。
//
// 複数プラグイン対応(FR-PLUG-003「ローカルパッケージから導入」): プラグインは
// IDをキーにしたマップで管理する。検出元は2種類:
//   1. 開発用サンプルプラグイン(リポジトリ同梱、常に検出する)
//   2. インストール済みプラグイン(<app_data_dir>/plugins/<id>/manifest.json)
// 「導入」は、指定フォルダのmanifest.jsonを検証してから(2)へコピーするだけの
// シンプルな実装(FR-PLUG-003のMVP範囲)。

use crate::manifest::PluginManifest;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{http, AppHandle, Emitter, Manager, State};

type PendingMap = Arc<Mutex<HashMap<u64, tokio::sync::oneshot::Sender<serde_json::Value>>>>;

#[derive(Serialize)]
struct RpcRequest {
    id: u64,
    method: String,
    params: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    context: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct RpcResponse {
    id: u64,
    #[serde(default)]
    result: Option<serde_json::Value>,
    #[serde(default)]
    error: Option<String>,
}

/// FR-PLUG-002 プラグインのライフサイクル状態。
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PluginState {
    Installed,
    #[allow(dead_code)] // 無効化操作はPhase 2の範囲外だが状態としては用意しておく
    Disabled,
    Starting,
    Running,
    #[allow(dead_code)] // 権限不足等での「一部制限」状態。実際の検知はPhase 2以降で使う。
    Degraded,
    Failed,
    #[allow(dead_code)]
    Updating,
}

struct PluginProcess {
    /// 世代番号。再起動で新しいプロセスに置き換わった後、古いプロセスの
    /// 終了監視スレッドが状態を誤って上書きしないようにするための識別子。
    generation: u64,
    stdin: std::process::ChildStdin,
    pending: PendingMap,
    next_id: AtomicU64,
    /// 直近の標準エラー出力(FR-PLUG-003: ログと直近エラーの表示)。
    recent_stderr: Arc<Mutex<VecDeque<String>>>,
}

/// 1プラグイン分の実行時状態。マニフェスト自体はインストール後は不変
/// (更新は再インストール扱い)なので所有権をそのまま持つ。
pub struct PluginEntry {
    pub manifest: PluginManifest,
    /// マニフェストが置かれているディレクトリ。entry(実行ファイル)の
    /// 相対パス解決や、アンインストール時の削除対象になる。
    pub dir: PathBuf,
    state: Mutex<PluginState>,
    process: Mutex<Option<PluginProcess>>,
    next_generation: AtomicU64,
    /// クラッシュループ検知(将来の拡張として残していたものを実装)。
    /// 直近の起動時刻と、CRASH_LOOP_WINDOWよりも短い間隔で連続クラッシュした
    /// 回数を覚えておく。CRASH_LOOP_THRESHOLD回に達したらDisabledへ落とし、
    /// 手動でplugin_reenableを呼ぶまでplugin_startを拒否する。
    last_start_at: Mutex<Option<std::time::Instant>>,
    crash_streak: AtomicU64,
}

/// この秒数以内の再クラッシュを「連続」とみなす。
const CRASH_LOOP_WINDOW_SECS: u64 = 15;
/// 連続クラッシュがこの回数に達したら自動的に無効化する。
const CRASH_LOOP_THRESHOLD: u64 = 3;

impl PluginEntry {
    fn new(manifest: PluginManifest, dir: PathBuf) -> Self {
        Self {
            manifest,
            dir,
            state: Mutex::new(PluginState::Installed),
            process: Mutex::new(None),
            next_generation: AtomicU64::new(1),
            last_start_at: Mutex::new(None),
            crash_streak: AtomicU64::new(0),
        }
    }

    pub fn snapshot_state(&self) -> PluginState {
        *self.state.lock().unwrap()
    }

    fn set_state(&self, s: PluginState) {
        *self.state.lock().unwrap() = s;
    }

    fn sidecar_path(&self) -> PathBuf {
        self.dir.join(&self.manifest.entry)
    }

    /// クラッシュ検知時に呼ぶ。連続クラッシュならtrueを返し、閾値に達していれば
    /// 呼び出し側でDisabledへ遷移させる。
    fn record_crash(&self) -> u64 {
        let now = std::time::Instant::now();
        let mut last = self.last_start_at.lock().unwrap();
        let is_rapid = last.is_some_and(|t| now.duration_since(t).as_secs() < CRASH_LOOP_WINDOW_SECS);
        *last = None;
        if is_rapid {
            self.crash_streak.fetch_add(1, Ordering::SeqCst) + 1
        } else {
            self.crash_streak.store(1, Ordering::SeqCst);
            1
        }
    }
}

/// 全プラグインを束ねるTauri管理状態。
pub struct PluginHostState {
    pub plugins: Mutex<HashMap<String, Arc<PluginEntry>>>,
    /// インストール済みプラグインの保存先ルート(<app_data_dir>/plugins)。
    pub plugins_dir: PathBuf,
}

impl PluginHostState {
    fn entry(&self, id: &str) -> Result<Arc<PluginEntry>, String> {
        self.plugins.lock().unwrap().get(id).cloned().ok_or_else(|| format!("プラグインが見つかりません: {id}"))
    }
}

/// FR-PLUG-001: 起動時にプラグインを検出する。<app_data_dir>/plugins/*/manifest.json
/// をすべて走査する(以前はリポジトリ同梱の開発用サンプルプラグインもデバッグビルド限定で
/// 常に検出していたが、サンプル一式を削除したためこの特別扱いも撤去した)。
pub fn discover_all(plugins_dir: &Path) -> HashMap<String, Arc<PluginEntry>> {
    let mut map = HashMap::new();

    if let Ok(read_dir) = std::fs::read_dir(plugins_dir) {
        for entry in read_dir.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let manifest_path = dir.join("manifest.json");
            match crate::manifest::load(&manifest_path) {
                Ok(manifest) => {
                    map.entry(manifest.id.clone()).or_insert_with(|| Arc::new(PluginEntry::new(manifest, dir)));
                }
                Err(e) => {
                    tracing::warn!(target: "plugin", path = %manifest_path.display(), error = %e, "プラグインの検出に失敗しました(スキップ)");
                }
            }
        }
    }

    map
}

#[derive(Serialize)]
pub struct PluginStatusInfo {
    manifest: PluginManifest,
    state: PluginState,
}

#[tauri::command]
pub fn plugin_status(state: State<PluginHostState>, id: String) -> Result<PluginStatusInfo, String> {
    let entry = state.entry(&id)?;
    Ok(PluginStatusInfo { manifest: entry.manifest.clone(), state: entry.snapshot_state() })
}

/// §6.1付録B: 全プラグインのcontributes.widgetsをまとめて返す。
/// フロント側はこれをダッシュボードのウィジェットカタログへマージし、
/// 汎用の「コマンドを定期的に呼んで結果を表示する」カードとして描画する。
#[derive(Serialize)]
pub struct PluginWidgetInfo {
    #[serde(rename = "pluginId")]
    pub plugin_id: String,
    pub id: String,
    pub title: String,
    pub command: String,
    #[serde(rename = "refreshMs")]
    pub refresh_ms: u64,
}

#[tauri::command]
pub fn plugin_widgets_list(state: State<PluginHostState>) -> Vec<PluginWidgetInfo> {
    let plugins = state.plugins.lock().unwrap();
    plugins
        .values()
        .flat_map(|entry| {
            entry.manifest.contributes.widgets.iter().map(|w| PluginWidgetInfo {
                plugin_id: entry.manifest.id.clone(),
                id: w.id.clone(),
                title: w.title.clone(),
                command: w.command.clone(),
                refresh_ms: w.refresh_ms,
            })
        })
        .collect()
}

/// §10「プラグインWebView埋め込み」: 全プラグインのcontributes.pagesをまとめて
/// 返す。ダッシュボードのウィジェットカタログにもこの一覧をマージすることで、
/// プラグイン自身が書いたページをそのままウィジェットカードとしても配置できる
/// (プラグイン画面の専用パネルに限定していた実装をやめ、埋め込み場所を選べるように
/// した)。
#[derive(Serialize)]
pub struct PluginPageInfo {
    #[serde(rename = "pluginId")]
    pub plugin_id: String,
    pub id: String,
    pub title: String,
    pub entry: String,
}

#[tauri::command]
pub fn plugin_pages_list(state: State<PluginHostState>) -> Vec<PluginPageInfo> {
    let plugins = state.plugins.lock().unwrap();
    plugins
        .values()
        .flat_map(|entry| {
            entry.manifest.contributes.pages.iter().map(|p| PluginPageInfo {
                plugin_id: entry.manifest.id.clone(),
                id: p.id.clone(),
                title: p.title.clone(),
                entry: p.entry.clone(),
            })
        })
        .collect()
}

/// クラッシュループにより自動無効化(Disabled)されたプラグインを、
/// 手動操作で再度起動可能な状態に戻す。
#[tauri::command]
pub fn plugin_reenable(state: State<PluginHostState>, id: String) -> Result<(), String> {
    let entry = state.entry(&id)?;
    entry.crash_streak.store(0, Ordering::SeqCst);
    entry.set_state(PluginState::Installed);
    Ok(())
}

/// §6.6 横断検索 FR-SEARCH-001: 全プラグインのcontributes.searchProvidersを
/// まとめて返す。フロント側は各コマンドへ{query}を渡して結果を横断検索に
/// マージする。
#[derive(Serialize)]
pub struct SearchProviderInfo {
    #[serde(rename = "pluginId")]
    pub plugin_id: String,
    pub id: String,
    pub title: String,
    pub command: String,
}

#[tauri::command]
pub fn plugin_search_providers_list(state: State<PluginHostState>) -> Vec<SearchProviderInfo> {
    let plugins = state.plugins.lock().unwrap();
    plugins
        .values()
        .flat_map(|entry| {
            entry.manifest.contributes.search_providers.iter().map(|p| SearchProviderInfo {
                plugin_id: entry.manifest.id.clone(),
                id: p.id.clone(),
                title: p.title.clone(),
                command: p.command.clone(),
            })
        })
        .collect()
}

#[tauri::command]
pub fn plugin_list(state: State<PluginHostState>) -> Vec<PluginStatusInfo> {
    let plugins = state.plugins.lock().unwrap();
    let mut list: Vec<PluginStatusInfo> =
        plugins.values().map(|e| PluginStatusInfo { manifest: e.manifest.clone(), state: e.snapshot_state() }).collect();
    list.sort_by(|a, b| a.manifest.name.cmp(&b.manifest.name));
    list
}

/// §13.3/AC-11 セーフモード: trueの間はplugin_start(=plugin_restartも内部で
/// 経由する)を拒否し、プラグインを一切起動させない。連続クラッシュの原因が
/// プラグイン側にある場合でも、コアだけは確実に使える状態を保つのが狙い。
pub struct SafeModeState(pub bool);

#[tauri::command]
pub fn app_safe_mode_active(state: State<SafeModeState>) -> bool {
    state.0
}

/// FR-PLUG-003「ローカルパッケージから導入」。指定フォルダにmanifest.jsonが
/// あることを検証してから<app_data_dir>/plugins/<id>/へコピーし、実行中の
/// マップにも即座に登録する(再起動不要)。
#[tauri::command]
pub fn plugins_install(app: AppHandle, state: State<PluginHostState>, src_dir: String) -> Result<PluginStatusInfo, String> {
    let src = PathBuf::from(&src_dir);
    let manifest_path = src.join("manifest.json");
    let manifest = crate::manifest::load(&manifest_path)?;

    {
        let plugins = state.plugins.lock().unwrap();
        if plugins.contains_key(&manifest.id) {
            return Err(format!("同じID(\"{}\")のプラグインが既に導入されています", manifest.id));
        }
    }

    let entry_src = src.join(&manifest.entry);
    if !entry_src.exists() {
        return Err(format!("マニフェストのentryで指定された実行ファイルが見つかりません: {}", entry_src.display()));
    }

    let dest = state.plugins_dir.join(&manifest.id);
    copy_dir_recursive(&src, &dest).map_err(|e| format!("プラグインのコピーに失敗しました: {e}"))?;

    let plugin_entry = Arc::new(PluginEntry::new(manifest, dest));
    let status = PluginStatusInfo { manifest: plugin_entry.manifest.clone(), state: plugin_entry.snapshot_state() };
    let plugin_id = plugin_entry.manifest.id.clone();
    crate::command_bus::register_plugin_commands(
        &app.state::<crate::command_bus::CommandBus>(),
        &plugin_id,
        &plugin_entry.manifest.contributes.commands,
    );
    state.plugins.lock().unwrap().insert(plugin_id, plugin_entry);
    Ok(status)
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let dest_path = dest.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else {
            std::fs::copy(entry.path(), &dest_path)?;
        }
    }
    Ok(())
}

/// プラグインを停止した上でインストールディレクトリごと削除する。
/// 開発用サンプルプラグイン(リポジトリ内)はplugins_dir配下ではないため
/// アンインストール対象にできないようにガードする。
#[tauri::command]
pub fn plugins_uninstall(app: AppHandle, state: State<PluginHostState>, id: String) -> Result<(), String> {
    let entry = state.entry(&id)?;
    if !entry.dir.starts_with(&state.plugins_dir) {
        return Err("このプラグインは開発用サンプルのためアンインストールできません".to_string());
    }
    // ディレクトリとPluginEntryを削除した後では設定宣言を参照できないため、
    // アンインストール対象が宣言したsecret IDを先に控えておく。
    let secret_setting_ids: Vec<String> = entry
        .manifest
        .contributes
        .settings
        .iter()
        .filter(|setting| setting.setting_type == "secret")
        .map(|setting| setting.id.clone())
        .collect();
    *entry.process.lock().unwrap() = None; // 起動中でも強制的に手を離す(監視スレッドは世代不一致で自然に無害化する)
    std::fs::remove_dir_all(&entry.dir).map_err(|e| format!("削除に失敗しました: {e}"))?;
    state.plugins.lock().unwrap().remove(&id);
    app.state::<crate::command_bus::CommandBus>().unregister_plugin(&id);
    {
        let db = app.state::<crate::storage::DbState>();
        let mut conn = db.0.lock().unwrap();
        crate::storage::plugin_data_delete_all(&mut conn, &id)?;
    }
    for setting_id in secret_setting_ids {
        crate::storage::plugin_secret_delete_internal(&id, &setting_id)?;
    }
    Ok(())
}

#[tauri::command]
pub fn plugin_start(app: AppHandle, state: State<PluginHostState>, id: String) -> Result<(), String> {
    if app.state::<SafeModeState>().0 {
        return Err("セーフモードで起動しているため、プラグインは無効化されています。アプリを正常終了してから再起動すると解除されます。".to_string());
    }
    let entry = state.entry(&id)?;
    if entry.snapshot_state() == PluginState::Disabled {
        return Err("クラッシュが連続したため無効化されています。プラグイン画面の「有効化」から再試行してください。".to_string());
    }
    let mut guard = entry.process.lock().unwrap();
    if guard.is_some() {
        return Err("プラグインは既に起動しています".to_string());
    }
    entry.set_state(PluginState::Starting);
    *entry.last_start_at.lock().unwrap() = Some(std::time::Instant::now());

    let path = entry.sidecar_path();
    if !path.exists() {
        entry.set_state(PluginState::Failed);
        return Err(format!("サイドカー実行ファイルが見つかりません: {}", path.display()));
    }

    let mut child: Child = match Command::new(&path).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
        Ok(c) => c,
        Err(e) => {
            entry.set_state(PluginState::Failed);
            return Err(format!("サイドカーの起動に失敗しました: {e}"));
        }
    };

    let stdin = child.stdin.take().expect("stdinをpipeで確保したはず");
    let stdout = child.stdout.take().expect("stdoutをpipeで確保したはず");
    let stderr = child.stderr.take().expect("stderrをpipeで確保したはず");

    let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
    let recent_stderr = Arc::new(Mutex::new(VecDeque::with_capacity(50)));
    let generation = entry.next_generation.fetch_add(1, Ordering::SeqCst);

    // stdout読み取りスレッド: 応答をidで突き合わせ、待機中のoneshotへ渡す。
    {
        let pending = pending.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if line.trim().is_empty() {
                    continue;
                }
                let Ok(resp) = serde_json::from_str::<RpcResponse>(&line) else {
                    continue;
                };
                if let Some(tx) = pending.lock().unwrap().remove(&resp.id) {
                    let value = resp.result.unwrap_or_else(|| serde_json::json!({ "error": resp.error.unwrap_or_default() }));
                    let _ = tx.send(value);
                }
            }
        });
    }

    // stderr読み取りスレッド: 直近50行をリングバッファに保持しておく。
    {
        let recent_stderr = recent_stderr.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines() {
                let Ok(line) = line else { break };
                let mut buf = recent_stderr.lock().unwrap();
                if buf.len() >= 50 {
                    buf.pop_front();
                }
                buf.push_back(line);
            }
        });
    }

    // プロセス終了監視スレッド: クラッシュしてもホストUIは継続させ、
    // イベントで通知した上でstateを空にして再起動可能な状態に戻す。
    // 世代番号が現在保持中のプロセスと一致する場合のみ状態を更新することで、
    // 再起動によって置き換わった後の古いプロセスの終了検知が新しい状態を
    // 誤って上書きしないようにしている。
    {
        let app = app.clone();
        let entry = entry.clone();
        let plugin_name = entry.manifest.name.clone();
        let plugin_id = id.clone();
        std::thread::spawn(move || {
            let wait_result = child.wait();

            let is_current = {
                let mut proc_guard = entry.process.lock().unwrap();
                let is_current = proc_guard.as_ref().is_some_and(|p| p.generation == generation);
                if is_current {
                    *proc_guard = None;
                }
                is_current
            };
            if !is_current {
                return;
            }

            match wait_result {
                Ok(status) => {
                    if status.success() {
                        tracing::info!(target: "plugin", %plugin_id, "正常終了しました");
                        entry.set_state(PluginState::Installed);
                    } else {
                        tracing::error!(target: "plugin", %plugin_id, code = ?status.code(), "異常終了(クラッシュ)しました");
                        let streak = entry.record_crash();
                        if streak >= CRASH_LOOP_THRESHOLD {
                            entry.set_state(PluginState::Disabled);
                            crate::notifications::push(
                                &app,
                                "error",
                                "プラグインを自動的に無効化しました",
                                &format!("{plugin_name} — 短時間に{streak}回連続でクラッシュしたため無効化しました。プラグイン画面から「有効化」できます。"),
                            );
                        } else {
                            entry.set_state(PluginState::Failed);
                            crate::notifications::push(&app, "error", "プラグインがクラッシュしました", &format!("{plugin_name} — ホストアプリは継続して動作しています"));
                        }
                    }
                    let _ = app.emit("plugin://exited", serde_json::json!({ "id": plugin_id, "success": status.success(), "code": status.code() }));
                }
                Err(e) => {
                    tracing::error!(target: "plugin", %plugin_id, error = %e, "プロセス監視に失敗しました");
                    entry.set_state(PluginState::Failed);
                    let _ = app.emit("plugin://exited", serde_json::json!({ "id": plugin_id, "success": false, "error": e.to_string() }));
                }
            }
        });
    }

    *guard = Some(PluginProcess { generation, stdin, pending, next_id: AtomicU64::new(1), recent_stderr });
    drop(guard);
    entry.set_state(PluginState::Running);

    Ok(())
}

/// コマンドバス(§12.4)やTauriコマンドの両方から呼べる共通の実装。
pub async fn call_method(app: &AppHandle, id: String, method: String, params: serde_json::Value) -> Result<serde_json::Value, String> {
    let state = app.state::<PluginHostState>();
    let entry = state.entry(&id)?;
    let method_name = method.clone();
    let (req_id, rx) = {
        let mut guard = entry.process.lock().unwrap();
        let proc = guard.as_mut().ok_or("プラグインが起動していません")?;

        let req_id = proc.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = tokio::sync::oneshot::channel();
        proc.pending.lock().unwrap().insert(req_id, tx);

        // マニフェストでsecretとして宣言された値だけを、通常paramsとは分離した
        // ホスト管理contextへ入れる。値は永続化せず、このRPCの間だけ保持する。
        let secrets: serde_json::Map<String, serde_json::Value> = entry
            .manifest
            .contributes
            .settings
            .iter()
            .filter(|setting| setting.setting_type == "secret")
            .filter_map(|setting| {
                crate::storage::plugin_secret_get_internal(&id, &setting.id)
                    .ok()
                    .flatten()
                    .map(|value| (setting.id.clone(), serde_json::Value::String(value)))
            })
            .collect();
        let context = if secrets.is_empty() { None } else { Some(serde_json::json!({ "secrets": secrets })) };
        let req = RpcRequest { id: req_id, method, params, context };
        let line = serde_json::to_string(&req).map_err(|e| e.to_string())?;
        proc.stdin
            .write_all(line.as_bytes())
            .and_then(|_| proc.stdin.write_all(b"\n"))
            .and_then(|_| proc.stdin.flush())
            .map_err(|e| format!("プラグインへの送信に失敗しました: {e}"))?;

        (req_id, rx)
    };

    // §12.3: IPCメッセージにはタイムアウトを持たせる。
    match tokio::time::timeout(std::time::Duration::from_secs(5), rx).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(_)) => Err("プラグインとの接続が切断されました".to_string()),
        Err(_) => {
            if let Some(proc) = entry.process.lock().unwrap().as_ref() {
                proc.pending.lock().unwrap().remove(&req_id);
            }
            tracing::warn!(target: "plugin", %method_name, "プラグイン呼び出しがタイムアウトしました");
            Err("プラグインの応答がタイムアウトしました(5秒)".to_string())
        }
    }
}

#[tauri::command]
pub async fn plugin_call(app: AppHandle, id: String, method: String, params: serde_json::Value) -> Result<serde_json::Value, String> {
    call_method(&app, id, method, params).await
}

#[tauri::command]
pub fn plugin_restart(app: AppHandle, state: State<PluginHostState>, id: String) -> Result<(), String> {
    // stdinを破棄することでプラグイン側にEOFを伝え、正常終了を促す。
    // (旧プロセスの終了検知・state掃除自体は監視スレッドが世代番号を見て行う。)
    let entry = state.entry(&id)?;
    *entry.process.lock().unwrap() = None;
    plugin_start(app, state, id)
}

#[tauri::command]
pub fn plugin_recent_logs(state: State<PluginHostState>, id: String) -> Result<Vec<String>, String> {
    let entry = state.entry(&id)?;
    let guard = entry.process.lock().unwrap();
    Ok(match guard.as_ref() {
        Some(proc) => proc.recent_stderr.lock().unwrap().iter().cloned().collect(),
        None => Vec::new(),
    })
}

/// プラグインが自前で書いたUIをコアに埋め込むための仕組み(§10「プラグインWebView
/// 埋め込み」)。従来はプラグインが提供できるのはmanifest.jsonの宣言(commands/
/// widgets/searchProviders)だけで、実際の画面はすべてコア側が個別にReactコードを
/// ハードコードして用意する必要があった(スケールしない・ユーザー未確認で実装した
/// 反省点)。この関数はTauriのカスタムURIスキーム`plugin-ui://`のハンドラで、URLの
/// 形式は`plugin-ui://<ホスト依存プレフィックス>/<プラグインid>/<相対パス>`。
/// 例: Windowsでは`http://plugin-ui.localhost/com.gorihei.todo-plugin/ui/index.html`。
///
/// フロント側(PluginPageFrame.tsx)はこのURLを<iframe sandbox="allow-scripts">に
/// 読み込む。iframe内のJSはコアのTauri APIへ直接アクセスできず、window.postMessageで
/// 送った{type:"localhub:call", commandId, params}だけがホストのReactコードで
/// コマンドバス経由(=権限ブローカーの対象)で実行される設計になっている
/// (bridge_js()が注入するランタイムを参照)。
///
/// セキュリティ上の注意点:
///   - 宣言(contributes.pages)されたentryの「親フォルダ」配下のファイルしか配信しない
///     (`..`によるパストラバーサルはcanonicalize()した上でプラグインディレクトリ配下か
///     二重にチェックしている)
///   - 存在しないプラグインid/未宣言パスは404
pub fn plugin_ui_protocol_handler(
    ctx: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: http::Request<Vec<u8>>,
) -> http::Response<Vec<u8>> {
    let raw_path = request.uri().path();
    let path = raw_path.trim_start_matches('/');

    if path == "__bridge.js" {
        return http::Response::builder()
            .header("Content-Type", "text/javascript; charset=utf-8")
            .body(bridge_js().into_bytes())
            .unwrap_or_else(|_| http::Response::new(Vec::new()));
    }

    let mut segments = path.splitn(2, '/');
    let (Some(plugin_id), Some(rel_path)) = (segments.next(), segments.next()) else {
        return not_found();
    };

    let state = ctx.app_handle().state::<PluginHostState>();
    let plugins = state.plugins.lock().unwrap();
    let Some(entry) = plugins.get(plugin_id) else {
        return not_found();
    };

    // 宣言済みページのentryの「親フォルダ」配下のみ配信対象にする
    // (プラグインディレクトリ内の任意ファイル—例えば他プラグインのデータや
    // ソースコード—が無条件に読めてしまわないようにするため)。
    let allowed = entry.manifest.contributes.pages.iter().any(|p| {
        let entry_dir = Path::new(&p.entry).parent().unwrap_or_else(|| Path::new(""));
        Path::new(rel_path).starts_with(entry_dir)
    });
    if !allowed {
        return not_found();
    }

    let Ok(plugin_dir_canonical) = entry.dir.canonicalize() else {
        return not_found();
    };
    let requested = entry.dir.join(rel_path);
    let Ok(requested_canonical) = requested.canonicalize() else {
        return not_found();
    };
    if !requested_canonical.starts_with(&plugin_dir_canonical) {
        return not_found();
    }

    match std::fs::read(&requested_canonical) {
        Ok(data) => http::Response::builder()
            .header("Content-Type", guess_mime(&requested_canonical))
            .body(data)
            .unwrap_or_else(|_| http::Response::new(Vec::new())),
        Err(_) => not_found(),
    }
}

fn not_found() -> http::Response<Vec<u8>> {
    http::Response::builder().status(http::StatusCode::NOT_FOUND).body(Vec::new()).unwrap_or_else(|_| http::Response::new(Vec::new()))
}

fn guess_mime(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase().as_str() {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

/// 各プラグインページに共通で注入するランタイム(コアが配信、プラグイン側は書かない)。
///
/// 提供するもの:
///   1. window.localhub.call(commandId, params) — window.parentへpostMessageし、
///      コアのPluginPageFrame.tsxがコマンドバス(executeCommand)経由で実行して結果を
///      送り返す。commandIdはプラグイン自身から見た短いid(manifest.contributes.
///      commandsのid、例:"todo.add")で、フルのコマンドバスid("plugin.<pluginId>.
///      todo.add")への変換はコア側が行うため、プラグインのUIコードは自分の
///      プラグインidを意識しなくてよい。
///   2. テーマ同期 — ホストのCSS変数(--bg/--accent等、theme.css参照)を
///      PluginPageFrame.tsxがpostMessageで送ってくるので、それを自分の
///      documentElementに反映する。プラグインは自分のCSSで`var(--accent)`等を
///      使うだけでホストのアクセントカラー変更(設定画面)に自動追従する。
///   3. 最低限のベーススタイル — プラグイン側が何もCSSを書かなくてもホストの
///      配色にある程度馴染むよう、body/button/inputの既定スタイルを<head>の
///      先頭に挿入しておく(プラグイン自身の<style>は後から解析されるため、
///      同じ詳細度でも自然にこちらが上書きできる=プラグイン側でカスタマイズしたい
///      箇所だけ書けばよい)。
///
/// これらはPhase 2で「プラグインを追加するたびに専用パネルをホスト側へ
/// ハードコードしていて見た目もバラバラ」という問題への対応として追加した。
fn bridge_js() -> String {
    r#"(function () {
  var pending = {};
  var nextId = 1;
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data) return;
    if (data.type === "localhub:result") {
      var p = pending[data.requestId];
      if (!p) return;
      delete pending[data.requestId];
      if (data.error) p.reject(new Error(data.error));
      else p.resolve(data.result);
      return;
    }
    if (data.type === "localhub:theme" && data.vars) {
      var root = document.documentElement.style;
      for (var name in data.vars) {
        root.setProperty(name, data.vars[name]);
      }
    }
  });
  window.localhub = {
    call: function (commandId, params) {
      return new Promise(function (resolve, reject) {
        var requestId = nextId++;
        pending[requestId] = { resolve: resolve, reject: reject };
        window.parent.postMessage({ type: "localhub:call", requestId: requestId, commandId: commandId, params: params || null }, "*");
      });
    },
    copyText: function (text) {
      return new Promise(function (resolve, reject) {
        var requestId = nextId++;
        pending[requestId] = { resolve: resolve, reject: reject };
        window.parent.postMessage({ type: "localhub:copyText", requestId: requestId, text: String(text) }, "*");
      });
    },
    getSettings: function () {
      return new Promise(function (resolve, reject) {
        var requestId = nextId++;
        pending[requestId] = { resolve: resolve, reject: reject };
        window.parent.postMessage({ type: "localhub:getSettings", requestId: requestId }, "*");
      });
    },
    // ネイティブのフォルダ選択ダイアログをホストに代行してもらう(サンドボックス化
    // されたiframeはTauri APIへ直接アクセスできないため)。パスを選ばず閉じた場合は
    // nullで解決する。
    pickFolder: function () {
      return new Promise(function (resolve, reject) {
        var requestId = nextId++;
        pending[requestId] = { resolve: resolve, reject: reject };
        window.parent.postMessage({ type: "localhub:pickFolder", requestId: requestId }, "*");
      });
    },
    // 指定パスをOSの既定アプリで開く(例: コンフリクトが起きたファイルを
    // エディタで開いて手動修正してもらう用)。サンドボックス化されたiframeは
    // ファイルシステムへの直接アクセス手段を持たないため、ホストに代行してもらう。
    openPath: function (path) {
      return new Promise(function (resolve, reject) {
        var requestId = nextId++;
        pending[requestId] = { resolve: resolve, reject: reject };
        window.parent.postMessage({ type: "localhub:openPath", requestId: requestId, path: path }, "*");
      });
    },
  };

  var base = document.createElement("style");
  base.textContent =
    'body{margin:0;background:var(--bg,#0b0f14);color:var(--text,#f3f4f6);font-family:var(--font-ui,system-ui,sans-serif);font-size:13px;}' +
    'button{font-family:inherit;font-size:12.5px;background:var(--surface-raised,#172033);color:inherit;border:1px solid var(--border,#2a3443);border-radius:var(--radius-s,6px);padding:6px 10px;cursor:pointer;}' +
    'button:hover:not(:disabled){background:var(--surface-hover,#1c2740);}' +
    'button:disabled{opacity:.5;cursor:default;}' +
    'input,select,textarea{font-family:inherit;font-size:inherit;color:var(--text,#f3f4f6);background:var(--surface,#111827);border:1px solid var(--border,#2a3443);border-radius:var(--radius-s,6px);padding:6px 8px;}' +
    'input:focus,select:focus,textarea:focus{border-color:var(--accent,#22d3ee);outline:none;}' +
    'a{color:var(--accent,#22d3ee);}' +
    '::-webkit-scrollbar{width:10px;height:10px;}' +
    '::-webkit-scrollbar-track{background:transparent;}' +
    '::-webkit-scrollbar-thumb{background:var(--border,#2a3443);border-radius:6px;border:2px solid transparent;background-clip:padding-box;}';
  if (document.head.firstChild) document.head.insertBefore(base, document.head.firstChild);
  else document.head.appendChild(base);
})();
"#
    .to_string()
}
