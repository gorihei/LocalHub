// 締め切り/カウントダウントラッカープラグイン(サイドカー実行ファイル)。
//
// 「あと何日」を管理するだけのシンプルなツール。todo-pluginと同じ構造で、
// 自分の実行ファイルと同じフォルダに"deadlines.json"として保存する。
// 日付の残日数計算はUI側(ui/index.html)で行う(表示のたびに再計算したいだけの
// 値なので、サイドカー側では文字列のまま保持・返却する)。
//
// ホストとは改行区切りJSONの簡易JSON-RPC風プロトコルで通信する。

use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};
use std::path::PathBuf;

#[derive(Deserialize)]
struct Request {
    id: u64,
    method: String,
    #[serde(default)]
    params: serde_json::Value,
}

#[derive(Serialize)]
struct Response {
    id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Deadline {
    id: u64,
    title: String,
    /// "YYYY-MM-DD"形式の日付文字列。時刻は持たない(日単位のカウントダウンのため)。
    #[serde(rename = "dueAt")]
    due_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Store {
    next_id: u64,
    items: Vec<Deadline>,
}

fn data_path() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("deadlines.json")
}

fn load(path: &PathBuf) -> Store {
    std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save(path: &PathBuf, store: &Store) {
    if let Ok(json) = serde_json::to_string_pretty(store) {
        let _ = std::fs::write(path, json);
    }
}

fn main() {
    eprintln!("[deadline-plugin] 起動しました (pid={})", std::process::id());
    let path = data_path();
    let mut store = load(&path);

    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }

        let req: Request = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[deadline-plugin] 不正なリクエストを受信しました: {e}");
                continue;
            }
        };

        match req.method.as_str() {
            "list" => {
                let mut items = store.items.clone();
                items.sort_by(|a, b| a.due_at.cmp(&b.due_at));
                send(&mut stdout, req.id, Ok(serde_json::json!(items)));
            }

            "add" => {
                let title = req.params.get("title").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
                let due_at = req.params.get("dueAt").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
                if title.is_empty() || due_at.is_empty() {
                    send(&mut stdout, req.id, Err("タイトルと期限日の両方が必要です".to_string()));
                } else {
                    let item = Deadline { id: store.next_id, title, due_at };
                    store.next_id += 1;
                    store.items.push(item);
                    save(&path, &store);
                    let mut items = store.items.clone();
                    items.sort_by(|a, b| a.due_at.cmp(&b.due_at));
                    send(&mut stdout, req.id, Ok(serde_json::json!(items)));
                }
            }

            "remove" => {
                let id = req.params.get("id").and_then(|v| v.as_u64());
                match id {
                    Some(id) => {
                        let before = store.items.len();
                        store.items.retain(|t| t.id != id);
                        if store.items.len() == before {
                            send(&mut stdout, req.id, Err("指定idの締め切りが見つかりません".to_string()));
                        } else {
                            save(&path, &store);
                            let mut items = store.items.clone();
                            items.sort_by(|a, b| a.due_at.cmp(&b.due_at));
                            send(&mut stdout, req.id, Ok(serde_json::json!(items)));
                        }
                    }
                    None => send(&mut stdout, req.id, Err("idが指定されていません".to_string())),
                }
            }

            other => send(&mut stdout, req.id, Err(format!("未知のmethodです: {other}"))),
        }
    }

    eprintln!("[deadline-plugin] 終了します");
}

fn send(stdout: &mut impl Write, id: u64, result: Result<serde_json::Value, String>) {
    let resp = match result {
        Ok(v) => Response { id, result: Some(v), error: None },
        Err(e) => Response { id, result: None, error: Some(e) },
    };
    if let Ok(json) = serde_json::to_string(&resp) {
        let _ = writeln!(stdout, "{json}");
        let _ = stdout.flush();
    }
}
