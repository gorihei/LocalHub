// §6.9 通知とアクティビティ。
// 成功/情報/警告/エラーを区別し、履歴をSQLiteへ残す(「履歴から再確認できる」)。
// 集約(同一イベントの大量通知をまとめる)はフロント側の表示層で行う。

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::storage::DbState;

#[derive(Serialize, Clone)]
pub struct NotificationRecord {
    pub id: i64,
    pub level: String,
    pub title: String,
    pub body: String,
    pub created_at: String,
}

/// 通知を1件記録し、`app://notification`イベントでフロントへ即時配信する。
/// コア・プラグインどちらのコードからも呼べる共通の入口。
pub fn push(app: &AppHandle, level: &str, title: &str, body: &str) {
    let db_state = app.state::<DbState>();
    let record = {
        let conn = db_state.0.lock().unwrap();
        if let Err(e) = conn.execute(
            "INSERT INTO notifications (level, title, body) VALUES (?1, ?2, ?3)",
            rusqlite::params![level, title, body],
        ) {
            tracing::error!(target: "core", error = %e, "通知の保存に失敗しました");
            return;
        }
        let id = conn.last_insert_rowid();
        conn.query_row(
            "SELECT id, level, title, body, created_at FROM notifications WHERE id = ?1",
            [id],
            |row| {
                Ok(NotificationRecord {
                    id: row.get(0)?,
                    level: row.get(1)?,
                    title: row.get(2)?,
                    body: row.get(3)?,
                    created_at: row.get(4)?,
                })
            },
        )
    };

    match record {
        Ok(record) => {
            let _ = app.emit("app://notification", record);
        }
        Err(e) => tracing::error!(target: "core", error = %e, "通知の再読み込みに失敗しました"),
    }
}

/// 通知パイプライン(DB保存 + イベント配信 + 任意でOSトースト)の疎通確認用。
/// 設定画面の「テスト通知を送る」から呼ばれる。
#[tauri::command]
pub fn notifications_test(app: AppHandle) {
    push(&app, "info", "テスト通知", "通知パイプラインの疎通確認です");
}

/// フロント側の処理(例: ダッシュボードレイアウト保存失敗)から汎用的に
/// 通知を出すための入口。
#[tauri::command]
pub fn notifications_push(app: AppHandle, level: String, title: String, body: String) {
    push(&app, &level, &title, &body);
}

/// 通知履歴を全削除する。破壊的操作のため、コマンドバス経由(risk_level=2)で
/// フロント側の確認ダイアログを通してから呼ばれる想定。
#[tauri::command]
pub fn notifications_clear(state: tauri::State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    conn.execute("DELETE FROM notifications", []).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn notifications_list(state: tauri::State<DbState>, limit: Option<i64>) -> Result<Vec<NotificationRecord>, String> {
    let conn = state.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, level, title, body, created_at FROM notifications ORDER BY id DESC LIMIT ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([limit.unwrap_or(50)], |row| {
            Ok(NotificationRecord {
                id: row.get(0)?,
                level: row.get(1)?,
                title: row.get(2)?,
                body: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}
