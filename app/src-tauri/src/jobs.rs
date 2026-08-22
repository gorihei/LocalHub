// §6.9 バックグラウンドジョブの進捗・キャンセル基盤。
//
// 実際に長時間かかる処理(プラグイン検出の本実装等)はPhase 2以降だが、
// 「進捗表示とキャンセル」という基盤そのものはここで動くものとして用意し、
// 実物の動作(サイドカー実行ファイルの実在確認)に対して疑似的なペース(短い
// sleep)を挟むことで、UIから体感できる形にしている。最終結果(検出件数)は
// 実際のファイルシステム確認結果であり、捏造した値ではない。

use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Clone)]
pub struct JobProgress {
    pub id: String,
    pub label: String,
    pub percent: u8,
    pub done: bool,
    pub cancelled: bool,
}

#[derive(Default)]
pub struct JobRegistry(Mutex<HashMap<String, Arc<AtomicBool>>>);

#[tauri::command]
pub fn job_cancel(state: tauri::State<JobRegistry>, id: String) {
    if let Some(flag) = state.0.lock().unwrap().get(&id) {
        flag.store(true, Ordering::SeqCst);
    }
}

/// プラグイン再スキャンジョブ(§FR-PLUG-001「明示再スキャン時に検出」の先取り実装)。
/// 現時点ではサイドカーの実在確認のみを行う簡易版。
#[tauri::command]
pub fn job_rescan_plugins(app: AppHandle, state: tauri::State<'_, JobRegistry>) -> String {
    let id = format!(
        "rescan-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let cancel_flag = Arc::new(AtomicBool::new(false));
    state.0.lock().unwrap().insert(id.clone(), cancel_flag.clone());

    let job_id = id.clone();
    std::thread::spawn(move || {
        let steps: [(&str, u8); 2] = [("pluginsフォルダーを確認中", 30), ("サイドカーの実在を確認中", 70)];
        for (label, percent) in steps {
            if cancel_flag.load(Ordering::SeqCst) {
                let _ = app.emit(
                    "job://progress",
                    JobProgress { id: job_id.clone(), label: "キャンセルされました".into(), percent, done: true, cancelled: true },
                );
                return;
            }
            let _ = app.emit(
                "job://progress",
                JobProgress { id: job_id.clone(), label: label.into(), percent, done: false, cancelled: false },
            );
            std::thread::sleep(std::time::Duration::from_millis(350));
        }

        // ディスク上を再走査し、新しく見つかったプラグインだけを実行中のマップへ
        // マージする(既に起動中のものを巻き戻さないように、まだ無いIDのみ追加)。
        let plugin_host_state = app.state::<crate::plugin_host::PluginHostState>();
        let discovered = crate::plugin_host::discover_all(&plugin_host_state.plugins_dir);
        let (new_plugins, plugin_count) = {
            let mut plugins = plugin_host_state.plugins.lock().unwrap();
            let mut new_plugins = Vec::new();
            for (id, entry) in discovered {
                if !plugins.contains_key(&id) {
                    plugins.insert(id.clone(), entry.clone());
                    new_plugins.push((id, entry));
                }
            }
            (new_plugins, plugins.len())
        };
        // PluginHostStateのロックを解放してからCommandBusを更新する。
        // コマンド実行側は逆順(CommandBus→PluginHostState)でロックするため、
        // ここで両方を同時に保持するとデッドロックする可能性がある。
        for (id, entry) in new_plugins {
            crate::command_bus::register_plugin_commands(
                &app.state::<crate::command_bus::CommandBus>(),
                &id,
                &entry.manifest.contributes.commands,
            );
        }
        let label = format!("検出: {plugin_count}件");
        let _ = app.emit(
            "job://progress",
            JobProgress { id: job_id, label, percent: 100, done: true, cancelled: false },
        );
    });

    id
}
