// ローカルDB(SQLite/rusqlite)とシークレット保存(Windows資格情報マネージャー、
// keyring-core + windows-native-keyring-store)。Phase 0で疎通検証済み。
//
// `app_settings`は§9.2の`AppSetting`エンティティのキー・バリュー版。
// マイグレーション・バックアップ(§9.4)は将来のスキーマ変更時に必要になったら追加する。

use keyring_core::Entry;
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Windows資格情報マネージャー上でこのアプリのシークレットをまとめる識別子。
const KEYRING_SERVICE: &str = "com.gorihei.localhub";

const DB_FILENAME: &str = "local-hub.sqlite3";
/// §14「移行・バックアップ」: インポートは実行中のDB接続を差し替える危険を
/// 避けるため、即座にDBファイルを上書きせずこのマーカーファイルへ一旦退避し、
/// 次回起動時(まだ誰もDBを開いていないタイミング)に安全に反映する方式にしている。
const PENDING_IMPORT_FILENAME: &str = "pending-import.sqlite3";

pub struct DbState(pub Mutex<Connection>);

fn app_data_path(app: &AppHandle, filename: &str) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("アプリデータフォルダーの取得に失敗しました: {e}"))?
        .join(filename))
}

/// 保留中のインポートがあれば、DBを開く前にここで安全に反映する。
/// (§13.3「自動バックアップから復元を試みる前に原本を退避」)
fn apply_pending_import(app: &AppHandle, dir: &std::path::Path, db_path: &std::path::Path) -> Result<(), String> {
    let pending_path = dir.join(PENDING_IMPORT_FILENAME);
    if !pending_path.exists() {
        return Ok(());
    }
    if db_path.exists() {
        let timestamp = chrono_like_timestamp();
        let safety_path = dir.join(format!("local-hub.before-import-{timestamp}.sqlite3"));
        std::fs::copy(db_path, &safety_path).map_err(|e| format!("インポート前の退避に失敗しました: {e}"))?;
        tracing::info!("インポート前のDBを退避しました: {}", safety_path.display());
    }
    std::fs::rename(&pending_path, db_path).or_else(|_| {
        // renameがドライブをまたぐ等で失敗する場合はコピー+削除にフォールバックする。
        std::fs::copy(&pending_path, db_path).map(|_| ()).and_then(|_| std::fs::remove_file(&pending_path))
    })
    .map_err(|e| format!("インポートの反映に失敗しました: {e}"))?;
    tracing::info!("バックアップのインポートを反映しました");
    let _ = app; // 将来的に通知を出す場合に備えて引数として保持
    Ok(())
}

fn chrono_like_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs().to_string()
}

/// SQLite接続を開き(なければファイルを作成し)、資格情報ストアを既定として
/// 登録する。アプリ起動時に一度だけ呼ぶ想定。
pub fn init_store(app: &AppHandle) -> Result<DbState, String> {
    keyring_core::set_default_store(
        windows_native_keyring_store::Store::new()
            .map_err(|e| format!("資格情報ストアの初期化に失敗しました: {e}"))?,
    );

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("アプリデータフォルダーの取得に失敗しました: {e}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("アプリデータフォルダーの作成に失敗しました: {e}"))?;
    let db_path = dir.join(DB_FILENAME);

    apply_pending_import(app, &dir, &db_path)?;

    let conn = Connection::open(&db_path).map_err(|e| format!("DBのオープンに失敗しました: {e}"))?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS shortcuts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            kind TEXT NOT NULL,
            target TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        [],
    )
    .map_err(|e| format!("テーブル作成に失敗しました: {e}"))?;
    // FR-LAUNCH-002: Phase 0で作った簡易版shortcutsテーブルに、後から追加した
    // 属性列を移行する(既存DBを壊さないよう`ADD COLUMN`で拡張する)。
    for (column, def) in [
        ("description", "TEXT NOT NULL DEFAULT ''"),
        ("args", "TEXT NOT NULL DEFAULT ''"),
        ("cwd", "TEXT NOT NULL DEFAULT ''"),
        ("admin", "INTEGER NOT NULL DEFAULT 0"),
        ("favorite", "INTEGER NOT NULL DEFAULT 0"),
        ("tags", "TEXT NOT NULL DEFAULT ''"),
        ("use_count", "INTEGER NOT NULL DEFAULT 0"),
        ("last_used_at", "TEXT"),
        ("sort_order", "INTEGER NOT NULL DEFAULT 0"),
    ] {
        let _ = conn.execute(&format!("ALTER TABLE shortcuts ADD COLUMN {column} {def}"), []);
        // 既に列がある場合はエラーになるが、それは想定内なので無視する。
    }
    conn.execute(
        "CREATE TABLE IF NOT EXISTS launch_sets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        [],
    )
    .map_err(|e| format!("起動セットテーブル作成に失敗しました: {e}"))?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS launch_set_items (
            launch_set_id INTEGER NOT NULL REFERENCES launch_sets(id) ON DELETE CASCADE,
            shortcut_id INTEGER NOT NULL REFERENCES shortcuts(id) ON DELETE CASCADE,
            order_index INTEGER NOT NULL
        )",
        [],
    )
    .map_err(|e| format!("起動セット項目テーブル作成に失敗しました: {e}"))?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )
    .map_err(|e| format!("設定テーブル作成に失敗しました: {e}"))?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS plugin_permission_grants (
            plugin_id TEXT NOT NULL,
            permission TEXT NOT NULL,
            granted INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (plugin_id, permission)
        )",
        [],
    )
    .map_err(|e| format!("権限テーブル作成に失敗しました: {e}"))?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS plugin_settings (
            plugin_id TEXT NOT NULL,
            setting_id TEXT NOT NULL,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (plugin_id, setting_id)
        )",
        [],
    )
    .map_err(|e| format!("プラグイン設定テーブル作成に失敗しました: {e}"))?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            level TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        [],
    )
    .map_err(|e| format!("通知テーブル作成に失敗しました: {e}"))?;

    // §6.8 自動化(FR-AUTO-001) trigger -> conditions -> actions。
    // MVP範囲(FR-AUTO-002)は起動セットのみだが、利用者要望により
    // 汎用フロービルダー(v1相当)も追加する。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS automation_flows (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            trigger_type TEXT NOT NULL,
            trigger_config TEXT NOT NULL DEFAULT '{}',
            stop_on_failure INTEGER NOT NULL DEFAULT 1,
            last_run_at TEXT,
            last_run_status TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        [],
    )
    .map_err(|e| format!("自動化フローテーブル作成に失敗しました: {e}"))?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS automation_actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            flow_id INTEGER NOT NULL REFERENCES automation_flows(id) ON DELETE CASCADE,
            order_index INTEGER NOT NULL,
            command_id TEXT NOT NULL,
            params TEXT NOT NULL DEFAULT '{}'
        )",
        [],
    )
    .map_err(|e| format!("自動化アクションテーブル作成に失敗しました: {e}"))?;

    Ok(DbState(Mutex::new(conn)))
}

/// §13.3/AC-11 セーフモード判定。
///
/// 当初は「トレイの『終了』を通ったらクリーン終了」という印ベースの実装を
/// 試みたが、Windowsのシャットダウン(WM_QUERYENDSESSION)はtao 0.35時点では
/// まだTauriのウィンドウイベントとして伝播されず、OSがトレイの「終了」経路を
/// 経由せずプロセスを直接終了させることが実機確認で分かった。その実装のままだと
/// 「PCを2晩連続でシャットダウンしただけ」でセーフモードに入ってしまう欠陥がある。
///
/// そのため「終了経路が正常だったか」ではなく「短時間に連続で再起動しているか」
/// で判定する方式にしている。前回起動時刻を記録しておき、今回の起動がそれから
/// RAPID_RESTART_WINDOW_SECS以内であれば「クラッシュ直後の再起動」とみなして
/// カウントを増やす。シャットダウン→翌日起動のような間隔の長い再起動は
/// このウィンドウを超えるため、通常起動としてカウントがリセットされる。
const LAST_START_AT_KEY: &str = "last_start_at_unix";
const RAPID_RESTART_COUNT_KEY: &str = "rapid_restart_count";
const RAPID_RESTART_WINDOW_SECS: u64 = 20;
const SAFE_MODE_THRESHOLD: u32 = 2;

/// 起動時に一度だけ呼ぶ。前回起動時刻との差分から「連続クラッシュ再起動」か
/// どうかを判定し、閾値に達していればセーフモードへ入るべきと判断する。
/// 判定後は今回の起動時刻とカウンターを書き戻す。
pub fn check_rapid_restart(conn: &Connection) -> bool {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();

    let last_start: Option<u64> = conn
        .query_row("SELECT value FROM app_settings WHERE key = ?1", [LAST_START_AT_KEY], |row| row.get::<_, String>(0))
        .ok()
        .and_then(|s| s.parse().ok());

    let prev_count: u32 = conn
        .query_row("SELECT value FROM app_settings WHERE key = ?1", [RAPID_RESTART_COUNT_KEY], |row| {
            row.get::<_, String>(0)
        })
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let is_rapid_restart = last_start.is_some_and(|t| now.saturating_sub(t) < RAPID_RESTART_WINDOW_SECS);
    let next_count = if is_rapid_restart { prev_count + 1 } else { 0 };
    let enter_safe_mode = next_count >= SAFE_MODE_THRESHOLD;
    let stored_count = if enter_safe_mode { 0 } else { next_count };

    for (key, value) in [(LAST_START_AT_KEY, now.to_string()), (RAPID_RESTART_COUNT_KEY, stored_count.to_string())] {
        let _ = conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, value],
        );
    }
    enter_safe_mode
}

/// 単一キーだけ読みたい内部呼び出し向け(起動時のグローバルショートカット
/// 復元、閉じるボタンの挙動判定など)。tauri::commandにはしていない。
pub fn settings_get_internal(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM app_settings WHERE key = ?1", [key], |row| row.get::<_, String>(0)).ok()
}

#[tauri::command]
pub fn settings_get_all(state: tauri::State<DbState>) -> Result<HashMap<String, String>, String> {
    let conn = state.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT key, value FROM app_settings")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<HashMap<_, _>, _>>().map_err(|e| e.to_string())
}

/// tauri::commandではない生のConnectionを取る版。lib.rs側でDBロックを既に
/// 保持している文脈(グローバルショートカットの永続化など)から呼ぶための
/// 内部ヘルパー。
pub fn settings_set_internal(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn settings_set(state: tauri::State<DbState>, key: String, value: String) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    settings_set_internal(&conn, &key, &value)
}

/// 設定を既定値へ戻す(§6.10「既定値へ戻せる」)。値を空文字にするのではなく
/// 行ごと削除することで、呼び出し側(フロント)がJSON.parse等で「未設定」と
/// 「保存された既定値」を区別できるようにしている。
#[tauri::command]
pub fn settings_delete(state: tauri::State<DbState>, key: String) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    conn.execute("DELETE FROM app_settings WHERE key = ?1", [key]).map_err(|e| e.to_string())?;
    Ok(())
}

/// §14/AC-11 データ移行: DBファイル一式(ショートカット・起動セット・設定・
/// 通知履歴)を指定パスへコピーする。シークレットはWindows資格情報マネージャー
/// 側にあり、このDBファイルには含まれないため自動的にエクスポート対象外になる
/// (§15.1「エクスポート時のシークレット除外」)。
#[tauri::command]
pub fn backup_export(app: AppHandle, state: tauri::State<DbState>, dest_path: String) -> Result<(), String> {
    let db_path = app_data_path(&app, DB_FILENAME)?;
    // ロックを保持したままコピーすることで、コピー中に他コマンドが書き込みを
    // 行わないようにする(単純なファイルコピーでも一貫性を保つため)。
    let conn = state.0.lock().unwrap();
    conn.execute("PRAGMA wal_checkpoint(FULL)", []).ok();
    std::fs::copy(&db_path, &dest_path).map_err(|e| format!("エクスポートに失敗しました: {e}"))?;
    Ok(())
}

/// バックアップファイルをインポート予約する。安全のため、その場でDBを
/// 差し替えるのではなく次回起動時に反映する(apply_pending_importを参照)。
#[tauri::command]
pub fn backup_import_stage(app: AppHandle, src_path: String) -> Result<(), String> {
    let pending_path = app_data_path(&app, PENDING_IMPORT_FILENAME)?;
    std::fs::copy(&src_path, &pending_path).map_err(|e| format!("インポートの準備に失敗しました: {e}"))?;
    Ok(())
}

/// シークレットをWindows資格情報マネージャーへ保存する。DBやログには一切書かない。
#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    let entry = Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring_core::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn plugin_secret_key(plugin_id: &str, setting_id: &str) -> String {
    format!("plugin:{plugin_id}:{setting_id}")
}

pub fn plugin_secret_get_internal(plugin_id: &str, setting_id: &str) -> Result<Option<String>, String> {
    secret_get(plugin_secret_key(plugin_id, setting_id))
}

pub fn plugin_secret_delete_internal(plugin_id: &str, setting_id: &str) -> Result<(), String> {
    secret_delete(plugin_secret_key(plugin_id, setting_id))
}

#[derive(serde::Serialize)]
pub struct PluginSettingValue {
    pub id: String,
    pub value: serde_json::Value,
    pub configured: bool,
}

fn declared_setting(app: &AppHandle, plugin_id: &str, setting_id: &str) -> Result<crate::manifest::SettingContribution, String> {
    let state = app.state::<crate::plugin_host::PluginHostState>();
    let plugins = state.plugins.lock().unwrap();
    let plugin = plugins.get(plugin_id).ok_or_else(|| format!("プラグインが見つかりません: {plugin_id}"))?;
    plugin
        .manifest
        .contributes
        .settings
        .iter()
        .find(|s| s.id == setting_id)
        .cloned()
        .ok_or_else(|| format!("未宣言の設定です: {setting_id}"))
}

#[tauri::command]
pub fn plugin_settings_get(app: AppHandle, state: tauri::State<DbState>, plugin_id: String) -> Result<Vec<PluginSettingValue>, String> {
    let host = app.state::<crate::plugin_host::PluginHostState>();
    let definitions = {
        let plugins = host.plugins.lock().unwrap();
        plugins
            .get(&plugin_id)
            .ok_or_else(|| format!("プラグインが見つかりません: {plugin_id}"))?
            .manifest
            .contributes
            .settings
            .clone()
    };
    let conn = state.0.lock().unwrap();
    definitions
        .into_iter()
        .map(|setting| {
            if setting.setting_type == "secret" {
                let configured = plugin_secret_get_internal(&plugin_id, &setting.id)?.is_some();
                Ok(PluginSettingValue { id: setting.id, value: serde_json::Value::Null, configured })
            } else {
                let stored: Option<String> = conn
                    .query_row(
                        "SELECT value FROM plugin_settings WHERE plugin_id = ?1 AND setting_id = ?2",
                        rusqlite::params![plugin_id, setting.id],
                        |row| row.get(0),
                    )
                    .ok();
                let value = stored.and_then(|v| serde_json::from_str(&v).ok()).unwrap_or(setting.default);
                Ok(PluginSettingValue { id: setting.id, value, configured: true })
            }
        })
        .collect()
}

#[tauri::command]
pub fn plugin_setting_set(
    app: AppHandle,
    state: tauri::State<DbState>,
    plugin_id: String,
    setting_id: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let definition = declared_setting(&app, &plugin_id, &setting_id)?;
    if definition.setting_type == "secret" {
        let secret = value.as_str().ok_or("シークレットは文字列で指定してください")?;
        if secret.trim().is_empty() {
            return Err("空のシークレットは保存できません".to_string());
        }
        return secret_set(plugin_secret_key(&plugin_id, &setting_id), secret.to_string());
    }
    let valid = match definition.setting_type.as_str() {
        "string" => value.is_string(),
        "boolean" => value.is_boolean(),
        "number" => value.is_number(),
        "select" => definition.options.iter().any(|option| option.value == value),
        other => return Err(format!("未対応の設定型です: {other}")),
    };
    if !valid {
        return Err(format!("設定値の型または選択肢が不正です: {setting_id}"));
    }
    let encoded = serde_json::to_string(&value).map_err(|e| e.to_string())?;
    let conn = state.0.lock().unwrap();
    conn.execute(
        "INSERT INTO plugin_settings (plugin_id, setting_id, value) VALUES (?1, ?2, ?3)
         ON CONFLICT(plugin_id, setting_id) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
        rusqlite::params![plugin_id, setting_id, encoded],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn plugin_setting_delete(app: AppHandle, state: tauri::State<DbState>, plugin_id: String, setting_id: String) -> Result<(), String> {
    let definition = declared_setting(&app, &plugin_id, &setting_id)?;
    if definition.setting_type == "secret" {
        return secret_delete(plugin_secret_key(&plugin_id, &setting_id));
    }
    state
        .0
        .lock()
        .unwrap()
        .execute(
            "DELETE FROM plugin_settings WHERE plugin_id = ?1 AND setting_id = ?2",
            rusqlite::params![plugin_id, setting_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// プラグインのアンインストールに伴うホストDB側の関連データを一括削除する。
/// 新しい永続データを追加するときは、プラグインとの関連をplugin_idまたは
/// 名前空間付きIDで追跡できる形にし、このトランザクションへ削除処理を追加する。
pub fn plugin_data_delete_all(conn: &mut Connection, plugin_id: &str) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM plugin_settings WHERE plugin_id = ?1", [plugin_id])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM plugin_permission_grants WHERE plugin_id = ?1", [plugin_id])
        .map_err(|e| e.to_string())?;

    // プラグインコマンドを1件でも参照する自動化は、途中のアクションだけを抜くと
    // 意味が変わって危険なためフロー単位で削除する。
    let command_prefix = format!("plugin.{plugin_id}.");
    let related_flow_ids: Vec<i64> = {
        let mut stmt = tx
            .prepare(
                "SELECT DISTINCT flow_id FROM automation_actions
                 WHERE substr(command_id, 1, length(?1)) = ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([&command_prefix], |row| row.get(0)).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };
    for flow_id in related_flow_ids {
        tx.execute("DELETE FROM automation_actions WHERE flow_id = ?1", [flow_id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM automation_flows WHERE id = ?1", [flow_id])
            .map_err(|e| e.to_string())?;
    }

    // ダッシュボードレイアウトから、汎用ウィジェットと埋め込みページの両方を外す。
    let layout: Option<String> = tx
        .query_row("SELECT value FROM app_settings WHERE key = 'dashboardLayout'", [], |row| row.get(0))
        .ok();
    if let Some(layout) = layout {
        if let Ok(mut items) = serde_json::from_str::<Vec<serde_json::Value>>(&layout) {
            let widget_prefix = format!("plugin.{plugin_id}.");
            let page_prefix = format!("page.{plugin_id}.");
            items.retain(|item| {
                let id = item.get("i").and_then(|value| value.as_str()).unwrap_or("");
                !id.starts_with(&widget_prefix) && !id.starts_with(&page_prefix)
            });
            let encoded = serde_json::to_string(&items).map_err(|e| e.to_string())?;
            tx.execute("UPDATE app_settings SET value = ?1 WHERE key = 'dashboardLayout'", [encoded])
                .map_err(|e| e.to_string())?;
        }
    }

    // タブ対応後のレイアウトは、各タブのlayout配列にウィジェットを保持する。
    // プラグイン削除時は全タブを走査し、無効な埋め込みを残さない。
    let tabs: Option<String> = tx
        .query_row("SELECT value FROM app_settings WHERE key = 'dashboardTabs'", [], |row| row.get(0))
        .ok();
    if let Some(tabs) = tabs {
        if let Ok(mut groups) = serde_json::from_str::<Vec<serde_json::Value>>(&tabs) {
            let widget_prefix = format!("plugin.{plugin_id}.");
            let page_prefix = format!("page.{plugin_id}.");
            for group in &mut groups {
                let Some(layout) = group.get_mut("layout").and_then(|value| value.as_array_mut()) else {
                    continue;
                };
                layout.retain(|item| {
                    let id = item.get("i").and_then(|value| value.as_str()).unwrap_or("");
                    !id.starts_with(&widget_prefix) && !id.starts_with(&page_prefix)
                });
            }
            let encoded = serde_json::to_string(&groups).map_err(|e| e.to_string())?;
            tx.execute("UPDATE app_settings SET value = ?1 WHERE key = 'dashboardTabs'", [encoded])
                .map_err(|e| e.to_string())?;
        }
    }

    // 専用テーブル導入前のプラグインがapp_settingsへ保存した名前空間付きキーも削除する。
    for prefix in [format!("plugin:{plugin_id}:"), format!("plugin.{plugin_id}.")] {
        tx.execute("DELETE FROM app_settings WHERE substr(key, 1, length(?1)) = ?1", [&prefix])
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
