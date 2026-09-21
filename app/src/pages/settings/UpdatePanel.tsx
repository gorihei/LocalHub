import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

type Phase = "idle" | "checking" | "available" | "current" | "downloading" | "error";

export default function UpdatePanel() {
  const [currentVersion, setCurrentVersion] = useState("-");
  const [autoCheck, setAutoCheck] = useState(true);
  const [lastCheckAt, setLastCheckAt] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(() => setCurrentVersion("不明"));
    invoke<Record<string, string>>("settings_get_all").then((settings) => {
      setAutoCheck(settings.updateAutoCheck !== "false");
      const value = Number(settings.updateLastCheckAt || 0);
      if (value > 0) setLastCheckAt(value);
    });
  }, []);

  const changeAutoCheck = async () => {
    const next = !autoCheck;
    setAutoCheck(next);
    await invoke("settings_set", { key: "updateAutoCheck", value: String(next) });
  };

  const checkForUpdate = async () => {
    setPhase("checking");
    setMessage("");
    setUpdate(null);
    try {
      const found = await check({ timeout: 20_000 });
      const checkedAt = Date.now();
      setLastCheckAt(checkedAt);
      await invoke("settings_set", { key: "updateLastCheckAt", value: String(checkedAt) });
      if (found) {
        setUpdate(found);
        setPhase("available");
      } else {
        setPhase("current");
        setMessage("最新バージョンを使用しています。");
      }
    } catch (error) {
      setPhase("error");
      setMessage(`アップデートを確認できませんでした: ${String(error)}`);
    }
  };

  const installUpdate = async () => {
    if (!update) return;
    setPhase("downloading");
    setMessage("アップデートをダウンロードしています…");
    let downloaded = 0;
    let total: number | undefined;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? undefined;
        if (event.event === "Progress") downloaded += event.data.chunkLength;
        if (total && total > 0) setProgress(Math.min(100, Math.round((downloaded / total) * 100)));
        if (event.event === "Finished") setMessage("インストーラーを起動しています…");
      });
      // Windowsではインストーラー起動時にアプリが終了する。終了しない環境では
      // 明示的に再起動し、新しいバイナリへ切り替える。
      await relaunch();
    } catch (error) {
      setPhase("error");
      setProgress(null);
      setMessage(`アップデートに失敗しました: ${String(error)}`);
    }
  };

  return (
    <div className="panel-card update-panel" style={{ padding: "4px 18px" }}>
      <div className="setting-row">
        <div className="setting-label">
          <b>現在のバージョン</b>
          <span>Local Hub {currentVersion}</span>
        </div>
        <button className="btn" disabled={phase === "checking" || phase === "downloading"} onClick={checkForUpdate}>
          {phase === "checking" ? "確認中…" : "アップデートを確認"}
        </button>
      </div>
      <div className="setting-row">
        <div className="setting-label">
          <b>自動確認</b>
          <span>起動後に1日1回確認し、更新がある場合だけ通知します</span>
        </div>
        <button className={`toggle${autoCheck ? " on" : ""}`} onClick={changeAutoCheck} aria-label="アップデートの自動確認" />
      </div>
      <div className="setting-row">
        <div className="setting-label">
          <b>最終確認</b>
          <span>{lastCheckAt ? new Date(lastCheckAt).toLocaleString("ja-JP") : "まだ確認していません"}</span>
        </div>
      </div>
      {update && (
        <div className="update-result">
          <div>
            <b>バージョン {update.version}を利用できます</b>
            {update.date && <span>公開日: {new Date(update.date).toLocaleString("ja-JP")}</span>}
          </div>
          {update.body && <pre>{update.body}</pre>}
          {phase === "downloading" && <progress value={progress ?? undefined} max={100} />}
          <button className="btn active" disabled={phase === "downloading"} onClick={installUpdate}>
            {phase === "downloading" ? `更新中${progress !== null ? ` ${progress}%` : "…"}` : "ダウンロードして再起動"}
          </button>
        </div>
      )}
      {message && <div className={`update-message${phase === "error" ? " error" : ""}`}>{message}</div>}
    </div>
  );
}
