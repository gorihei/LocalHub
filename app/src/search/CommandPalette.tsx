// FR-CMD-001〜004 コマンドパレット。
// Ctrl+Kで開閉、入力と同時に絞り込み、上下キー+Enter+Esc、
// リスクレベル2以上は実行前に確認ダイアログを挟む(FR-CMD-003)。
import { useEffect, useRef, useState } from "react";
import { searchAll, type SearchResult } from "./search";
import { executeCommand } from "../commandBus/commandBus";
import ConfirmDialog from "../commandBus/ConfirmDialog";
import { useLaunchShortcut } from "../shortcuts/useLaunchShortcut";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function CommandPalette({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const [confirmTarget, setConfirmTarget] = useState<SearchResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { launch, dialog: launchDialog } = useLaunchShortcut();

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    searchAll(query).then((r) => {
      setResults(r.slice(0, 30));
      setSelected(0);
    });
  }, [query, open]);

  const runResult = (result: SearchResult) => {
    if (result.type === "shortcut") {
      launch(result.shortcut);
      onClose();
      return;
    }
    if (result.type === "plugin") {
      if (result.actionCommand) {
        executeCommand(result.actionCommand, result.actionParams).catch((err) => console.error(err));
      }
      onClose();
      return;
    }
    if (result.command.risk_level >= 2) {
      setConfirmTarget(result);
      return;
    }
    executeCommand(result.command.id).catch((err) => console.error(err));
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const result = results[selected];
      if (result) runResult(result);
    }
  };

  if (!open) return null;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(4,6,10,.6)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "11vh", zIndex: 4000 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {launchDialog}
      {confirmTarget && confirmTarget.type === "command" && (
        <ConfirmDialog
          title={`${confirmTarget.command.title}を実行しますか?`}
          actor="ユーザー(コマンドパレット)"
          action={confirmTarget.command.title}
          target={confirmTarget.command.owner_plugin_id ?? "コア機能"}
          impact={confirmTarget.command.description}
          reversibility={confirmTarget.command.supports_undo ? "Undoに対応しています" : "元に戻せない可能性があります"}
          requiredPermissions="なし"
          onConfirm={() => {
            executeCommand(confirmTarget.command.id).catch((err) => console.error(err));
            setConfirmTarget(null);
            onClose();
          }}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
      <div
        style={{ width: "100%", maxWidth: 560, background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--radius-m)", boxShadow: "0 20px 60px rgba(0,0,0,.5)", maxHeight: "70vh", display: "flex", flexDirection: "column" }}
        onKeyDown={handleKeyDown}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" style={{ width: 16, height: 16, color: "var(--text-faint)" }}>
            <circle cx="9" cy="9" r="6" />
            <line x1="17" y1="17" x2="13.4" y2="13.4" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="コマンドまたはショートカットを検索…"
            style={{ flex: 1, background: "none", border: "none", fontSize: 15, color: "var(--text)", outline: "none" }}
          />
          <span className="kbd">Esc</span>
        </div>
        <div style={{ overflowY: "auto", padding: 8 }}>
          {results.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)", fontSize: 12.5 }}>該当なし</div>
          ) : (
            results.map((r, i) => (
              <div
                key={r.id}
                onMouseEnter={() => setSelected(i)}
                onClick={() => runResult(r)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  borderRadius: "var(--radius-s)",
                  background: i === selected ? "var(--surface-hover)" : "transparent",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: "var(--text-faint)",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    padding: "1px 5px",
                    flexShrink: 0,
                  }}
                >
                  {r.type === "shortcut" ? "SC" : r.type === "plugin" ? "PLG" : "CMD"}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>{r.title}</div>
                  <div style={{ fontSize: 11, color: "var(--text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.subtitle}
                  </div>
                </div>
                {r.type === "command" && r.command.risk_level >= 2 && (
                  <span style={{ fontSize: 9.5, fontWeight: 700, borderRadius: 4, padding: "2px 6px", background: "var(--warning-soft)", color: "var(--warning)", flexShrink: 0 }}>
                    確認が必要
                  </span>
                )}
              </div>
            ))
          )}
        </div>
        <div style={{ display: "flex", gap: 16, padding: "9px 16px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-faint)" }}>
          <span>
            <span className="kbd">↑↓</span> 移動
          </span>
          <span>
            <span className="kbd">Enter</span> 実行
          </span>
          <span>
            <span className="kbd">Esc</span> 閉じる
          </span>
        </div>
      </div>
    </div>
  );
}
