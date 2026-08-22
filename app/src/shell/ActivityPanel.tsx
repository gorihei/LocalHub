// §6.9 アクティビティ(通知履歴)とバックグラウンドジョブをまとめた右側パネル。
import { useState } from "react";
import { useNotifications, type NotificationLevel } from "../notifications/NotificationContext";
import { useJobs } from "../jobs/useJobs";
import { executeCommand } from "../commandBus/commandBus";
import ConfirmDialog from "../commandBus/ConfirmDialog";
import "./activity-panel.css";

const LEVEL_DOT: Record<NotificationLevel, string> = {
  success: "var(--success)",
  info: "var(--accent-strong)",
  warning: "var(--warning)",
  error: "var(--danger)",
};

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function ActivityPanel({ open, onClose }: Props) {
  const { history, refreshHistory } = useNotifications();
  const { jobs, rescanPlugins, cancelJob } = useJobs();
  const [confirmingClear, setConfirmingClear] = useState(false);

  if (!open) return null;

  const clearHistory = async () => {
    await executeCommand("notifications.clearHistory");
    setConfirmingClear(false);
    refreshHistory();
  };

  return (
    <div className="activity-panel">
      <div className="activity-panel-head">
        <b>アクティビティ</b>
        <button className="icon-btn" onClick={onClose} title="閉じる">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <line x1="6" y1="6" x2="14" y2="14" />
            <line x1="14" y1="6" x2="6" y2="14" />
          </svg>
        </button>
      </div>

      {confirmingClear && (
        <ConfirmDialog
          title="通知履歴をすべて削除しますか?"
          actor="ユーザー(手動実行)"
          action="通知履歴を全件削除"
          target={`保存されている通知 ${history.length}件`}
          impact="アクティビティパネルの履歴が空になります"
          reversibility="不可(削除後は復元できません)"
          requiredPermissions="なし(ローカルDBのみ)"
          onConfirm={clearHistory}
          onCancel={() => setConfirmingClear(false)}
        />
      )}

      <div className="activity-section">
        <div className="activity-section-title">
          <span>バックグラウンド</span>
          <button className="btn" onClick={() => rescanPlugins()}>
            プラグインを再スキャン
          </button>
        </div>
        {jobs.length === 0 ? (
          <div className="activity-empty">実行中のジョブはありません</div>
        ) : (
          jobs.map((j) => (
            <div key={j.id} className="job-card">
              <div className="job-top">
                <span>{j.label}</span>
                {!j.done && (
                  <button className="icon-btn" onClick={() => cancelJob(j.id)} title="キャンセル">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <line x1="6" y1="6" x2="14" y2="14" />
                      <line x1="14" y1="6" x2="6" y2="14" />
                    </svg>
                  </button>
                )}
              </div>
              <div className="job-bar">
                <i style={{ width: `${j.percent}%` }} />
              </div>
            </div>
          ))
        )}
      </div>

      <div className="activity-section">
        <div className="activity-section-title">
          <span>通知履歴</span>
          {history.length > 0 && (
            <button className="icon-btn" onClick={() => setConfirmingClear(true)} title="履歴をすべて削除">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M5 6h10M8 6V4.5h4V6M6 6l.7 9.5a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L14 6" />
              </svg>
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <div className="activity-empty">通知はありません</div>
        ) : (
          history.map((n) => (
            <div key={n.id} className="activity-item">
              <span className="activity-dot" style={{ background: LEVEL_DOT[n.level] }} />
              <div>
                <div className="activity-title">{n.title}</div>
                <div className="activity-sub">
                  {n.body} — {n.created_at}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
