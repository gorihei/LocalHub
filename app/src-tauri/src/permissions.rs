// §10 権限ブローカー。プラグインが要求する権限(manifest.permissions)と、
// ユーザーが実際に許可したかどうか(§9.2 PluginPermissionGrant)を分けて管理する。
//
// FR-PERM-004(最小権限)に沿い、既定は「未許可」。実際の強制(is_granted)は
// コマンドバスの登録時(lib.rs)で、manifest.jsonのcommand.requiresPermissionが
// 指定されたコマンドに対して行う: 未許可ならプラグインへ転送する前に拒否する。

use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::storage::DbState;

/// 指定プラグインの指定権限が許可済みかどうか。台帳に行が無い場合は
/// FR-PERM-004の既定(未許可)に従いfalseを返す。
pub fn is_granted(conn: &Connection, plugin_id: &str, permission: &str) -> bool {
    conn.query_row(
        "SELECT granted FROM plugin_permission_grants WHERE plugin_id = ?1 AND permission = ?2",
        rusqlite::params![plugin_id, permission],
        |row| row.get::<_, i64>(0),
    )
    .map(|v| v != 0)
    .unwrap_or(false)
}

#[derive(Serialize, Clone)]
pub struct PermissionGrant {
    pub permission: String,
    pub granted: bool,
}

#[tauri::command]
pub fn permissions_list(state: State<DbState>, plugin_id: String) -> Result<Vec<PermissionGrant>, String> {
    let conn = state.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT permission, granted FROM plugin_permission_grants WHERE plugin_id = ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&plugin_id], |row| {
            Ok(PermissionGrant { permission: row.get(0)?, granted: row.get::<_, i64>(1)? != 0 })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// 権限の許可/取消(§10.1 FR-PERM-003「設定画面から許可を取り消せる」)。
#[tauri::command]
pub fn permissions_set(
    state: State<DbState>,
    plugin_id: String,
    permission: String,
    granted: bool,
) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    conn.execute(
        "INSERT INTO plugin_permission_grants (plugin_id, permission, granted) VALUES (?1, ?2, ?3)
         ON CONFLICT(plugin_id, permission) DO UPDATE SET granted = excluded.granted",
        rusqlite::params![plugin_id, permission, granted as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
