import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";

export default function LogsPanel() {
  const [lines, setLines] = useState<string[]>([]);
  const [dir, setDir] = useState("");

  const refresh = () => {
    invoke<string[]>("logs_recent", { limit: 200 }).then(setLines);
    invoke<string>("log_dir_path").then(setDir);
  };
  useEffect(refresh, []);

  return (
    <div className="panel-card" style={{ padding: "4px 18px" }}>
      <div className="setting-row">
        <div className="setting-label">
          <b>ログフォルダー</b>
          <span style={{ wordBreak: "break-all" }}>{dir || "取得中…"}</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={refresh}>
            更新
          </button>
          <button className="btn" disabled={!dir} onClick={() => dir && openPath(dir)}>
            フォルダーを開く
          </button>
        </div>
      </div>
      <div style={{ padding: "10px 4px 14px" }}>
        <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 6 }}>直近の警告・エラー(最大200件)</div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-muted)",
            maxHeight: 260,
            overflowY: "auto",
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-s)",
            padding: 8,
          }}
        >
          {lines.length === 0 ? <span style={{ color: "var(--text-faint)" }}>警告・エラーはありません</span> : lines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </div>
    </div>
  );
}


