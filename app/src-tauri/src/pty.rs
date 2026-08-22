// ConPTY経由でシェルを起動し、出力をTauriイベントでフロントエンド
// (xterm.js)へストリーミングする(FR-CLI-001, FR-CLI-002)。
//
// Phase 5でクイックCLIの複数タブ対応のため、セッションをsession_idで
// 複数管理できるようにした(Phase 0時点では1つだけの前提だった)。
//
// FR-CLI-001はMVP必須をPowerShellのみとしているが、利用者からの追加要望で
// Command PromptとGit Bashも選べるようにしている(MVP範囲外の拡張)。

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

/// 起動中のPTYセッション。writerとmasterの両方を保持しておかないと、
/// masterをスコープから外した時点でConPTYが閉じてしまう。
struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
}

#[derive(Default)]
pub struct PtyState(Mutex<HashMap<String, PtySession>>);

#[derive(Serialize, Clone)]
struct PtyDataPayload {
    session_id: String,
    data: String,
}

#[derive(Serialize, Clone)]
struct PtyClosedPayload {
    session_id: String,
}

/// Git Bashのbash.exeを探す。インストーラーの標準パス2箇所→PATH上のgit.exeから
/// 逆算、の順に試す(portable-ptyはPATH解決を自前でやらないため、フルパスまで
/// 特定できないと`spawn`が失敗する)。
fn find_git_bash() -> Option<PathBuf> {
    for candidate in [r"C:\Program Files\Git\bin\bash.exe", r"C:\Program Files (x86)\Git\bin\bash.exe"] {
        let path = PathBuf::from(candidate);
        if path.is_file() {
            return Some(path);
        }
    }
    // `where git`でgit.exeの場所を調べ、そこから ..\bin\bash.exe を推測する
    // (git.exeは通常 <Gitルート>\cmd\git.exe または \bin\git.exe にある)。
    let output = std::process::Command::new("where").arg("git").output().ok()?;
    let first_line = String::from_utf8_lossy(&output.stdout).lines().next()?.trim().to_string();
    let git_exe = PathBuf::from(first_line);
    let git_root = git_exe.parent()?.parent()?;
    let bash_path = git_root.join("bin").join("bash.exe");
    bash_path.is_file().then_some(bash_path)
}

/// シェルセッションを新規に起動する。`cwd`を指定すると作業ディレクトリを
/// そこに設定する(FR-CLI-002「作業ディレクトリ指定」)。`shell`は
/// "powershell"(既定)/"cmd"/"gitbash"のいずれか。戻り値のsession_idを
/// pty_write/pty_resize/pty_closeへ渡す。
#[tauri::command]
pub fn pty_spawn(app: AppHandle, state: State<PtyState>, cwd: Option<String>, shell: Option<String>) -> Result<String, String> {
    let pty_system = native_pty_system();

    // 24x80は初期値。実際のサイズはフロント側のfitアドオンがpty_resizeで通知する。
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("PTYのオープンに失敗しました: {e}"))?;

    // FR-CLI-001: MVP必須はPowerShellのみだが、利用者要望によりCommand Prompt/
    // Git Bashも選べるようにしている。
    let mut cmd = match shell.as_deref() {
        Some("cmd") => CommandBuilder::new("cmd.exe"),
        Some("gitbash") => {
            let bash_path = find_git_bash().ok_or("Git Bashが見つかりませんでした(標準的な場所にインストールされているか確認してください)")?;
            let mut builder = CommandBuilder::new(bash_path);
            builder.arg("--login");
            builder.arg("-i");
            builder
        }
        _ => CommandBuilder::new("powershell.exe"),
    };
    if let Some(dir) = &cwd {
        cmd.cwd(dir);
    }
    let _child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("シェルの起動に失敗しました: {e}"))?;

    // spawn後はslave側ハンドルを明示的に閉じる。閉じないとConPTYが
    // 子プロセスの終了(EOF)を検知しないことがある。
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("PTY読み取りハンドルの取得に失敗しました: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("PTY書き込みハンドルの取得に失敗しました: {e}"))?;

    let session_id = uuid_like_id();

    state.0.lock().unwrap().insert(session_id.clone(), PtySession { writer, master: pair.master });

    let emit_id = session_id.clone();
    std::thread::spawn(move || {
        let mut raw = [0u8; 4096];
        // チャンク境界でマルチバイト文字(日本語等)が分断されることがあるため、
        // 未確定分を次回の読み取りまで持ち越す。
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut raw) {
                Ok(0) => break, // プロセス終了(EOF)
                Ok(n) => {
                    pending.extend_from_slice(&raw[..n]);
                    let (valid, rest_len) = split_valid_utf8(&pending);
                    if !valid.is_empty() {
                        let _ = app.emit(
                            "pty://data",
                            PtyDataPayload { session_id: emit_id.clone(), data: valid.to_string() },
                        );
                    }
                    pending.drain(..pending.len() - rest_len);
                }
                Err(_) => break,
            }
        }
        let _ = app.emit("pty://closed", PtyClosedPayload { session_id: emit_id });
    });

    Ok(session_id)
}

#[tauri::command]
pub fn pty_write(state: State<PtyState>, session_id: String, data: String) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    match guard.get_mut(&session_id) {
        Some(session) => {
            session
                .writer
                .write_all(data.as_bytes())
                .map_err(|e| format!("PTYへの書き込みに失敗しました: {e}"))?;
            session.writer.flush().map_err(|e| e.to_string())
        }
        None => Err("PTYセッションが見つかりません".to_string()),
    }
}

#[tauri::command]
pub fn pty_resize(state: State<PtyState>, session_id: String, rows: u16, cols: u16) -> Result<(), String> {
    let guard = state.0.lock().unwrap();
    match guard.get(&session_id) {
        Some(session) => session
            .master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("PTYのリサイズに失敗しました: {e}")),
        None => Err("PTYセッションが見つかりません".to_string()),
    }
}

/// タブを閉じる際に呼ぶ。masterをdropすることでConPTYを閉じ、子プロセスへ
/// 終了を伝える。
#[tauri::command]
pub fn pty_close(state: State<PtyState>, session_id: String) -> Result<(), String> {
    state.0.lock().unwrap().remove(&session_id);
    Ok(())
}

fn uuid_like_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    format!("pty-{nanos:x}")
}

/// バイト列の末尾に不完全なUTF-8シーケンスが残る場合、そこで切り分けて
/// (確定分の文字列, 残りバイト長)を返す。残りバイトは呼び出し側のバッファに
/// そのまま残しておき、次の読み取り分と合わせて再度デコードを試みる。
fn split_valid_utf8(bytes: &[u8]) -> (&str, usize) {
    match std::str::from_utf8(bytes) {
        Ok(s) => (s, 0),
        Err(e) => {
            let valid_len = e.valid_up_to();
            // valid_up_to()までは有効なUTF-8であることがErrの仕様上保証されている。
            let valid = std::str::from_utf8(&bytes[..valid_len]).unwrap();
            (valid, bytes.len() - valid_len)
        }
    }
}
