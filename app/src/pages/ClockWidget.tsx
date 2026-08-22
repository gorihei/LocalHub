// 付録B ダッシュボードウィジェット「時計」。ローカル時刻を表示するだけの
// 単純なウィジェット(外部通信なし)。
import { useEffect, useState } from "react";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export default function ClockWidget() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const dateLabel = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}(${WEEKDAYS[now.getDay()]})`;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
      <div style={{ fontSize: 34, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: 1, color: "var(--text)" }}>
        {hh}:{mm}
        <span style={{ fontSize: 18, color: "var(--text-faint)" }}>:{ss}</span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{dateLabel}</div>
    </div>
  );
}
