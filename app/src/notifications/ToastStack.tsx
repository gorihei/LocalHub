// §6.9 トースト表示。短時間で自動的に消える(履歴はActivityPanelから再確認できる)。
import { useNotifications, type NotificationLevel } from "./NotificationContext";

const LEVEL_COLOR: Record<NotificationLevel, string> = {
  success: "var(--success)",
  info: "var(--accent-strong)",
  warning: "var(--warning)",
  error: "var(--danger)",
};

export default function ToastStack() {
  const { toasts } = useNotifications();

  return (
    <div
      style={{
        position: "fixed",
        bottom: 38,
        right: 14,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 2000,
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderLeft: `3px solid ${LEVEL_COLOR[t.level]}`,
            borderRadius: "var(--radius-s)",
            padding: "10px 12px",
            width: 280,
            boxShadow: "0 12px 30px rgba(0,0,0,.4)",
            fontSize: 12.5,
          }}
        >
          <div style={{ fontWeight: 600, display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>{t.title}</span>
            {t.count > 1 && <span style={{ color: "var(--text-faint)", fontSize: 11 }}>×{t.count}</span>}
          </div>
          <div style={{ color: "var(--text-muted)", marginTop: 2 }}>{t.body}</div>
        </div>
      ))}
    </div>
  );
}
