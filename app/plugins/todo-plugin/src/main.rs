// ToDoリスト管理プラグイン(サイドカー実行ファイル)。
//
// ホスト(src-tauri)とは標準入出力上の改行区切りJSONでやり取りする、
// 簡易JSON-RPC風プロトコル:
//   リクエスト: {"id": 1, "method": "add", "params": {"title": "牛乳を買う"}}
//   応答:       {"id": 1, "result": {...}}
//   エラー:     {"id": 1, "error": "説明"}
//
// データは自分の実行ファイルと同じフォルダに"todos.json"として保存する。
// ホスト側がどんなカレントディレクトリでこのプロセスを起動しても保存先が
// ブレないよう、std::env::current_exe()から自分の場所を逆算している
// (カレントディレクトリはホストプロセスから引き継がれるだけで、
// プラグインの実行ファイルの場所とは限らないため)。

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
struct Todo {
    id: u64,
    title: String,
    done: bool,
}

/// 全タスクと採番用のnext_idをまとめて1つのJSONファイルに保存する。
/// (idをタスク配列の最大値+1で決めると削除後に番号が再利用されてしまい、
/// 検索結果などで古い参照と衝突しうるため、専用のカウンタを別に持つ)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Store {
    next_id: u64,
    todos: Vec<Todo>,
}

fn data_path() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("todos.json")
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
    eprintln!("[todo-plugin] 起動しました (pid={})", std::process::id());
    let path = data_path();
    let mut store = load(&path);

    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break, // ホスト側がstdinを閉じた = 終了要求
        };
        if line.trim().is_empty() {
            continue;
        }

        let req: Request = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[todo-plugin] 不正なリクエストを受信しました: {e}");
                continue;
            }
        };

        match req.method.as_str() {
            "list" => send(&mut stdout, req.id, Ok(serde_json::json!(store.todos))),

            "add" => {
                let title = req.params.get("title").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
                if title.is_empty() {
                    send(&mut stdout, req.id, Err("タイトルが空です".to_string()));
                } else {
                    let todo = Todo { id: store.next_id, title, done: false };
                    store.next_id += 1;
                    store.todos.push(todo.clone());
                    save(&path, &store);
                    send(&mut stdout, req.id, Ok(serde_json::json!(todo)));
                }
            }

            "complete" => {
                let id = req.params.get("id").and_then(|v| v.as_u64());
                match id.and_then(|id| store.todos.iter_mut().find(|t| t.id == id)) {
                    Some(todo) => {
                        todo.done = true;
                        save(&path, &store);
                        send(&mut stdout, req.id, Ok(serde_json::json!(store.todos)));
                    }
                    None => send(&mut stdout, req.id, Err("指定idのタスクが見つかりません".to_string())),
                }
            }

            "remove" => {
                let id = req.params.get("id").and_then(|v| v.as_u64());
                match id {
                    Some(id) => {
                        let before = store.todos.len();
                        store.todos.retain(|t| t.id != id);
                        if store.todos.len() == before {
                            send(&mut stdout, req.id, Err("指定idのタスクが見つかりません".to_string()));
                        } else {
                            save(&path, &store);
                            send(&mut stdout, req.id, Ok(serde_json::json!(store.todos)));
                        }
                    }
                    None => send(&mut stdout, req.id, Err("idが指定されていません".to_string())),
                }
            }

            // ダッシュボードウィジェット用: 未完了件数と直近3件のタイトルだけを
            // まとめたコンパクトな文字列を返す(汎用ウィジェットはテキスト表示のみ)。
            "summary" => {
                let open: Vec<&Todo> = store.todos.iter().filter(|t| !t.done).collect();
                let preview: Vec<String> = open.iter().take(3).map(|t| format!("・{}", t.title)).collect();
                let text = if open.is_empty() {
                    "未完了のタスクはありません".to_string()
                } else {
                    format!("未完了 {}件\n{}", open.len(), preview.join("\n"))
                };
                send(&mut stdout, req.id, Ok(serde_json::json!(text)));
            }

            // 横断検索連携: タイトルに部分一致するタスクを返す。
            "search" => {
                let query = req.params.get("query").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
                let results: Vec<serde_json::Value> = store
                    .todos
                    .iter()
                    .filter(|t| query.is_empty() || t.title.to_lowercase().contains(&query))
                    .map(|t| {
                        serde_json::json!({
                            "title": t.title,
                            "subtitle": if t.done { "完了済み" } else { "未完了" },
                        })
                    })
                    .collect();
                send(&mut stdout, req.id, Ok(serde_json::json!(results)));
            }

            other => send(&mut stdout, req.id, Err(format!("未知のmethodです: {other}"))),
        }
    }

    eprintln!("[todo-plugin] 終了します");
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
