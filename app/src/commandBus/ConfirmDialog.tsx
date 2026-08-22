// §10.3 危険操作の確認表示。リスクレベル2以上のコマンド実行前に必ず通す想定。
// Enterキー連打だけで誤確定しないよう、チェックを入れるまで実行ボタンを無効化する。
//
// react-grid-layoutのウィジェット(ダッシュボード内)から呼ばれることがあり、
// それらの祖先要素にはCSS transformが付与されている(グリッド位置決めのため)。
// transformを持つ祖先はposition:fixedの基準を変えてしまい、画面中央寄せが
// ずれる原因になるため、document.body直下にポータルで描画して回避する。
import { useState } from "react";
import { createPortal } from "react-dom";

export type ConfirmDetails = {
  title: string;
  actor: string;
  action: string;
  target: string;
  impact: string;
  reversibility: string;
  requiredPermissions: string;
};

type Props = ConfirmDetails & {
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({
  title,
  actor,
  action,
  target,
  impact,
  reversibility,
  requiredPermissions,
  onConfirm,
  onCancel,
}: Props) {
  const [checked, setChecked] = useState(false);

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(4,6,10,.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 3000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          width: 420,
          background: "var(--surface-raised)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-m)",
          boxShadow: "0 20px 60px rgba(0,0,0,.55)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px 12px" }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: "var(--warning-soft)",
              color: "var(--warning)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M10 4l7 12H3z" />
              <line x1="10" y1="9" x2="10" y2="12.5" />
              <circle cx="10" cy="14.5" r="0.4" fill="currentColor" />
            </svg>
          </div>
          <h3 style={{ fontSize: 14.5, margin: 0, fontWeight: 650 }}>{title}</h3>
        </div>
        <div style={{ padding: "0 18px 6px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 10 }}>
            <tbody>
              {[
                ["実行主体", actor],
                ["操作内容", action],
                ["対象", target],
                ["影響範囲", impact],
                ["復元可能性", reversibility],
                ["必要な権限", requiredPermissions],
              ].map(([label, value]) => (
                <tr key={label} style={{ borderBottom: "1px solid var(--border-soft)" }}>
                  <td style={{ padding: "6px 0", color: "var(--text-faint)", width: 88, whiteSpace: "nowrap" }}>
                    {label}
                  </td>
                  <td style={{ padding: "6px 0" }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-s)",
              padding: "10px 12px",
              margin: "10px 0 14px",
              fontSize: 12,
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ marginTop: 2 }} />
            <span>実行内容と影響範囲を確認しました。</span>
          </label>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 18px 18px" }}>
          <button className="btn" onClick={onCancel}>
            キャンセル
          </button>
          <button
            className="btn"
            style={{ background: "var(--danger)", borderColor: "var(--danger)", color: "#2a0a0a" }}
            disabled={!checked}
            onClick={onConfirm}
          >
            実行
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
