// §12.4 コマンドバス。
// UI・パレット(Phase 4)・自動化(v1)・AI(将来)が同じコマンド定義を呼び出すことで、
// 挙動とリスクレベルに応じた確認フローを一貫させるための基盤。
//
// リスクレベルは付録A準拠:
//   0 閲覧・無害      → 即時実行
//   1 軽微・復元容易   → 実行、結果通知
//   2 変更・外部影響   → 内容確認(フロント側でConfirmDialogを挟む)
//   3 高リスク・不可逆 → 強い確認、監査必須(未実装。実際に3を使う機能ができた時に対応)

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Clone, Serialize)]
pub struct CommandMeta {
    pub id: String,
    pub title: String,
    pub description: String,
    pub owner_plugin_id: Option<String>,
    pub risk_level: u8,
    pub supports_undo: bool,
}

type Handler = Box<dyn Fn(&AppHandle, Value) -> Result<Value, String> + Send + Sync>;

struct RegisteredCommand {
    meta: CommandMeta,
    handler: Handler,
}

#[derive(Default)]
pub struct CommandBus(Mutex<HashMap<String, RegisteredCommand>>);

impl CommandBus {
    pub fn register(&self, meta: CommandMeta, handler: Handler) {
        self.0.lock().unwrap().insert(meta.id.clone(), RegisteredCommand { meta, handler });
    }

    /// アンインストールされたプラグインが所有していたコマンドをまとめて外す。
    /// 残したままだと、一覧には存在しないプラグインのコマンドがパレットや
    /// 自動化から実行できるように見えてしまうため、プラグイン一覧と同期する。
    pub fn unregister_plugin(&self, plugin_id: &str) {
        self.0.lock().unwrap().retain(|_, command| command.meta.owner_plugin_id.as_deref() != Some(plugin_id));
    }

    /// 指定コマンドのriskLevelを引く。自動化(FR-AUTO-005)がフロー保存時に
    /// 「無人実行してよいコマンドか」を判定するために使う。
    pub fn risk_level(&self, id: &str) -> Option<u8> {
        self.0.lock().unwrap().get(id).map(|c| c.meta.risk_level)
    }

    pub fn title(&self, id: &str) -> Option<String> {
        self.0.lock().unwrap().get(id).map(|c| c.meta.title.clone())
    }

    /// command_bus_executeと自動化の実行エンジンの両方から呼ばれる共通実装。
    pub fn execute(&self, app: &AppHandle, id: &str, params: Value) -> Result<Value, String> {
        // ハンドラは自分自身でCommandBusを再ロックしないため、ロックを保持したまま
        // 呼び出しても問題ない(実装を追加する際は再入しないよう注意すること)。
        let map = self.0.lock().unwrap();
        let cmd = map.get(id).ok_or_else(|| format!("未知のコマンドです: {id}"))?;
        tracing::info!(target: "core", command = %id, "コマンドバス経由で実行");
        (cmd.handler)(app, params)
    }
}

/// マニフェストが宣言したコマンドをコマンドバスへ登録する共通処理。
/// 起動時だけでなく、実行中のインストールや再スキャンでも同じ処理を使うことで、
/// アプリを再起動しなくてもプラグインUIから直ちにコマンドを呼べるようにする。
pub fn register_plugin_commands(bus: &CommandBus, plugin_id: &str, commands: &[crate::manifest::CommandContribution]) {
    for contribution in commands {
        let owner_plugin_id = plugin_id.to_string();
        let handler_plugin_id = owner_plugin_id.clone();
        let method = contribution.method.clone().unwrap_or_else(|| contribution.id.clone());
        let requires_permission = contribution.requires_permission.clone();
        bus.register(
            CommandMeta {
                id: format!("plugin.{}.{}", plugin_id, contribution.id),
                title: contribution.title.clone(),
                description: contribution.description.clone(),
                owner_plugin_id: Some(owner_plugin_id),
                risk_level: contribution.risk_level,
                supports_undo: false,
            },
            Box::new(move |app, params| {
                if let Some(permission) = &requires_permission {
                    let db_state = app.state::<crate::storage::DbState>();
                    let conn = db_state.0.lock().unwrap();
                    if !crate::permissions::is_granted(&conn, &handler_plugin_id, permission) {
                        return Err(format!(
                            "この操作には権限「{permission}」が必要です。プラグイン画面で許可してから再度お試しください。"
                        ));
                    }
                }
                tauri::async_runtime::block_on(crate::plugin_host::call_method(
                    app,
                    handler_plugin_id.clone(),
                    method.clone(),
                    params,
                ))
            }),
        );
    }
}

#[tauri::command]
pub fn command_bus_list(state: tauri::State<CommandBus>) -> Vec<CommandMeta> {
    let map = state.0.lock().unwrap();
    let mut list: Vec<_> = map.values().map(|c| c.meta.clone()).collect();
    list.sort_by(|a, b| a.id.cmp(&b.id));
    list
}

#[tauri::command]
pub fn command_bus_execute(
    app: AppHandle,
    state: tauri::State<CommandBus>,
    id: String,
    params: Value,
) -> Result<Value, String> {
    state.execute(&app, &id, params)
}
