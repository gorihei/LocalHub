// Gitリポジトリ監視プラグイン(サイドカー実行ファイル)。
//
// 指定フォルダ配下のGitリポジトリを検出し、ブランチ名・未コミット件数・
// push漏れ(ahead/behind)をまとめて返す。「どのリポジトリに作業が残っているか」を
// 一目で確認するためのツール。行を選択すると変更ファイル一覧・最終コミット情報を
// 取得でき(get_repo_detail)、フェッチボタンでahead/behindを最新化できる(fetch)。
//
// 検出は指定フォルダを起点に、`.git`が見つかったフォルダでそれ以上潜らない
// (リポジトリの中を再帰的に探しても意味がないため)、maxDepth階層までの深さ制限付き
// 再帰探索。node_modules/targetのような明らかに巨大で無関係なフォルダはスキップする。
//
// 実際の情報取得はgit.exeを子プロセスとして呼び出す方式(gitのバイナリ差分パーサーを
// 自作するより確実で軽量)。ホストとは改行区切りJSONの簡易JSON-RPC風プロトコルで通信する。

use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

// Win32のCREATE_NO_WINDOWフラグ。git.exeをコンソールなしのGUIアプリ(このプラグイン自身)
// から呼び出すと、指定しない場合に一瞬コンソールウィンドウがちらつくことがあるため。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// スキャン時にこれ以上潜らないフォルダ名(大規模で無関係、かつGitリポジトリの
/// 実体が入っていることはまず無いもの)。
const SKIP_DIR_NAMES: [&str; 4] = ["node_modules", "target", ".git", "dist"];

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

fn config_path() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("watch_path.json")
}

fn load_saved_path() -> Option<String> {
    std::fs::read_to_string(config_path()).ok().and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()).and_then(|v| {
        v.get("path").and_then(|p| p.as_str()).map(|s| s.to_string())
    })
}

fn save_path(path: &str) {
    let _ = std::fs::write(config_path(), serde_json::json!({ "path": path }).to_string());
}

fn run_git(repo: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo).args(args);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim_end().to_string())
}

fn ahead_behind(repo: &Path) -> (Option<u32>, Option<u32>) {
    // アップストリーム未設定/オフライン等でも失敗しうるが、それ自体はエラー扱いに
    // しない(ahead/behindが分からないだけで、他の情報は普通に返す)。
    run_git(repo, &["rev-list", "--left-right", "--count", "HEAD...@{u}"])
        .and_then(|s| {
            let mut parts = s.split_whitespace();
            let ahead: u32 = parts.next()?.parse().ok()?;
            let behind: u32 = parts.next()?.parse().ok()?;
            Some((Some(ahead), Some(behind)))
        })
        .unwrap_or((None, None))
}

fn repo_info(repo: &Path) -> serde_json::Value {
    let name = repo.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let branch = run_git(repo, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_else(|| "?".to_string());
    let changed_count = run_git(repo, &["status", "--porcelain"]).map(|s| s.lines().filter(|l| !l.is_empty()).count()).unwrap_or(0);
    let (ahead, behind) = ahead_behind(repo);

    serde_json::json!({
        "name": name,
        "path": repo.to_string_lossy(),
        "branch": branch,
        "dirty": changed_count > 0,
        "changedCount": changed_count,
        "ahead": ahead,
        "behind": behind,
    })
}

/// `git status --porcelain`の1行は先頭2文字がステータスコード(例: " M"=作業ツリーで
/// 変更、"??"=未追跡、"A "=ステージ済み追加)、3文字目以降がファイルパス。
fn parse_status_line(line: &str) -> Option<(String, String)> {
    if line.len() < 4 {
        return None;
    }
    let status = line[..2].to_string();
    let path = line[3..].to_string();
    Some((status, path))
}

fn repo_detail(repo: &Path) -> Result<serde_json::Value, String> {
    if !repo.join(".git").exists() {
        return Err("Gitリポジトリではありません".to_string());
    }
    let files: Vec<serde_json::Value> = run_git(repo, &["status", "--porcelain"])
        .map(|s| s.lines().filter_map(parse_status_line).map(|(status, path)| serde_json::json!({ "status": status, "path": path })).collect())
        .unwrap_or_default();

    // %x1f(unit separator)区切りにして、コミットメッセージに含まれうる区切り文字
    // (カンマ・パイプ等)と衝突しないようにしている。
    let last_commit = run_git(repo, &["log", "-1", "--pretty=%s\x1f%an\x1f%ar"]).and_then(|s| {
        let mut parts = s.splitn(3, '\u{1f}');
        Some(serde_json::json!({
            "message": parts.next()?,
            "author": parts.next()?,
            "relativeTime": parts.next()?,
        }))
    });

    let (ahead, behind) = ahead_behind(repo);

    Ok(serde_json::json!({
        "files": files,
        "lastCommit": last_commit,
        "ahead": ahead,
        "behind": behind,
    }))
}

/// 直近のコミット履歴を返す(既定20件)。last_commitと同じ%x1f区切りの
/// フォーマットを使い回す。
fn log(repo: &Path, limit: u32) -> Result<serde_json::Value, String> {
    if !repo.join(".git").exists() {
        return Err("Gitリポジトリではありません".to_string());
    }
    let n = format!("-{}", limit.max(1));
    let output = run_git(repo, &["log", &n, "--pretty=%h\x1f%s\x1f%an\x1f%ar"]).ok_or("コミット履歴を取得できませんでした".to_string())?;
    let commits: Vec<serde_json::Value> = output
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(4, '\u{1f}');
            Some(serde_json::json!({
                "hash": parts.next()?,
                "message": parts.next()?,
                "author": parts.next()?,
                "relativeTime": parts.next()?,
            }))
        })
        .collect();
    Ok(serde_json::json!(commits))
}

/// 1コミットの詳細(全文メッセージ・作者・日時・変更ファイル一覧)を返す。
/// ファイルの中身の差分(diff本文)までは取得しない — 「ファイルは別途エディタで
/// 開く」運用にしたため、このプラグインでは「何がどう変わったファイルか」の一覧
/// だけ分かれば十分と判断した。
fn show_commit(repo: &Path, hash: &str) -> Result<serde_json::Value, String> {
    if hash.trim().is_empty() {
        return Err("コミットハッシュが指定されていません".to_string());
    }
    let meta = run_git(repo, &["log", "-1", hash, "--pretty=%H\x1f%s\x1f%b\x1f%an\x1f%ad", "--date=format:%Y-%m-%d %H:%M"])
        .ok_or("コミットが見つかりません".to_string())?;
    let mut parts = meta.splitn(5, '\u{1f}');
    let full_hash = parts.next().unwrap_or_default();
    let subject = parts.next().unwrap_or_default();
    let body = parts.next().unwrap_or_default().trim();
    let author = parts.next().unwrap_or_default();
    let date = parts.next().unwrap_or_default();

    // --name-statusは"M\tpath"のようにタブ区切りでステータスとパスを1行ずつ返す。
    let files: Vec<serde_json::Value> = run_git(repo, &["show", "--pretty=format:", "--name-status", hash])
        .map(|s| {
            s.lines()
                .filter(|l| !l.is_empty())
                .filter_map(|line| {
                    let mut cols = line.splitn(2, '\t');
                    Some(serde_json::json!({ "status": cols.next()?, "path": cols.next()? }))
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(serde_json::json!({
        "hash": full_hash,
        "subject": subject,
        "body": body,
        "author": author,
        "date": date,
        "files": files,
    }))
}

fn fetch(repo: &Path) -> Result<serde_json::Value, String> {
    if !repo.join(".git").exists() {
        return Err("Gitリポジトリではありません".to_string());
    }
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo).arg("fetch");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output().map_err(|e| format!("git fetchの起動に失敗しました: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let (ahead, behind) = ahead_behind(repo);
    Ok(serde_json::json!({ "ahead": ahead, "behind": behind }))
}

/// 選択されたファイルだけを`git add`してからコミットする(全部まとめて
/// `git add -A`はしない — UI側で意図せず全ファイルをコミットしてしまう事故を
/// 避けるため、必ずファイルを明示的に選ばせる設計)。
fn commit(repo: &Path, files: &[String], message: &str) -> Result<serde_json::Value, String> {
    if files.is_empty() {
        return Err("コミットするファイルが選択されていません".to_string());
    }
    if message.trim().is_empty() {
        return Err("コミットメッセージが空です".to_string());
    }

    let mut add_cmd = Command::new("git");
    add_cmd.arg("-C").arg(repo).arg("add").args(files);
    #[cfg(windows)]
    add_cmd.creation_flags(CREATE_NO_WINDOW);
    let add_output = add_cmd.output().map_err(|e| format!("git addの起動に失敗しました: {e}"))?;
    if !add_output.status.success() {
        return Err(String::from_utf8_lossy(&add_output.stderr).trim().to_string());
    }

    let mut commit_cmd = Command::new("git");
    commit_cmd.arg("-C").arg(repo).arg("commit").arg("-m").arg(message);
    #[cfg(windows)]
    commit_cmd.creation_flags(CREATE_NO_WINDOW);
    let commit_output = commit_cmd.output().map_err(|e| format!("git commitの起動に失敗しました: {e}"))?;
    if !commit_output.status.success() {
        return Err(String::from_utf8_lossy(&commit_output.stderr).trim().to_string());
    }

    Ok(serde_json::json!({ "ok": true }))
}

fn push(repo: &Path) -> Result<serde_json::Value, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo).arg("push");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output().map_err(|e| format!("git pushの起動に失敗しました: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let (ahead, behind) = ahead_behind(repo);
    Ok(serde_json::json!({ "ahead": ahead, "behind": behind }))
}

/// `git pull --rebase`(フェッチ+ローカルコミットをリベース)。コンフリクトで
/// 失敗した場合、このプラグインにはマージ/コンフリクト解決UIが無いため、
/// abort_rebaseで安全に取り消す手段だけ用意する(解決自体はエディタ等の
/// 外部ツールに任せる前提)。
fn pull_rebase(repo: &Path) -> Result<serde_json::Value, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo).arg("pull").arg("--rebase");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output().map_err(|e| format!("git pull --rebaseの起動に失敗しました: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("{stderr}\n\nコンフリクトが発生した場合は「リベースを中止」で取り消せます(解決には別途エディタ等が必要です)"));
    }
    let (ahead, behind) = ahead_behind(repo);
    Ok(serde_json::json!({ "ahead": ahead, "behind": behind }))
}

fn abort_rebase(repo: &Path) -> Result<serde_json::Value, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo).arg("rebase").arg("--abort");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output().map_err(|e| format!("git rebase --abortの起動に失敗しました: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(serde_json::json!({ "ok": true }))
}

/// コンフリクト中(=マージ未解決)のファイル一覧。`--diff-filter=U`は
/// "Unmerged"(両者で衝突している)ファイルだけを絞り込む標準的な方法。
fn list_conflicts(repo: &Path) -> Result<serde_json::Value, String> {
    let output = run_git(repo, &["diff", "--name-only", "--diff-filter=U"]).unwrap_or_default();
    let files: Vec<&str> = output.lines().filter(|l| !l.is_empty()).collect();
    Ok(serde_json::json!(files))
}

/// 外部エディタ等で手動修正した後、そのファイルを「解決済み」として
/// ステージする(コンフリクトマーカー自体は消えているかまでは検証しない —
/// gitの`add`自体はマーカーが残っていても実行できてしまうため、最終的な
/// 妥当性はrebase --continue時のビルド/テストで気づく前提)。
fn mark_resolved(repo: &Path, file: &str) -> Result<serde_json::Value, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo).arg("add").arg(file);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output().map_err(|e| format!("git addの起動に失敗しました: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(serde_json::json!({ "ok": true }))
}

fn continue_rebase(repo: &Path) -> Result<serde_json::Value, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo).arg("rebase").arg("--continue");
    // GIT_EDITOR=trueで「常に成功して何もしない」コマンドを指定し、コミット
    // メッセージ編集用にエディタ(vim等)が立ち上がって固まるのを防ぐ
    // (このプラグインには対話的にターミナルへ応答する手段が無いため)。
    cmd.env("GIT_EDITOR", "true");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output().map_err(|e| format!("git rebase --continueの起動に失敗しました: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("{stderr}\n\nまだ解決していないコンフリクトが残っている可能性があります"));
    }
    let (ahead, behind) = ahead_behind(repo);
    Ok(serde_json::json!({ "ahead": ahead, "behind": behind }))
}

fn should_skip_dir(name: &str) -> bool {
    SKIP_DIR_NAMES.iter().any(|s| s.eq_ignore_ascii_case(name)) || name.starts_with('.')
}

/// `.git`が見つかったフォルダでは打ち切り、それ以外はmax_depthまで再帰する。
fn collect_repos(dir: &Path, max_depth: u32, depth: u32, out: &mut Vec<PathBuf>) {
    if dir.join(".git").exists() {
        out.push(dir.to_path_buf());
        return;
    }
    if depth >= max_depth {
        return;
    }
    let Ok(read_dir) = std::fs::read_dir(dir) else { return };
    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if should_skip_dir(&name) {
            continue;
        }
        collect_repos(&path, max_depth, depth + 1, out);
    }
}

fn scan(root: &str, max_depth: u32) -> Result<serde_json::Value, String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(format!("フォルダが見つかりません: {root}"));
    }

    let mut paths = Vec::new();
    collect_repos(root_path, max_depth.max(1), 0, &mut paths);

    let mut repos: Vec<serde_json::Value> = paths.iter().map(|p| repo_info(p)).collect();
    repos.sort_by(|a, b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));
    Ok(serde_json::json!(repos))
}

fn main() {
    eprintln!("[git-status-plugin] 起動しました (pid={})", std::process::id());

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
                eprintln!("[git-status-plugin] 不正なリクエストを受信しました: {e}");
                continue;
            }
        };

        let result: Result<serde_json::Value, String> = match req.method.as_str() {
            "get_path" => Ok(serde_json::json!({ "path": load_saved_path() })),
            "scan" => {
                let path = req.params.get("path").and_then(|v| v.as_str()).map(|s| s.to_string()).or_else(load_saved_path);
                let max_depth = req.params.get("maxDepth").and_then(|v| v.as_u64()).unwrap_or(2) as u32;
                match path {
                    Some(p) => {
                        save_path(&p);
                        scan(&p, max_depth)
                    }
                    None => Err("フォルダが指定されていません".to_string()),
                }
            }
            "get_repo_detail" => {
                let path = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
                repo_detail(Path::new(path))
            }
            "fetch" => {
                let path = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
                fetch(Path::new(path))
            }
            "show_commit" => {
                let path = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
                let hash = req.params.get("hash").and_then(|v| v.as_str()).unwrap_or("");
                show_commit(Path::new(path), hash)
            }
            "log" => {
                let path = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
                let limit = req.params.get("limit").and_then(|v| v.as_u64()).unwrap_or(20) as u32;
                log(Path::new(path), limit)
            }
            "commit" => {
                let path = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
                let files: Vec<String> =
                    req.params.get("files").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|f| f.as_str().map(|s| s.to_string())).collect()).unwrap_or_default();
                let message = req.params.get("message").and_then(|v| v.as_str()).unwrap_or("");
                commit(Path::new(path), &files, message)
            }
            "push" => {
                let path = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
                push(Path::new(path))
            }
            "pull_rebase" => {
                let path = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
                pull_rebase(Path::new(path))
            }
            "abort_rebase" => {
                let path = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
                abort_rebase(Path::new(path))
            }
            "list_conflicts" => {
                let path = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
                list_conflicts(Path::new(path))
            }
            "mark_resolved" => {
                let path = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
                let file = req.params.get("file").and_then(|v| v.as_str()).unwrap_or("");
                mark_resolved(Path::new(path), file)
            }
            "continue_rebase" => {
                let path = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
                continue_rebase(Path::new(path))
            }
            other => Err(format!("未知のmethodです: {other}")),
        };
        send(&mut stdout, req.id, result);
    }

    eprintln!("[git-status-plugin] 終了します");
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
