// §11.3 可観測性: 構造化ログ、コア/プラグインの識別、ローテーション、
// UIから直近エラーへの到達を実装する。
//
// 構成:
//   - ファイル: tracing-appenderで日次ローテーション(app_log_dir配下)。
//     起動時に古いファイルを間引き、無制限に増え続けないようにする。
//   - 直近ログのメモリバッファ: WARN以上をリングバッファに保持し、
//     `logs_recent`コマンドでUIから取得できるようにする(ディスクI/O不要で即応答)。
//
// ログにシークレットを書かないことは呼び出し側の責務(secret_set等では
// 値そのものをtracingマクロへ渡さない)。診断エクスポート機能(§10.4)は
// 実際に必要になった時点で追加する。

use std::collections::VecDeque;
use std::io::{self, Write};
use std::sync::{Arc, Mutex};
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::Layer;

const MAX_RECENT_ENTRIES: usize = 500;
const MAX_LOG_FILES: usize = 14;

#[derive(Clone)]
pub struct RecentLogBuffer(Arc<Mutex<VecDeque<String>>>);

impl RecentLogBuffer {
    fn new() -> Self {
        Self(Arc::new(Mutex::new(VecDeque::with_capacity(MAX_RECENT_ENTRIES))))
    }

    /// 直近`limit`件を古い順に返す。
    pub fn recent(&self, limit: usize) -> Vec<String> {
        let buf = self.0.lock().unwrap();
        let skip = buf.len().saturating_sub(limit);
        buf.iter().skip(skip).cloned().collect()
    }
}

impl Write for RecentLogBuffer {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if let Ok(text) = std::str::from_utf8(buf) {
            let mut guard = self.0.lock().unwrap();
            for line in text.lines() {
                if guard.len() >= MAX_RECENT_ENTRIES {
                    guard.pop_front();
                }
                guard.push_back(line.to_string());
            }
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl<'a> MakeWriter<'a> for RecentLogBuffer {
    type Writer = RecentLogBuffer;
    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

/// non_blocking writerのWorkerGuardをアプリ終了まで保持するためのラッパー。
/// Dropすると書き込みがフラッシュされなくなるため、Tauriのmanaged stateとして
/// アプリと同じ寿命を持たせる。
pub struct LoggingGuard(#[allow(dead_code)] tracing_appender::non_blocking::WorkerGuard);

/// 保持ファイル数の上限(`MAX_LOG_FILES`)を超えた古い日次ログファイルを削除する。
fn cleanup_old_logs(dir: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<_> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "log"))
        .collect();
    if files.len() <= MAX_LOG_FILES {
        return;
    }
    files.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
    for old in files.iter().take(files.len() - MAX_LOG_FILES) {
        let _ = std::fs::remove_file(old.path());
    }
}

/// ログ基盤を初期化する。アプリ起動時に一度だけ呼ぶ。
pub fn init(log_dir: &std::path::Path) -> Result<(RecentLogBuffer, LoggingGuard), String> {
    std::fs::create_dir_all(log_dir).map_err(|e| format!("ログフォルダーの作成に失敗しました: {e}"))?;
    cleanup_old_logs(log_dir);

    let file_appender = tracing_appender::rolling::daily(log_dir, "local-hub.log");
    let (file_writer, guard) = tracing_appender::non_blocking(file_appender);

    let recent = RecentLogBuffer::new();

    let file_layer = tracing_subscriber::fmt::layer().with_writer(file_writer).with_ansi(false);
    let recent_layer = tracing_subscriber::fmt::layer()
        .with_writer(recent.clone())
        .with_ansi(false)
        .with_filter(tracing_subscriber::filter::LevelFilter::WARN);

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new("info"))
        .with(file_layer)
        .with(recent_layer)
        .try_init()
        .map_err(|e| format!("ログ基盤の初期化に失敗しました: {e}"))?;

    Ok((recent, LoggingGuard(guard)))
}

#[tauri::command]
pub fn logs_recent(state: tauri::State<RecentLogBuffer>, limit: Option<usize>) -> Vec<String> {
    state.recent(limit.unwrap_or(200))
}
