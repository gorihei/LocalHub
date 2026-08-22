// DeepL API Free翻訳プラグイン。APIキーはプラグイン自身では永続化せず、
// ホストがWindows資格情報マネージャーから読み出してRPC contextへ注入する。
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};

#[derive(Deserialize)]
struct Request {
    id: u64,
    method: String,
    #[serde(default)]
    params: serde_json::Value,
    #[serde(default)]
    context: serde_json::Value,
}

#[derive(Serialize)]
struct Response {
    id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn api_key(request: &Request) -> Result<&str, String> {
    request
        .context
        .get("secrets")
        .and_then(|v| v.get("deepl-api-key"))
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| "API_KEY_NOT_CONFIGURED: DeepL APIキーを設定してください".to_string())
}

fn translate(request: &Request) -> Result<serde_json::Value, String> {
    let key = api_key(request)?;
    let text = request.params.get("text").and_then(|v| v.as_str()).unwrap_or("").trim();
    let target = request.params.get("targetLang").and_then(|v| v.as_str()).unwrap_or("JA");
    if text.is_empty() {
        return Err("TEXT_REQUIRED: 翻訳する文章を入力してください".to_string());
    }
    if text.chars().count() > 20_000 {
        return Err("TEXT_TOO_LONG: 一度に翻訳できるのは20,000文字までです".to_string());
    }

    let mut form = vec![("text", text), ("target_lang", target)];
    if let Some(source) = request.params.get("sourceLang").and_then(|v| v.as_str()).filter(|v| !v.is_empty()) {
        form.push(("source_lang", source));
    }
    let response = ureq::post("https://api-free.deepl.com/v2/translate")
        .set("Authorization", &format!("DeepL-Auth-Key {key}"))
        .send_form(&form)
        .map_err(normalize_http_error)?;
    let body = response.into_string().map_err(|e| format!("PROVIDER_ERROR: 応答を読み取れませんでした: {e}"))?;
    let json: serde_json::Value = serde_json::from_str(&body).map_err(|e| format!("PROVIDER_ERROR: 応答を解析できませんでした: {e}"))?;
    let first = json.get("translations").and_then(|v| v.as_array()).and_then(|v| v.first()).ok_or("PROVIDER_ERROR: 翻訳結果がありません")?;
    Ok(serde_json::json!({
        "translatedText": first.get("text").and_then(|v| v.as_str()).unwrap_or(""),
        "detectedSourceLanguage": first.get("detected_source_language").and_then(|v| v.as_str()),
        "provider": "deepl-free",
        "characterCount": text.chars().count()
    }))
}

fn test_connection(request: &Request) -> Result<serde_json::Value, String> {
    let key = api_key(request)?;
    let response = ureq::get("https://api-free.deepl.com/v2/usage")
        .set("Authorization", &format!("DeepL-Auth-Key {key}"))
        .call()
        .map_err(normalize_http_error)?;
    let body = response.into_string().map_err(|e| format!("PROVIDER_ERROR: 応答を読み取れませんでした: {e}"))?;
    let json: serde_json::Value = serde_json::from_str(&body).map_err(|e| format!("PROVIDER_ERROR: 応答を解析できませんでした: {e}"))?;
    Ok(json)
}

fn normalize_http_error(error: ureq::Error) -> String {
    match error {
        ureq::Error::Status(403, _) => "API_KEY_INVALID: DeepL APIキーが正しくありません".to_string(),
        ureq::Error::Status(429, _) => "RATE_LIMITED: リクエスト回数の上限に達しました".to_string(),
        ureq::Error::Status(456, _) => "MONTHLY_LIMIT_REACHED: 今月の利用上限に達しました".to_string(),
        ureq::Error::Status(code, _) => format!("PROVIDER_ERROR: DeepL APIがエラーを返しました({code})"),
        ureq::Error::Transport(_) => "NETWORK_UNAVAILABLE: DeepL APIへ接続できませんでした".to_string(),
    }
}

fn main() {
    eprintln!("[translate-plugin] 起動しました (pid={})", std::process::id());
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    for line in stdin.lock().lines().map_while(Result::ok) {
        if line.trim().is_empty() { continue; }
        let request: Request = match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(error) => { eprintln!("[translate-plugin] 不正なリクエスト: {error}"); continue; }
        };
        let result = match request.method.as_str() {
            "translate" => translate(&request),
            "test_connection" => test_connection(&request),
            other => Err(format!("未知のmethodです: {other}")),
        };
        let response = match result {
            Ok(value) => Response { id: request.id, result: Some(value), error: None },
            Err(error) => Response { id: request.id, result: None, error: Some(error) },
        };
        if let Ok(json) = serde_json::to_string(&response) {
            let _ = writeln!(stdout, "{json}");
            let _ = stdout.flush();
        }
    }
}
