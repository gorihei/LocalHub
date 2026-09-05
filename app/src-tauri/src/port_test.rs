use serde::Serialize;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortTestResult {
    host: String,
    port: u16,
    reachable: bool,
    latency_ms: Option<u128>,
    remote_address: Option<String>,
    error: Option<String>,
}

/// 指定ホスト・ポートへTCP接続を試す。ブラウザから任意TCPソケットは扱えないため、
/// ネットワーク処理だけをコア側へ置き、結果には接続可否と接続先アドレスだけを返す。
#[tauri::command]
pub async fn tcp_port_test(
    host: String,
    port: u16,
    timeout_ms: u64,
) -> Result<PortTestResult, String> {
    let host = host.trim().to_string();
    if host.is_empty() {
        return Err("ホスト名またはIPアドレスを入力してください".to_string());
    }
    if host.len() > 253 || host.contains(['/', '\\', ' ']) {
        return Err("ホスト名またはIPアドレスの形式が正しくありません".to_string());
    }
    if port == 0 {
        return Err("ポート番号は1〜65535で指定してください".to_string());
    }
    let timeout_ms = timeout_ms.clamp(100, 10_000);

    tauri::async_runtime::spawn_blocking(move || {
        let addresses: Vec<_> = (host.as_str(), port)
            .to_socket_addrs()
            .map_err(|error| format!("名前解決に失敗しました: {error}"))?
            .collect();
        if addresses.is_empty() {
            return Err("名前解決結果がありません".to_string());
        }

        let timeout = Duration::from_millis(timeout_ms);
        let start = Instant::now();
        let mut last_error = None;
        for socket_address in addresses {
            match TcpStream::connect_timeout(&socket_address, timeout) {
                Ok(stream) => {
                    let remote_address = stream.peer_addr().ok().map(|value| value.to_string());
                    return Ok(PortTestResult {
                        host,
                        port,
                        reachable: true,
                        latency_ms: Some(start.elapsed().as_millis()),
                        remote_address,
                        error: None,
                    });
                }
                Err(error) => last_error = Some(error.to_string()),
            }
        }

        Ok(PortTestResult {
            host,
            port,
            reachable: false,
            latency_ms: None,
            remote_address: None,
            error: last_error,
        })
    })
    .await
    .map_err(|error| format!("疎通確認処理に失敗しました: {error}"))?
}
