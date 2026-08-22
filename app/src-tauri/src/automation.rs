// §6.8 自動化(FR-AUTO-001) trigger -> conditions -> actions。
// MVP範囲(FR-AUTO-002)は起動セットのみだが、利用者要望により汎用フロー
// ビルダー(v1相当)も追加している。
//
// トリガー種別(FR-AUTO-003のうち今回実装した範囲):
//   manual   - 「今すぐ実行」ボタンのみ
//   startup  - アプリ起動時に一度だけ実行
//   schedule - 指定時刻・曜日に実行(trigger_configに{"time":"09:00","days":[0..6]}、
//              daysはJS Date.getDay()と同じ0=日曜〜6=土曜)
// ファイル変更・プラグインイベント・OSログイン時は将来の拡張。
//
// FR-AUTO-005「危険操作は無人実行で個別承認」を厳密な承認UIまでは実装せず、
// 代わりにriskLevel<=1(閲覧・軽微/復元容易)のコマンドだけをアクションとして
// 追加できるようにする(保存時にcommand_bus::CommandBus::risk_levelで検証)。
// 変更・不可逆コマンドは自動化からは実行できない。

use crate::command_bus::CommandBus;
use crate::storage::DbState;
use chrono::Datelike;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone)]
pub struct ActionInput {
    #[serde(rename = "commandId")]
    pub command_id: String,
    #[serde(default = "default_json_object")]
    pub params: serde_json::Value,
}

fn default_json_object() -> serde_json::Value {
    serde_json::json!({})
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FlowInput {
    pub id: Option<i64>,
    pub name: String,
    pub enabled: bool,
    #[serde(rename = "triggerType")]
    pub trigger_type: String,
    #[serde(rename = "triggerConfig")]
    pub trigger_config: serde_json::Value,
    #[serde(rename = "stopOnFailure")]
    pub stop_on_failure: bool,
    pub actions: Vec<ActionInput>,
}

#[derive(Serialize)]
pub struct FlowDto {
    pub id: i64,
    pub name: String,
    pub enabled: bool,
    #[serde(rename = "triggerType")]
    pub trigger_type: String,
    #[serde(rename = "triggerConfig")]
    pub trigger_config: serde_json::Value,
    #[serde(rename = "stopOnFailure")]
    pub stop_on_failure: bool,
    #[serde(rename = "lastRunAt")]
    pub last_run_at: Option<String>,
    #[serde(rename = "lastRunStatus")]
    pub last_run_status: Option<String>,
    pub actions: Vec<ActionInput>,
}

#[derive(Serialize)]
pub struct ActionResult {
    #[serde(rename = "commandId")]
    pub command_id: String,
    pub success: bool,
    pub error: Option<String>,
}

/// 直近にスケジュール発火した「フローID→YYYY-MM-DD HH:MM」を覚えておき、
/// 同じ分の中でスケジューラが複数回起動しても二重実行しないようにする。
#[derive(Default)]
pub struct SchedulerState(pub Mutex<HashMap<i64, String>>);

fn load_flow_actions(conn: &Connection, flow_id: i64) -> Result<Vec<ActionInput>, String> {
    let mut stmt = conn
        .prepare("SELECT command_id, params FROM automation_actions WHERE flow_id = ?1 ORDER BY order_index")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([flow_id], |row| {
            let command_id: String = row.get(0)?;
            let params_text: String = row.get(1)?;
            Ok((command_id, params_text))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(command_id, params_text)| {
            let params = serde_json::from_str(&params_text).unwrap_or(serde_json::json!({}));
            Ok(ActionInput { command_id, params })
        })
        .collect()
}

fn row_to_dto(conn: &Connection, row: &rusqlite::Row) -> rusqlite::Result<(i64, FlowDto)> {
    let id: i64 = row.get(0)?;
    let trigger_config_text: String = row.get(4)?;
    let dto = FlowDto {
        id,
        name: row.get(1)?,
        enabled: row.get::<_, i64>(2)? != 0,
        trigger_type: row.get(3)?,
        trigger_config: serde_json::from_str(&trigger_config_text).unwrap_or(serde_json::json!({})),
        stop_on_failure: row.get::<_, i64>(5)? != 0,
        last_run_at: row.get(6)?,
        last_run_status: row.get(7)?,
        actions: load_flow_actions(conn, id).unwrap_or_default(),
    };
    Ok((id, dto))
}

#[tauri::command]
pub fn automation_flows_list(state: tauri::State<DbState>) -> Result<Vec<FlowDto>, String> {
    let conn = state.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, name, enabled, trigger_type, trigger_config, stop_on_failure, last_run_at, last_run_status
             FROM automation_flows ORDER BY id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| row_to_dto(&conn, row)).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string()).map(|v| v.into_iter().map(|(_, dto)| dto).collect())
}

/// フローを新規作成または更新する。保存前にアクション全件のriskLevelを
/// 検証し、無人実行が許されないコマンド(riskLevel>=2)が含まれていれば拒否する。
#[tauri::command]
pub fn automation_flow_upsert(
    db_state: tauri::State<DbState>,
    bus: tauri::State<CommandBus>,
    input: FlowInput,
) -> Result<i64, String> {
    if input.name.trim().is_empty() {
        return Err("名前を入力してください".to_string());
    }
    if input.actions.is_empty() {
        return Err("アクションを1つ以上追加してください".to_string());
    }
    for action in &input.actions {
        let risk = bus.risk_level(&action.command_id).ok_or_else(|| format!("未知のコマンドです: {}", action.command_id))?;
        if risk >= 2 {
            let title = bus.title(&action.command_id).unwrap_or(action.command_id.clone());
            return Err(format!(
                "「{title}」は変更を伴う操作のため自動化には追加できません(無人実行で個別承認が必要な操作は現バージョンでは自動化非対応です)"
            ));
        }
    }

    let mut conn = db_state.0.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let trigger_config_text = serde_json::to_string(&input.trigger_config).map_err(|e| e.to_string())?;

    let flow_id = if let Some(id) = input.id {
        tx.execute(
            "UPDATE automation_flows SET name = ?1, enabled = ?2, trigger_type = ?3, trigger_config = ?4, stop_on_failure = ?5 WHERE id = ?6",
            rusqlite::params![input.name, input.enabled as i64, input.trigger_type, trigger_config_text, input.stop_on_failure as i64, id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM automation_actions WHERE flow_id = ?1", [id]).map_err(|e| e.to_string())?;
        id
    } else {
        tx.execute(
            "INSERT INTO automation_flows (name, enabled, trigger_type, trigger_config, stop_on_failure) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![input.name, input.enabled as i64, input.trigger_type, trigger_config_text, input.stop_on_failure as i64],
        )
        .map_err(|e| e.to_string())?;
        tx.last_insert_rowid()
    };

    for (index, action) in input.actions.iter().enumerate() {
        let params_text = serde_json::to_string(&action.params).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO automation_actions (flow_id, order_index, command_id, params) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![flow_id, index as i64, action.command_id, params_text],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(flow_id)
}

#[tauri::command]
pub fn automation_flow_delete(state: tauri::State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    conn.execute("DELETE FROM automation_flows WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn automation_flow_set_enabled(state: tauri::State<DbState>, id: i64, enabled: bool) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    conn.execute("UPDATE automation_flows SET enabled = ?1 WHERE id = ?2", rusqlite::params![enabled as i64, id]).map_err(|e| e.to_string())?;
    Ok(())
}

/// フローを1回実行する。stop_on_failureがtrueなら最初の失敗で残りをスキップ。
/// 実行結果は各アクションの成否として返しつつ、DBのlast_run_at/statusと
/// 通知(FR-AUTO-004「実行履歴」の簡易版)も更新する。
pub fn run_flow(app: &AppHandle, flow_id: i64) -> Result<Vec<ActionResult>, String> {
    let db_state = app.state::<DbState>();
    let bus = app.state::<CommandBus>();

    let (flow_name, actions, stop_on_failure) = {
        let conn = db_state.0.lock().unwrap();
        let name: String = conn
            .query_row("SELECT name FROM automation_flows WHERE id = ?1", [flow_id], |row| row.get(0))
            .map_err(|_| format!("フローが見つかりません: {flow_id}"))?;
        let stop_on_failure: bool = conn
            .query_row("SELECT stop_on_failure FROM automation_flows WHERE id = ?1", [flow_id], |row| row.get::<_, i64>(0))
            .map(|v| v != 0)
            .unwrap_or(true);
        let actions = load_flow_actions(&conn, flow_id)?;
        (name, actions, stop_on_failure)
    };

    let mut results = Vec::new();
    let mut had_failure = false;
    for action in actions {
        if had_failure && stop_on_failure {
            break;
        }
        match bus.execute(app, &action.command_id, action.params.clone()) {
            Ok(_) => results.push(ActionResult { command_id: action.command_id, success: true, error: None }),
            Err(e) => {
                had_failure = true;
                results.push(ActionResult { command_id: action.command_id, success: false, error: Some(e) });
            }
        }
    }

    let status = if had_failure { "error" } else { "success" };
    {
        let conn = db_state.0.lock().unwrap();
        let _ = conn.execute(
            "UPDATE automation_flows SET last_run_at = datetime('now'), last_run_status = ?1 WHERE id = ?2",
            rusqlite::params![status, flow_id],
        );
    }

    let failed_count = results.iter().filter(|r| !r.success).count();
    crate::notifications::push(
        app,
        if had_failure { "error" } else { "success" },
        &format!("自動化「{flow_name}」を実行しました"),
        &if had_failure {
            format!("{failed_count}件のアクションが失敗しました")
        } else {
            format!("{}件のアクションが成功しました", results.len())
        },
    );

    Ok(results)
}

#[tauri::command]
pub fn automation_flow_run_now(app: AppHandle, id: i64) -> Result<Vec<ActionResult>, String> {
    run_flow(&app, id)
}

/// アプリ起動時に一度だけ呼ぶ。trigger_type="startup"かつenabledなフローを
/// すべて実行する(ウィンドウ表示をブロックしないよう別スレッドで行う)。
pub fn run_startup_flows(app: &AppHandle) {
    let db_state = app.state::<DbState>();
    let ids: Vec<i64> = {
        let conn = db_state.0.lock().unwrap();
        let mut stmt = match conn.prepare("SELECT id FROM automation_flows WHERE trigger_type = 'startup' AND enabled = 1") {
            Ok(s) => s,
            Err(_) => return,
        };
        stmt.query_map([], |row| row.get::<_, i64>(0)).ok().map(|rows| rows.flatten().collect()).unwrap_or_default()
    };
    for id in ids {
        let app = app.clone();
        std::thread::spawn(move || {
            let _ = run_flow(&app, id);
        });
    }
}

/// スケジュールトリガーを1分おきに確認するバックグラウンドループ。
/// setup()内でstd::thread::spawnして起動する想定(アプリと同じ寿命)。
pub fn spawn_scheduler(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(30));
        check_schedule(&app);
    });
}

fn check_schedule(app: &AppHandle) {
    let now = chrono::Local::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let hhmm = now.format("%H:%M").to_string();
    // chrono::Weekday::num_days_from_sunday(): 0=日曜..6=土曜(JSのDate.getDay()と同じ規約)
    let weekday = now.weekday().num_days_from_sunday() as i64;

    let db_state = app.state::<DbState>();
    let due: Vec<i64> = {
        let conn = db_state.0.lock().unwrap();
        let mut stmt = match conn.prepare("SELECT id, trigger_config FROM automation_flows WHERE trigger_type = 'schedule' AND enabled = 1") {
            Ok(s) => s,
            Err(_) => return,
        };
        let rows = stmt.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)));
        let Ok(rows) = rows else { return };
        rows.flatten()
            .filter_map(|(id, config_text)| {
                let config: serde_json::Value = serde_json::from_str(&config_text).ok()?;
                let time = config.get("time")?.as_str()?;
                let days: Vec<i64> = config.get("days")?.as_array()?.iter().filter_map(|d| d.as_i64()).collect();
                if time == hhmm && days.contains(&weekday) {
                    Some(id)
                } else {
                    None
                }
            })
            .collect()
    };

    if due.is_empty() {
        return;
    }

    let scheduler_state = app.state::<SchedulerState>();
    let mut fired = scheduler_state.0.lock().unwrap();
    for id in due {
        let key = format!("{date_str} {hhmm}");
        if fired.get(&id) == Some(&key) {
            continue; // 同じ分の中で既に発火済み
        }
        fired.insert(id, key);
        let app = app.clone();
        std::thread::spawn(move || {
            let _ = run_flow(&app, id);
        });
    }
}
