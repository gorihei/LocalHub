// §6.12 プロセス・ポート監視(その他の公式プラグイン、v1)。
// 「プロセス検索、リソース表示、使用中ポートとの対応、実行ファイル位置表示を
// 提供する。終了操作は対象PID、名前、影響を確認する」の実装。
//
// CPU%はsysinfoの仕様で前回計測との差分になるため、Systemを使い回して
// 2回目以降の呼び出しから正確な値になるようにしている(system.rsと同じパターン)。
//
// ポートとプロセスの対応は、sysinfoにはその機能が無いため`netstat -ano`の
// 出力を解析して得ている(Windows標準コマンド、追加の権限は不要)。

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use sysinfo::{Pid, System};

pub struct ProcessState(Mutex<System>);

impl Default for ProcessState {
    fn default() -> Self {
        Self(Mutex::new(System::new_all()))
    }
}

#[derive(Serialize)]
pub struct ProcessInfo {
    pid: u32,
    name: String,
    cpu_percent: f32,
    mem_bytes: u64,
    exe_path: Option<String>,
    ports: Vec<u16>,
}

/// `netstat -ano`を実行し、PID→使用中ポート(TCP/UDP)のマップを作る。
/// 1行の形式(概ね): "  TCP    0.0.0.0:135   0.0.0.0:0   LISTENING   1234"
/// UDPはState列が無く列数が1つ少ない。末尾が必ずPIDなので、末尾とLocal
/// Address列(2列目)だけを見れば十分。
fn port_map() -> HashMap<u32, Vec<u16>> {
    let mut map: HashMap<u32, Vec<u16>> = HashMap::new();
    let Ok(output) = std::process::Command::new("netstat").args(["-ano"]).output() else {
        return map;
    };
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 4 {
            continue;
        }
        if parts[0] != "TCP" && parts[0] != "UDP" {
            continue;
        }
        let Ok(pid) = parts[parts.len() - 1].parse::<u32>() else { continue };
        let Some(port_str) = parts[1].rsplit(':').next() else { continue };
        let Ok(port) = port_str.parse::<u16>() else { continue };
        map.entry(pid).or_default().push(port);
    }
    for ports in map.values_mut() {
        ports.sort_unstable();
        ports.dedup();
    }
    map
}

#[tauri::command]
pub fn processes_list(state: tauri::State<ProcessState>) -> Vec<ProcessInfo> {
    let mut sys = state.0.lock().unwrap();
    sys.refresh_all();
    let ports = port_map();

    let mut list: Vec<ProcessInfo> = sys
        .processes()
        .iter()
        .map(|(pid, proc)| {
            let pid_u32 = pid.as_u32();
            ProcessInfo {
                pid: pid_u32,
                name: proc.name().to_string_lossy().to_string(),
                cpu_percent: proc.cpu_usage(),
                mem_bytes: proc.memory(),
                exe_path: proc.exe().map(|p| p.to_string_lossy().to_string()),
                ports: ports.get(&pid_u32).cloned().unwrap_or_default(),
            }
        })
        .collect();
    list.sort_by(|a, b| b.mem_bytes.cmp(&a.mem_bytes));
    list
}

/// §10.3準拠: 終了操作はフロント側のConfirmDialogで対象PID・名前・影響を
/// 表示してから呼ばれる想定(コマンドバスのrisk_level=2として登録)。
#[tauri::command]
pub fn process_kill(state: tauri::State<ProcessState>, pid: u32) -> Result<(), String> {
    let sys = state.0.lock().unwrap();
    match sys.process(Pid::from_u32(pid)) {
        Some(p) => {
            if p.kill() {
                Ok(())
            } else {
                Err("終了に失敗しました(権限が必要な可能性があります)".to_string())
            }
        }
        None => Err("プロセスが見つかりません(既に終了している可能性があります)".to_string()),
    }
}
