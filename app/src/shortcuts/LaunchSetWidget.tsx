// FR-LAUNCH-005 起動セット。付録Bダッシュボードウィジェット「起動セット」。
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  listLaunchSets,
  listShortcuts,
  addLaunchSet,
  deleteLaunchSet,
  runLaunchSet,
  type LaunchSet,
  type LaunchResult,
  type Shortcut,
} from "./shortcuts";

function CreateLaunchSetModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [selected, setSelected] = useState<number[]>([]);

  useEffect(() => {
    listShortcuts().then(setShortcuts).catch(console.error);
  }, []);

  const toggle = (id: number) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const submit = async () => {
    if (!name.trim() || selected.length === 0) return;
    await addLaunchSet(name, selected);
    onCreated();
    onClose();
  };

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(4,6,10,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ width: 360, background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--radius-m)", padding: 18 }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 14.5 }}>起動セットを作成</h3>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名前(例: 開発開始)" style={{ width: "100%", marginBottom: 10 }} autoFocus />
        <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 6 }}>含めるショートカット(選んだ順に実行)</div>
        <div style={{ maxHeight: 200, overflowY: "auto", marginBottom: 14 }}>
          {shortcuts.map((s) => (
            <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", fontSize: 12.5, cursor: "pointer" }}>
              <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
              {s.name}
              {selected.includes(s.id) && (
                <span style={{ marginLeft: "auto", color: "var(--text-faint)", fontSize: 11 }}>
                  #{selected.indexOf(s.id) + 1}
                </span>
              )}
            </label>
          ))}
          {shortcuts.length === 0 && <span style={{ fontSize: 12, color: "var(--text-faint)" }}>先にショートカットを登録してください</span>}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn" style={{ background: "var(--accent)", color: "#062226", borderColor: "var(--accent)" }} onClick={submit}>
            作成
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function LaunchSetWidget() {
  const [sets, setSets] = useState<LaunchSet[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [results, setResults] = useState<Record<number, LaunchResult[]>>({});
  const [running, setRunning] = useState<number | null>(null);

  const refresh = () => listLaunchSets().then(setSets).catch(console.error);
  useEffect(() => {
    refresh();
  }, []);

  const run = async (id: number) => {
    setRunning(id);
    try {
      const result = await runLaunchSet(id);
      setResults((prev) => ({ ...prev, [id]: result }));
    } finally {
      setRunning(null);
    }
  };

  return (
    <div>
      {showCreate && <CreateLaunchSetModal onClose={() => setShowCreate(false)} onCreated={refresh} />}
      {sets.length === 0 ? (
        <span style={{ color: "var(--text-faint)" }}>起動セットはまだありません</span>
      ) : (
        sets.map((set) => {
          const result = results[set.id];
          return (
            <div key={set.id} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1 }}>{set.name}</span>
                <button className="icon-btn" onClick={() => run(set.id)} disabled={running === set.id} title="実行">
                  <svg viewBox="0 0 20 20" fill="currentColor">
                    <path d="M6 4l10 6-10 6z" />
                  </svg>
                </button>
                <button className="icon-btn" onClick={() => deleteLaunchSet(set.id).then(refresh)} title="削除">
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <line x1="6" y1="6" x2="14" y2="14" />
                    <line x1="14" y1="6" x2="6" y2="14" />
                  </svg>
                </button>
              </div>
              {result && (
                <div style={{ fontSize: 10.5, marginTop: 3 }}>
                  {result.map((r, i) => (
                    <div key={i} style={{ color: r.success ? "var(--success)" : "var(--danger)" }}>
                      {r.success ? "✓" : "✕"} {r.name}
                      {!r.success && `: ${r.error}`}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
      <button className="btn" style={{ marginTop: 6 }} onClick={() => setShowCreate(true)}>
        + 起動セットを作成
      </button>
    </div>
  );
}
