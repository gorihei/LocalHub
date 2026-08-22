// フォルダサイズ集計プラグイン(サイドカー実行ファイル)。
//
// 指定フォルダ直下の各項目(ファイル/サブフォルダ)の使用容量を集計して
// 大きい順に返す、いわゆる「このフォルダ何が容量食ってるの?」を調べる
// ツール。ホストとは改行区切りJSONの簡易JSON-RPC風プロトコルで通信する。
//
// 任意パスへアクセスするため、ホスト側のmanifest.jsonでは
// requiresPermission: "filesystem:read" を宣言しており、コアが未許可なら
// このプラグインへリクエストを転送する前に拒否する(§10 権限ブローカー)。

use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};
use std::path::Path;

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

/// 全走査ファイル数の上限。C:\のような巨大なドライブをうっかり指定しても
/// 応答がいつまでも返らない(=IPCの5秒タイムアウトに引っかかる)事態を避ける
/// ための安全弁。上限に達したら打ち切り、truncated:trueを返す。
const MAX_ENTRIES_SCANNED: u64 = 200_000;

/// 再帰的にディレクトリの合計サイズを求める。シンボリックリンク/
/// ジャンクションは辿らない(symlink_metadataでリンク自体の情報を見て
/// スキップする)。循環参照によるフリーズを避けるため。
fn dir_size(path: &Path, scanned: &mut u64) -> u64 {
    let mut total = 0u64;
    let Ok(read_dir) = std::fs::read_dir(path) else { return 0 };
    for entry in read_dir.flatten() {
        if *scanned >= MAX_ENTRIES_SCANNED {
            break;
        }
        *scanned += 1;
        let Ok(meta) = entry.metadata() else { continue };
        if entry.path().symlink_metadata().map(|m| m.file_type().is_symlink()).unwrap_or(false) {
            continue;
        }
        if meta.is_dir() {
            total += dir_size(&entry.path(), scanned);
        } else {
            total += meta.len();
        }
    }
    total
}

fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit_idx = 0;
    while value >= 1024.0 && unit_idx < UNITS.len() - 1 {
        value /= 1024.0;
        unit_idx += 1;
    }
    if unit_idx == 0 {
        format!("{bytes} {}", UNITS[0])
    } else {
        format!("{value:.2} {}", UNITS[unit_idx])
    }
}

fn main() {
    eprintln!("[folder-size-plugin] 起動しました (pid={})", std::process::id());

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
                eprintln!("[folder-size-plugin] 不正なリクエストを受信しました: {e}");
                continue;
            }
        };

        match req.method.as_str() {
            "scan" => {
                let path_str = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
                let top_n = req.params.get("topN").and_then(|v| v.as_u64()).unwrap_or(15) as usize;
                let path = Path::new(path_str);

                if path_str.is_empty() {
                    send(&mut stdout, req.id, Err("pathが指定されていません".to_string()));
                    continue;
                }
                if !path.is_dir() {
                    send(&mut stdout, req.id, Err(format!("フォルダが見つかりません: {path_str}")));
                    continue;
                }

                let mut scanned = 0u64;
                let mut entries: Vec<serde_json::Value> = Vec::new();
                let Ok(read_dir) = std::fs::read_dir(path) else {
                    send(&mut stdout, req.id, Err("フォルダの読み取りに失敗しました".to_string()));
                    continue;
                };
                let mut total = 0u64;
                for entry in read_dir.flatten() {
                    let Ok(meta) = entry.metadata() else { continue };
                    let is_symlink = entry.path().symlink_metadata().map(|m| m.file_type().is_symlink()).unwrap_or(false);
                    let bytes = if is_symlink {
                        0
                    } else if meta.is_dir() {
                        dir_size(&entry.path(), &mut scanned)
                    } else {
                        meta.len()
                    };
                    total += bytes;
                    entries.push(serde_json::json!({
                        "name": entry.file_name().to_string_lossy(),
                        "isDir": meta.is_dir(),
                        "bytes": bytes,
                        "bytesFormatted": format_bytes(bytes),
                    }));
                }
                entries.sort_by(|a, b| b["bytes"].as_u64().unwrap_or(0).cmp(&a["bytes"].as_u64().unwrap_or(0)));
                entries.truncate(top_n);

                send(
                    &mut stdout,
                    req.id,
                    Ok(serde_json::json!({
                        "path": path_str,
                        "totalBytes": total,
                        "totalBytesFormatted": format_bytes(total),
                        "entries": entries,
                        "truncated": scanned >= MAX_ENTRIES_SCANNED,
                    })),
                );
            }
            other => send(&mut stdout, req.id, Err(format!("未知のmethodです: {other}"))),
        }
    }

    eprintln!("[folder-size-plugin] 終了します");
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
