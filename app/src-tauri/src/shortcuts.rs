// FR-LAUNCH-001〜005 ショートカットと起動セット。
//
// 種類(kind)は "app" | "file" | "folder" | "url" | "command" の5種類。
// app/file/folder/urlはOS既定の関連付けで開く(tauri-plugin-opener)。
// commandは新しいPowerShellウィンドウでコマンドを実行する
// (統合CLIプラグインのターミナルタブへの統合は将来の改善点)。
//
// 管理者権限フラグ(admin)を持つショートカットの起動確認(§10.3, AC-10)は
// フロント側のConfirmDialogが担い、ここでは「実行そのもの」だけを行う。

use base64::Engine;
use rusqlite::Row;
use serde::{Deserialize, Serialize};
use std::os::windows::process::CommandExt;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::storage::DbState;

/// Win32のCREATE_NO_WINDOWフラグ。下記の`cmd /C start`用の踏み台プロセス
/// (cmd.exe)自体のウィンドウは表示させない(表示すべきは`start`が新規に
/// 起動するpowershell.exe側のウィンドウのみ)。
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// ②アイコン差別化: アプリ(exe)本体に埋め込まれたアイコンをOSから取得する。
/// file種別は拡張子に紐づくOS既定アイコンを返す。folder/urlはフロント側で
/// 固有のSVG/faviconを使うため、ここでは扱わない。
#[tauri::command]
pub fn shortcut_icon(path: String) -> Result<String, String> {
    let png_bytes = systemicons::get_icon(&path, 32).map_err(|e| format!("アイコンの取得に失敗しました: {}", e.message))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(png_bytes);
    Ok(format!("data:image/png;base64,{encoded}"))
}

#[derive(Serialize, Clone)]
pub struct ShortcutRow {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub kind: String,
    pub target: String,
    pub args: String,
    pub cwd: String,
    pub admin: bool,
    pub favorite: bool,
    pub tags: String,
    pub use_count: i64,
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub sort_order: i64,
}

const SELECT_COLUMNS: &str = "id, name, description, kind, target, args, cwd, admin, favorite, tags, use_count, last_used_at, created_at, sort_order";

fn row_from(row: &Row) -> rusqlite::Result<ShortcutRow> {
    Ok(ShortcutRow {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        kind: row.get(3)?,
        target: row.get(4)?,
        args: row.get(5)?,
        cwd: row.get(6)?,
        admin: row.get::<_, i64>(7)? != 0,
        favorite: row.get::<_, i64>(8)? != 0,
        tags: row.get(9)?,
        use_count: row.get(10)?,
        last_used_at: row.get(11)?,
        created_at: row.get(12)?,
        sort_order: row.get(13)?,
    })
}

#[tauri::command]
pub fn shortcuts_list(state: State<DbState>) -> Result<Vec<ShortcutRow>, String> {
    let conn = state.0.lock().unwrap();
    let mut stmt = conn
        .prepare(&format!("SELECT {SELECT_COLUMNS} FROM shortcuts ORDER BY sort_order ASC, id ASC"))
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_from).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// 編集モードでのドラッグ並べ替え(FR-DASH-007に準じたキーボード操作は
/// フロント側のtabIndex+矢印キーで対応)を保存する。
#[tauri::command]
pub fn shortcuts_reorder(state: State<DbState>, ids: Vec<i64>) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    for (index, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE shortcuts SET sort_order = ?1 WHERE id = ?2",
            rusqlite::params![index as i64, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn shortcuts_recent(state: State<DbState>, limit: i64) -> Result<Vec<ShortcutRow>, String> {
    let conn = state.0.lock().unwrap();
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {SELECT_COLUMNS} FROM shortcuts WHERE last_used_at IS NOT NULL ORDER BY last_used_at DESC LIMIT ?1"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([limit], row_from).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct NewShortcut {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub kind: String,
    pub target: String,
    #[serde(default)]
    pub args: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub admin: bool,
    #[serde(default)]
    pub tags: String,
}

#[tauri::command]
pub fn shortcuts_add(state: State<DbState>, input: NewShortcut) -> Result<i64, String> {
    let conn = state.0.lock().unwrap();
    let next_order: i64 = conn
        .query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM shortcuts", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO shortcuts (name, description, kind, target, args, cwd, admin, tags, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            input.name,
            input.description,
            input.kind,
            input.target,
            input.args,
            input.cwd,
            input.admin as i64,
            input.tags,
            next_order
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn shortcuts_update(state: State<DbState>, id: i64, input: NewShortcut) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    conn.execute(
        "UPDATE shortcuts SET name = ?1, description = ?2, kind = ?3, target = ?4, args = ?5, cwd = ?6, admin = ?7, tags = ?8
         WHERE id = ?9",
        rusqlite::params![
            input.name,
            input.description,
            input.kind,
            input.target,
            input.args,
            input.cwd,
            input.admin as i64,
            input.tags,
            id
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn shortcuts_delete(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    conn.execute("DELETE FROM shortcuts WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn shortcuts_set_favorite(state: State<DbState>, id: i64, favorite: bool) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    conn.execute(
        "UPDATE shortcuts SET favorite = ?1 WHERE id = ?2",
        rusqlite::params![favorite as i64, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn touch(state: &State<DbState>, id: i64) {
    let conn = state.0.lock().unwrap();
    let _ = conn.execute(
        "UPDATE shortcuts SET use_count = use_count + 1, last_used_at = datetime('now') WHERE id = ?1",
        [id],
    );
}

fn parse_args(args: &str) -> Vec<String> {
    // 簡易パーサ: ダブルクォートで囲まれた区間はスペースを含めて1つの引数として扱う。
    let mut result = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    for c in args.chars() {
        match c {
            '"' => in_quotes = !in_quotes,
            ' ' if !in_quotes => {
                if !current.is_empty() {
                    result.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(c),
        }
    }
    if !current.is_empty() {
        result.push(current);
    }
    result
}

/// ショートカットを実際に起動する。
fn launch(app: &AppHandle, shortcut: &ShortcutRow) -> Result<(), String> {
    match shortcut.kind.as_str() {
        "app" => {
            let mut cmd = std::process::Command::new(&shortcut.target);
            if !shortcut.args.is_empty() {
                cmd.args(parse_args(&shortcut.args));
            }
            if !shortcut.cwd.is_empty() {
                cmd.current_dir(&shortcut.cwd);
            }
            cmd.spawn().map_err(|e| format!("起動に失敗しました: {e}"))?;
            Ok(())
        }
        "file" | "folder" => app
            .opener()
            .open_path(shortcut.target.clone(), None::<&str>)
            .map_err(|e| format!("開けませんでした: {e}")),
        "url" => app
            .opener()
            .open_url(shortcut.target.clone(), None::<&str>)
            .map_err(|e| format!("開けませんでした: {e}")),
        "command" => {
            // 直接powershell.exeをspawnしてCREATE_NEW_CONSOLEを指定するだけでは、
            // 開発時(app.exeがdevコンソールにアタッチされた状態)にPowerShellの
            // 標準出力ハンドルが継承されてしまい、ウィンドウは開くのに-Commandの
            // 実行結果がそこに表示されない(実際はdevログ側に出ていた)現象が
            // 実機で確認された。`cmd /C start`はOSの標準的な「新規ウィンドウで
            // 起動する」経路であり、この継承問題を確実に回避できる。
            // start "" の空文字はウィンドウタイトル引数(省略するとstartが
            // 最初の引用符付き引数をタイトルとして誤解釈してしまうためのお作法)。
            std::process::Command::new("cmd.exe")
                .args(["/C", "start", "", "powershell.exe", "-NoExit", "-Command", &shortcut.target])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|e| format!("コマンドの実行に失敗しました: {e}"))?;
            Ok(())
        }
        other => Err(format!("未知の種類です: {other}")),
    }
}

#[tauri::command]
pub fn shortcuts_launch(app: AppHandle, state: State<DbState>, id: i64) -> Result<(), String> {
    let shortcut = {
        let conn = state.0.lock().unwrap();
        conn.query_row(&format!("SELECT {SELECT_COLUMNS} FROM shortcuts WHERE id = ?1"), [id], row_from)
            .map_err(|e| format!("ショートカットが見つかりません: {e}"))?
    };
    launch(&app, &shortcut)?;
    touch(&state, id);
    tracing::info!(target: "core", shortcut = %shortcut.name, "ショートカットを起動しました");
    Ok(())
}

// ---------- 起動セット(FR-LAUNCH-005) ----------

#[derive(Serialize, Clone)]
pub struct LaunchSetRow {
    pub id: i64,
    pub name: String,
    pub created_at: String,
}

#[derive(Serialize, Clone)]
pub struct LaunchSetItem {
    pub shortcut_id: i64,
    pub name: String,
    pub order_index: i64,
}

#[tauri::command]
pub fn launch_sets_list(state: State<DbState>) -> Result<Vec<LaunchSetRow>, String> {
    let conn = state.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, name, created_at FROM launch_sets ORDER BY id DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok(LaunchSetRow { id: r.get(0)?, name: r.get(1)?, created_at: r.get(2)? }))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn launch_set_items(state: State<DbState>, launch_set_id: i64) -> Result<Vec<LaunchSetItem>, String> {
    let conn = state.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT lsi.shortcut_id, s.name, lsi.order_index
             FROM launch_set_items lsi JOIN shortcuts s ON s.id = lsi.shortcut_id
             WHERE lsi.launch_set_id = ?1 ORDER BY lsi.order_index ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([launch_set_id], |r| {
            Ok(LaunchSetItem { shortcut_id: r.get(0)?, name: r.get(1)?, order_index: r.get(2)? })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn launch_sets_add(state: State<DbState>, name: String, shortcut_ids: Vec<i64>) -> Result<i64, String> {
    let conn = state.0.lock().unwrap();
    conn.execute("INSERT INTO launch_sets (name) VALUES (?1)", [&name]).map_err(|e| e.to_string())?;
    let launch_set_id = conn.last_insert_rowid();
    for (index, shortcut_id) in shortcut_ids.iter().enumerate() {
        conn.execute(
            "INSERT INTO launch_set_items (launch_set_id, shortcut_id, order_index) VALUES (?1, ?2, ?3)",
            rusqlite::params![launch_set_id, shortcut_id, index as i64],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(launch_set_id)
}

#[tauri::command]
pub fn launch_sets_delete(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    conn.execute("DELETE FROM launch_set_items WHERE launch_set_id = ?1", [id]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM launch_sets WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
pub struct LaunchResult {
    pub name: String,
    pub success: bool,
    pub error: String,
}

/// 起動セットを順番に実行する。各項目の成否を結果として返す
/// (「各結果と失敗を確認できる」§17 Phase 4 / AC-06)。
#[tauri::command]
pub fn launch_sets_run(app: AppHandle, state: State<DbState>, id: i64) -> Result<Vec<LaunchResult>, String> {
    let items = launch_set_items(state.clone(), id)?;
    let mut results = Vec::new();
    for item in items {
        let shortcut = {
            let conn = state.0.lock().unwrap();
            conn.query_row(&format!("SELECT {SELECT_COLUMNS} FROM shortcuts WHERE id = ?1"), [item.shortcut_id], row_from)
        };
        match shortcut {
            Ok(shortcut) => match launch(&app, &shortcut) {
                Ok(()) => {
                    touch(&state, item.shortcut_id);
                    results.push(LaunchResult { name: item.name, success: true, error: String::new() });
                }
                Err(e) => results.push(LaunchResult { name: item.name, success: false, error: e }),
            },
            Err(e) => results.push(LaunchResult { name: item.name, success: false, error: e.to_string() }),
        }
    }
    Ok(results)
}
