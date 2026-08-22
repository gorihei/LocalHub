// スタートアップ管理プラグイン(サイドカー実行ファイル)。
//
// Windowsログイン時に自動実行されるプログラムを一覧表示・無効化する。
// 収集元は2種類:
//   1. レジストリ Run キー(HKCU/HKLM の
//      Software\Microsoft\Windows\CurrentVersion\Run)を`reg query`で読む
//   2. スタートアップフォルダ(ユーザー個別 / 全ユーザー共通)のショートカット一覧
//
// 無効化はsourceによって手段が異なる:
//   - registry-hkcu: `reg delete`でユーザースコープの値を削除(管理者権限不要)
//   - registry-hklm: 同様にHKLM側を削除しようと試みるが、管理者権限がない場合は
//     失敗する(エラーをそのまま返す。無理に昇格要求はしない)
//   - startup-folder-*: ショートカットファイル自体を削除する(元に戻せない)
// いずれも取り消せない操作なので、ホスト側のUI(ui/index.html)で必ず確認
// ダイアログを挟んだ上で呼び出す想定(manifest.jsonでriskLevel: 2にしている)。
//
// ホストとは改行区切りJSONの簡易JSON-RPC風プロトコルで通信する。

use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Deserialize)]
struct Request {
    id: u64,
    method: String,
    #[serde(default)]
    params: serde_json::Value,
}

fn registry_key_for_source(source: &str) -> Option<&'static str> {
    match source {
        "registry-hkcu" => Some(r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run"),
        "registry-hklm" => Some(r"HKLM\Software\Microsoft\Windows\CurrentVersion\Run"),
        _ => None,
    }
}

#[derive(Serialize)]
struct Response {
    id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// `reg query "<key>"`の出力をパースする。典型的な出力は以下の形式:
/// ```text
/// HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run
///     OneDrive    REG_SZ    "C:\Users\...\OneDrive.exe" /background
/// ```
/// 値(name)にスペースが含まれる場合、この簡易パーサーは正しく分割できない
/// (space区切りで最初のトークンだけをnameとみなすため)。完全なレジストリ
/// パーサーを書くよりシンプルさを優先した既知の制限。
fn parse_reg_query(output: &str, source: &str) -> Vec<serde_json::Value> {
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
        let value = rest[type_end..].trim_start().to_string();
        entries.push(serde_json::json!({ "source": source, "name": name, "value": value }));
    }
    entries
}

fn query_registry_run(hive_arg: &str, source: &str) -> Vec<serde_json::Value> {
    let mut cmd = Command::new("reg");
    cmd.args(["query", hive_arg]);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    match cmd.output() {
        Ok(output) if output.status.success() => parse_reg_query(&String::from_utf8_lossy(&output.stdout), source),
        _ => Vec::new(),
    }
}

fn list_startup_folder(dir: &str, source: &str) -> Vec<serde_json::Value> {
    let mut entries = Vec::new();
    if let Ok(read_dir) = std::fs::read_dir(dir) {
        for entry in read_dir.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.eq_ignore_ascii_case("desktop.ini") {
                continue;
            }
            entries.push(serde_json::json!({ "source": source, "name": name, "value": entry.path().to_string_lossy() }));
        }
    }
    entries
}

fn list_all() -> serde_json::Value {
    let mut entries = Vec::new();
    entries.extend(query_registry_run(r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run", "registry-hkcu"));
    entries.extend(query_registry_run(r"HKLM\Software\Microsoft\Windows\CurrentVersion\Run", "registry-hklm"));

    if let Ok(appdata) = std::env::var("APPDATA") {
        entries.extend(list_startup_folder(
            &format!(r"{appdata}\Microsoft\Windows\Start Menu\Programs\Startup"),
            "startup-folder-user",
        ));
    }
    let program_data = std::env::var("PROGRAMDATA").unwrap_or_else(|_| r"C:\ProgramData".to_string());
    entries.extend(list_startup_folder(
        &format!(r"{program_data}\Microsoft\Windows\Start Menu\Programs\Startup"),
        "startup-folder-common",
    ));

    serde_json::json!(entries)
}

fn disable_entry(source: &str, name: &str, value: &str) -> Result<serde_json::Value, String> {
    if let Some(key) = registry_key_for_source(source) {
        let mut cmd = Command::new("reg");
        cmd.args(["delete", key, "/v", name, "/f"]);
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let output = cmd.output().map_err(|e| format!("reg.exeの起動に失敗しました: {e}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        return Ok(serde_json::json!({ "source": source, "name": name }));
    }

    if source.starts_with("startup-folder") {
        // valueはlist_startup_folderが返したファイルの絶対パスそのもの。
        std::fs::remove_file(value).map_err(|e| format!("ファイルの削除に失敗しました: {e}"))?;
        return Ok(serde_json::json!({ "source": source, "name": name }));
    }

    Err(format!("未知のsourceです: {source}"))
}

fn main() {
    eprintln!("[startup-plugin] 起動しました (pid={})", std::process::id());

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
                eprintln!("[startup-plugin] 不正なリクエストを受信しました: {e}");
                continue;
            }
        };

        let result: Result<serde_json::Value, String> = match req.method.as_str() {
            "list" => Ok(list_all()),
            "disable" => {
                let source = req.params.get("source").and_then(|v| v.as_str()).unwrap_or("");
                let name = req.params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let value = req.params.get("value").and_then(|v| v.as_str()).unwrap_or("");
                disable_entry(source, name, value)
            }
            other => Err(format!("未知のmethodです: {other}")),
        };
        send(&mut stdout, req.id, result);
    }

    eprintln!("[startup-plugin] 終了します");
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
