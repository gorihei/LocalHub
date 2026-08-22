// 環境変数・PATHビューア/エディタプラグイン(サイドカー実行ファイル)。
//
// 開発中に「このPATHエントリ本当に存在するの?」「重複してない?」を目視確認し、
// 必要なら直接編集できるようにするツール。
//
// 編集はユーザースコープ(レジストリ HKCU\Environment)のみを対象にする。
// システムスコープ(HKLM側)は管理者権限が必要な上、他の全ユーザーに影響する
// 変更のため意図的に対象外にしている。また"Path"自体をdelete_user_envで
// 丸ごと消してしまうと致命的なので、専用のset_user_pathを使うよう案内し、
// delete側では名前を弾く安全策を入れている。
//
// レジストリの変更は`reg.exe`を子プロセスとして呼び出す方式(生のレジストリAPIを
// バインディングなしで叩くより、追加クレートが要らずシンプル)。書き換え後は
// 新しく起動するプロセスから有効になるが、現在ログイン中のシェルやエクスプローラー
// には反映されないことがある(WM_SETTINGCHANGEのブロードキャストは行っていない)。
// この制限はUI側で明示している。
//
// 環境変数にはAPIキー等の機密情報が入っていることもあるため、マスク表示の判断は
// UI側(ui/index.html)で行う。ホストとは改行区切りJSONの簡易JSON-RPC風
// プロトコルで通信する。

use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};
use std::path::Path;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const USER_ENV_KEY: &str = r"HKCU\Environment";

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

fn run_reg(args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("reg");
    cmd.args(args);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output().map_err(|e| format!("reg.exeの起動に失敗しました: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// `reg query "<key>"`(値名指定なし=キー全体)の出力をパースする。
/// startup-pluginと同じ簡易パーサー: 値名にスペースを含む場合は正しく
/// 分割できない既知の制限がある。
fn parse_reg_query_all(output: &str) -> Vec<(String, String, String)> {
    let mut entries = Vec::new();
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("HKEY") {
            continue;
        }
        let mut parts = trimmed.splitn(3, char::is_whitespace);
        let Some(name) = parts.next() else { continue };
        let rest = trimmed[name.len()..].trim_start();
        let Some(type_end) = rest.find(char::is_whitespace) else { continue };
        let reg_type = rest[..type_end].to_string();
        let value = rest[type_end..].trim_start().to_string();
        entries.push((name.to_string(), reg_type, value));
    }
    entries
}

fn list_env() -> serde_json::Value {
    let mut vars: Vec<(String, String)> = std::env::vars().collect();
    vars.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    serde_json::json!(vars
        .into_iter()
        .map(|(name, value)| serde_json::json!({ "name": name, "value": value }))
        .collect::<Vec<_>>())
}

/// WindowsのPATHは`;`区切り。存在しないエントリ・重複エントリを検出しておくと
/// UI側で警告表示するだけで使える。(現在のプロセスが引き継いだPATH=既に展開済み
/// のものを見ているだけの読み取り専用ビュー。編集は get_user_path/set_user_path
/// でレジストリ上の生の値を直接扱う)
fn path_entries() -> serde_json::Value {
    let raw = std::env::var("PATH").unwrap_or_default();
    let mut seen = std::collections::HashSet::new();
    let entries: Vec<serde_json::Value> = raw
        .split(';')
        .filter(|s| !s.is_empty())
        .map(|entry| {
            let exists = Path::new(entry).is_dir();
            let is_duplicate = !seen.insert(entry.to_lowercase());
            serde_json::json!({ "path": entry, "exists": exists, "isDuplicate": is_duplicate })
        })
        .collect();
    serde_json::json!(entries)
}

fn list_user_registry_env() -> Result<serde_json::Value, String> {
    let output = run_reg(&["query", USER_ENV_KEY]).unwrap_or_default();
    let mut entries = parse_reg_query_all(&output);
    entries.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    Ok(serde_json::json!(entries
        .into_iter()
        .map(|(name, reg_type, value)| serde_json::json!({ "name": name, "type": reg_type, "value": value }))
        .collect::<Vec<_>>()))
}

fn get_user_path() -> Result<serde_json::Value, String> {
    let output = run_reg(&["query", USER_ENV_KEY, "/v", "Path"]);
    match output {
        Ok(out) => {
            let entries = parse_reg_query_all(&out);
            match entries.into_iter().find(|(name, _, _)| name.eq_ignore_ascii_case("path")) {
                Some((_, reg_type, value)) => Ok(serde_json::json!({ "value": value, "type": reg_type })),
                None => Ok(serde_json::json!({ "value": "", "type": "REG_EXPAND_SZ" })),
            }
        }
        // ユーザースコープにPathが未設定(システムPATHのみ使用中)なケースもエラーではない。
        Err(_) => Ok(serde_json::json!({ "value": "", "type": "REG_EXPAND_SZ" })),
    }
}

fn set_user_path(value: &str) -> Result<serde_json::Value, String> {
    run_reg(&["add", USER_ENV_KEY, "/v", "Path", "/t", "REG_EXPAND_SZ", "/d", value, "/f"])
        .map(|_| serde_json::json!({ "value": value }))
}

fn set_user_env(name: &str, value: &str) -> Result<serde_json::Value, String> {
    if name.trim().is_empty() {
        return Err("変数名が空です".to_string());
    }
    run_reg(&["add", USER_ENV_KEY, "/v", name, "/t", "REG_SZ", "/d", value, "/f"]).map(|_| serde_json::json!({ "name": name, "value": value }))
}

fn delete_user_env(name: &str) -> Result<serde_json::Value, String> {
    if name.eq_ignore_ascii_case("path") {
        return Err("PATHは専用の編集画面から変更してください(丸ごと削除すると起動に支障が出るため)".to_string());
    }
    run_reg(&["delete", USER_ENV_KEY, "/v", name, "/f"]).map(|_| serde_json::json!({ "name": name }))
}

fn main() {
    eprintln!("[env-viewer-plugin] 起動しました (pid={})", std::process::id());

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
                eprintln!("[env-viewer-plugin] 不正なリクエストを受信しました: {e}");
                continue;
            }
        };

        let result: Result<serde_json::Value, String> = match req.method.as_str() {
            "list_env" => Ok(list_env()),
            "path_entries" => Ok(path_entries()),
            "list_user_registry_env" => list_user_registry_env(),
            "get_user_path" => get_user_path(),
            "set_user_path" => {
                let value = req.params.get("value").and_then(|v| v.as_str()).unwrap_or("");
                set_user_path(value)
            }
            "set_user_env" => {
                let name = req.params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let value = req.params.get("value").and_then(|v| v.as_str()).unwrap_or("");
                set_user_env(name, value)
            }
            "delete_user_env" => {
                let name = req.params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                delete_user_env(name)
            }
            other => Err(format!("未知のmethodです: {other}")),
        };
        send(&mut stdout, req.id, result);
    }

    eprintln!("[env-viewer-plugin] 終了します");
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
