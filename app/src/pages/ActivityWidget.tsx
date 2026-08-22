// 付録B ダッシュボードウィジェット「最近の通知」。ActivityPanel(§6.9の
// スライドパネル)と同じnotifications_listを使い、ダッシュボード上でも
// 直近の通知を一目で確認できるようにする。
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type NotificationRecord = {
  id: number;
  level: "success" | "info" | "warning" | "error";
  title: string;
  body: string;
  created_at: string;
};

const LEVEL_COLOR: Record<NotificationRecord["level"], string> = {
  success: "var(--success)",
  info: "var(--accent)",
  warning: "var(--warning)",
  error: "var(--danger)",
};

export default function ActivityWidget() {
  const [items, setItems] = useState<NotificationRecord[]>([]);

  const refresh = () => {
    invoke<NotificationRecord[]>("notifications_list", { limit: 8 })
      .then(setItems)
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
    const unlisten = listen("app://notification", refresh);
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  if (items.length === 0) {
    return <span style={{ color: "var(--text-faint)" }}>通知はまだありません</span>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((item) => (
        <div key={item.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: LEVEL_COLOR[item.level],
              marginTop: 4,
              flexShrink: 0,
            }}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.title}
            </div>
            <div style={{ fontSize: 10.5, color: "var(--text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.body}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
