// §6.12 システムモニター(公式プラグイン扱いだが、MVPではコアに同梱する)。
// MVP必須はCPU/RAM/ストレージのみ(§6.12)。
//
// CPU使用率は前回計測との差分で算出される(sysinfoの仕様)ため、Systemを
// 使い回して2回目以降の呼び出しから正確な値になるようにしている
// (毎回new_allすると常に差分ゼロになってしまう)。

use serde::Serialize;
use std::sync::Mutex;
use sysinfo::{Disks, Networks, System};

/// ネットワークの送受信量もCPU%と同じく前回計測との差分で算出されるため
/// (sysinfoの仕様)、Systemと同様にNetworksも使い回して2回目以降の呼び出し
/// から正確な値になるようにしている。
pub struct SystemState {
    sys: Mutex<System>,
    networks: Mutex<Networks>,
}

impl Default for SystemState {
    fn default() -> Self {
        let mut sys = System::new_all();
        sys.refresh_cpu_all();
        sys.refresh_memory();
        Self { sys: Mutex::new(sys), networks: Mutex::new(Networks::new()) }
    }
}

#[derive(Serialize)]
pub struct SystemStats {
    pub cpu_percent: f32,
    pub mem_used_bytes: u64,
    pub mem_total_bytes: u64,
    pub disk_used_bytes: u64,
    pub disk_total_bytes: u64,
    // MVP必須ではないが(§6.12)、システム状態ウィジェットの余白を埋める
    // 実用的な追加情報として稼働時間を返す。System::uptime()はOS起動からの
    // 経過秒数を返す静的関数で、Systemインスタンスの状態には依存しない。
    pub uptime_secs: u64,
    /// 前回呼び出しからの受信/送信バイト数(全ネットワークインターフェース合計)。
    pub net_received_bytes: u64,
    pub net_transmitted_bytes: u64,
}

#[tauri::command]
pub fn system_stats(state: tauri::State<SystemState>) -> SystemStats {
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_cpu_all();
    sys.refresh_memory();

    let disks = Disks::new_with_refreshed_list();
    let (disk_total, disk_available) = disks
        .list()
        .iter()
        .fold((0u64, 0u64), |(total, available), d| (total + d.total_space(), available + d.available_space()));

    let mut networks = state.networks.lock().unwrap();
    networks.refresh(true);
    let (net_received, net_transmitted) = networks
        .iter()
        .fold((0u64, 0u64), |(rx, tx), (_name, data)| (rx + data.received(), tx + data.transmitted()));

    SystemStats {
        cpu_percent: sys.global_cpu_usage(),
        mem_used_bytes: sys.used_memory(),
        mem_total_bytes: sys.total_memory(),
        disk_used_bytes: disk_total.saturating_sub(disk_available),
        disk_total_bytes: disk_total,
        uptime_secs: System::uptime(),
        net_received_bytes: net_received,
        net_transmitted_bytes: net_transmitted,
    }
}
