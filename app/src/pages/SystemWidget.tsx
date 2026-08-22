// §6.12 システムモニター(付録B: MVP初期ウィジェット「システム状態」)。
// MVP必須のCPU/RAM/ストレージのみ表示する。
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type SystemStats = {
  cpu_percent: number;
  mem_used_bytes: number;
  mem_total_bytes: number;
  disk_used_bytes: number;
  disk_total_bytes: number;
  uptime_secs: number;
  net_received_bytes: number;
  net_transmitted_bytes: number;
};

const POLL_INTERVAL_MS = 2000;

function formatGB(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(0);
}

// net_*_bytesはポーリング間隔(POLL_INTERVAL_MS)ごとの差分なので、1秒あたりの
// 転送量に換算してから見やすい単位(KB/s, MB/s)に整形する。
function formatRate(bytesPerInterval: number): string {
  const bytesPerSec = bytesPerInterval / (POLL_INTERVAL_MS / 1000);
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${bytesPerSec.toFixed(0)} B/s`;
}

function formatUptime(secs: number): string {
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  if (days > 0) return `${days}日 ${hours}時間`;
  if (hours > 0) return `${hours}時間 ${minutes}分`;
  return `${minutes}分`;
}

function Ring({ percent, color, label }: { percent: number; color: string; label: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flex: 1 }}>
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: "50%",
          background: `conic-gradient(${color} ${clamped * 3.6}deg, var(--border) 0deg)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: "var(--surface)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {clamped.toFixed(0)}%
        </div>
      </div>
      <div style={{ fontSize: 10.5, color: "var(--text-faint)", letterSpacing: 0.2 }}>{label}</div>
    </div>
  );
}

export default function SystemWidget() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      invoke<SystemStats>("system_stats")
        .then((s) => {
          if (!cancelled) {
            setStats(s);
            setFailed(false);
          }
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };
    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (failed) {
    return <span style={{ color: "var(--text-faint)" }}>システム情報を取得できませんでした</span>;
  }
  if (!stats) {
    return <span style={{ color: "var(--text-faint)" }}>読み込み中…</span>;
  }

  const memPercent = (stats.mem_used_bytes / stats.mem_total_bytes) * 100;
  const diskPercent = (stats.disk_used_bytes / stats.disk_total_bytes) * 100;

  return (
    <div>
      <div style={{ display: "flex", gap: 6 }}>
        <Ring percent={stats.cpu_percent} color="var(--accent)" label="CPU" />
        <Ring percent={memPercent} color="var(--violet)" label="RAM" />
        <Ring percent={diskPercent} color="var(--success)" label="ストレージ" />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          fontSize: 11,
          color: "var(--text-muted)",
          borderTop: "1px solid var(--border-soft)",
          marginTop: 10,
          paddingTop: 10,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "var(--text-faint)" }}>メモリ</span>
          <span>
            {formatGB(stats.mem_used_bytes)} / {formatGB(stats.mem_total_bytes)} GB
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "var(--text-faint)" }}>ストレージ</span>
          <span>
            {formatGB(stats.disk_used_bytes)} / {formatGB(stats.disk_total_bytes)} GB
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "var(--text-faint)" }}>稼働時間</span>
          <span>{formatUptime(stats.uptime_secs)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "var(--text-faint)" }}>ネットワーク</span>
          <span>
            ↓{formatRate(stats.net_received_bytes)} ↑{formatRate(stats.net_transmitted_bytes)}
          </span>
        </div>
      </div>
    </div>
  );
}
