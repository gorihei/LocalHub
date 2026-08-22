// 天気ウィジェットプラグイン(サイドカー実行ファイル)。
//
// Open-Meteo(https://open-meteo.com/)はAPIキー不要・無料の天気APIなので、
// 個人用ツールにちょうどよい。地名から緯度経度を引く「ジオコーディングAPI」と、
// 緯度経度から現在の気象を取得する「予報API」の2段階で呼ぶ。
//
// 一度検索して選んだ地点は自分の実行ファイルと同じフォルダに"location.json"として
// 保存し、次回以降はジオコーディングをやり直さずに済むようにしている
// (todo-plugin/git-status-pluginと同じ「自分の実行ファイルの隣に保存」パターン)。
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
struct Location {
    name: String,
    #[serde(rename = "admin1", default)]
    admin1: String,
    #[serde(default)]
    country: String,
    latitude: f64,
    longitude: f64,
}

fn location_path() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("location.json")
}

fn load_location() -> Option<Location> {
    let text = std::fs::read_to_string(location_path()).ok()?;
    serde_json::from_str(&text).ok()
}

fn save_location(loc: &Location) {
    if let Ok(json) = serde_json::to_string_pretty(loc) {
        let _ = std::fs::write(location_path(), json);
    }
}

fn http_get_json(url: &str) -> Result<serde_json::Value, String> {
    let response = ureq::get(url).call().map_err(|e| format!("通信に失敗しました: {e}"))?;
    let text = response.into_string().map_err(|e| format!("応答の読み取りに失敗しました: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("応答の解析に失敗しました: {e}"))
}

fn search_location(query: &str) -> Result<serde_json::Value, String> {
    let url = format!(
        "https://geocoding-api.open-meteo.com/v1/search?name={}&count=8&language=ja&format=json",
        urlencoding_light(query)
    );
    let json = http_get_json(&url)?;
    let results = json.get("results").cloned().unwrap_or_else(|| serde_json::json!([]));
    Ok(results)
}

fn get_weather(loc: &Location) -> Result<serde_json::Value, String> {
    let url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={}&longitude={}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&timezone=auto",
        loc.latitude, loc.longitude
    );
    let json = http_get_json(&url)?;
    let current = json.get("current").cloned().ok_or("予報データの形式が不正です".to_string())?;
    Ok(serde_json::json!({
        "location": loc,
        "temperature": current.get("temperature_2m"),
        "weatherCode": current.get("weather_code"),
        "windSpeed": current.get("wind_speed_10m"),
        "humidity": current.get("relative_humidity_2m"),
    }))
}

/// クエリパラメータ用の最小限のURLエンコード(地名検索なので日本語・スペースだけ
/// 扱えれば十分。追加クレートを避けるための簡易実装)。
fn urlencoding_light(s: &str) -> String {
    let mut out = String::new();
    for byte in s.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(*byte as char),
            _ => out.push_str(&format!("%{:02X}", byte)),
        }
    }
    out
}

fn main() {
    eprintln!("[weather-plugin] 起動しました (pid={})", std::process::id());

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
                eprintln!("[weather-plugin] 不正なリクエストを受信しました: {e}");
                continue;
            }
        };

        let result: Result<serde_json::Value, String> = match req.method.as_str() {
            "search_location" => {
                let query = req.params.get("query").and_then(|v| v.as_str()).unwrap_or("");
                if query.trim().is_empty() {
                    Err("検索語が空です".to_string())
                } else {
                    search_location(query)
                }
            }
            "set_location" => match serde_json::from_value::<Location>(req.params.clone()) {
                Ok(loc) => {
                    save_location(&loc);
                    Ok(serde_json::json!(loc))
                }
                Err(e) => Err(format!("地点情報の形式が不正です: {e}")),
            },
            "get_location" => Ok(serde_json::json!(load_location())),
            "get_weather" => match load_location() {
                Some(loc) => get_weather(&loc),
                None => Err("地点が設定されていません。まず場所を検索してください。".to_string()),
            },
            other => Err(format!("未知のmethodです: {other}")),
        };
        send(&mut stdout, req.id, result);
    }

    eprintln!("[weather-plugin] 終了します");
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
