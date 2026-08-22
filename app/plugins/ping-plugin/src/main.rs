// ネットワーク疎通確認プラグイン(サイドカー実行ファイル)。
//
// 本物のICMP ping はWindowsで生ソケット(管理者権限相当)が必要になり
// 個人用デスクトップアプリのプラグインとしては重すぎるため、代わりに
// 「指定ホストの指定ポートへTCP接続を試みて、成功するか・何msかかるか」
// を計測する簡易版にしている。Webサービスの死活監視や自宅サーバーの
// ポート開放確認など、実用上はこちらの方が使い勝手が良いことが多い。
//
// ホストとは改行区切りJSONの簡易JSON-RPC風プロトコルで通信する。

use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};
use std::net::ToSocketAddrs;
use std::time::{Duration, Instant};

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

/// "host:port"形式へTCP接続を試み、可否と所要時間(ms)を返す。
fn check_one(host: &str, port: u16, timeout_ms: u64) -> serde_json::Value {
    let addr = format!("{host}:{port}");
    let resolved = addr.to_socket_addrs().ok().and_then(|mut it| it.next());
    let Some(socket_addr) = resolved else {
        return serde_json::json!({
            "host": host, "port": port, "reachable": false, "latencyMs": null,
            "error": "名前解決に失敗しました",
        });
    };

    let start = Instant::now();
    match std::net::TcpStream::connect_timeout(&socket_addr, Duration::from_millis(timeout_ms)) {
        Ok(_) => serde_json::json!({
            "host": host, "port": port, "reachable": true,
            "latencyMs": start.elapsed().as_millis(), "error": null,
        }),
        Err(e) => serde_json::json!({
            "host": host, "port": port, "reachable": false, "latencyMs": null,
            "error": e.to_string(),
        }),
    }
}

fn main() {
    eprintln!("[ping-plugin] 起動しました (pid={})", std::process::id());

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
                eprintln!("[ping-plugin] 不正なリクエストを受信しました: {e}");
                continue;
            }
        };

        match req.method.as_str() {
            "check" => {
                let host = req.params.get("host").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let port = req.params.get("port").and_then(|v| v.as_u64()).unwrap_or(443) as u16;
                let timeout_ms = req.params.get("timeoutMs").and_then(|v| v.as_u64()).unwrap_or(2000);
                if host.is_empty() {
                    send(&mut stdout, req.id, Err("hostが指定されていません".to_string()));
                } else {
                    send(&mut stdout, req.id, Ok(check_one(&host, port, timeout_ms)));
                }
            }

            // ダッシュボードウィジェット用: よく使う既知の疎通確認先を
            // まとめてチェックし、結果を1行の要約テキストにして返す。
            "summary" => {
                const TARGETS: [(&str, u16); 2] = [("1.1.1.1", 443), ("8.8.8.8", 443)];
                let results: Vec<(&str, bool, u128)> = TARGETS
                    .iter()
                    .map(|(host, port)| {
                        let r = check_one(host, *port, 1500);
                        let reachable = r["reachable"].as_bool().unwrap_or(false);
                        let latency = r["latencyMs"].as_u64().unwrap_or(0) as u128;
                        (*host, reachable, latency)
                    })
                    .collect();
                let lines: Vec<String> = results
                    .iter()
                    .map(|(host, ok, ms)| if *ok { format!("○ {host} ({ms}ms)") } else { format!("× {host} 到達不可") })
                    .collect();
                send(&mut stdout, req.id, Ok(serde_json::json!(lines.join("\n"))));
            }

            other => send(&mut stdout, req.id, Err(format!("未知のmethodです: {other}"))),
        }
    }

    eprintln!("[ping-plugin] 終了します");
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
