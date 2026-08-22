// 付録B ダッシュボードウィジェット「最近使ったショートカット」。
import { useEffect, useState } from "react";
import { recentShortcuts, onShortcutsChanged, KIND_LABEL, type Shortcut } from "./shortcuts";
import { useLaunchShortcut } from "./useLaunchShortcut";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso.replace(" ", "T") + "Z").getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  return `${Math.floor(hr / 24)}日前`;
}

export default function RecentWidget() {
  const [items, setItems] = useState<Shortcut[]>([]);
  const refresh = () => recentShortcuts(8).then(setItems).catch(console.error);
  useEffect(() => {
    refresh();
    return onShortcutsChanged(refresh);
  }, []);
  const { launch, dialog } = useLaunchShortcut(refresh);

  if (items.length === 0) {
    return <span style={{ color: "var(--text-faint)" }}>まだ何も起動していません</span>;
  }

  return (
    <div>
      {dialog}
      {items.map((s) => (
        <div
          key={s.id}
          onClick={() => launch(s)}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 2px", cursor: "pointer" }}
        >
          <span style={{ fontSize: 9, fontWeight: 700, color: "var(--text-faint)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 4px" }}>
            {KIND_LABEL[s.kind]}
          </span>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
          <span style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{relativeTime(s.last_used_at!)}</span>
        </div>
      ))}
    </div>
  );
}
