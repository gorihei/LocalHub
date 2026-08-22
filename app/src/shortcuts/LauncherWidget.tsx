// 付録B ダッシュボードウィジェット「アプリランチャー」。
// 編集モードでは: ①名前/対象の編集、③並べ替え ができる。
//
// 並べ替えはHTML5のネイティブdraggable属性ではなく、マウスイベント(pointer)を
// 直接扱う方式にしている。WebView2環境ではネイティブdrag&dropのdragover/drop
// イベントが安定して発火しないことを実機で確認したため
// (react-grid-layoutのダッシュボードグリッドが同じくpointerベースで、
// そちらは問題なく動くこととも整合する)。
import { useEffect, useRef, useState } from "react";
import { listShortcuts, deleteShortcut, reorderShortcuts, onShortcutsChanged, type Shortcut } from "./shortcuts";
import { useLaunchShortcut } from "./useLaunchShortcut";
import AddShortcutModal from "./AddShortcutModal";
import ShortcutIcon from "./ShortcutIcon";
import { isLauncherEditing, onLauncherEditingChanged } from "./launcherEditing";
import { requestNewTerminalTab } from "../terminalTabEvents";

export default function LauncherWidget() {
  const [items, setItems] = useState<Shortcut[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<Shortcut | null>(null);
  const [editing, setEditing] = useState(isLauncherEditing);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  useEffect(() => onLauncherEditingChanged(setEditing), []);

  const itemsRef = useRef<Shortcut[]>(items);
  itemsRef.current = items;
  const dragStartIndex = useRef<number | null>(null);
  const didDrag = useRef(false);
  const tileRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const refresh = () => listShortcuts().then(setItems).catch(console.error);
  useEffect(() => {
    refresh();
    return onShortcutsChanged(refresh);
  }, []);

  const { launch, dialog } = useLaunchShortcut(refresh);

  const indexAtPoint = (x: number, y: number): number | null => {
    for (const [id, el] of tileRefs.current) {
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return itemsRef.current.findIndex((s) => s.id === id);
      }
    }
    return null;
  };

  const startDrag = (startIndex: number, e: React.MouseEvent) => {
    if (!editing) return;
    e.preventDefault();
    dragStartIndex.current = startIndex;
    didDrag.current = false;
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (ev: MouseEvent) => {
      if (!didDrag.current && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4) {
        didDrag.current = true;
      }
      if (didDrag.current) {
        setDragOverIndex(indexAtPoint(ev.clientX, ev.clientY));
      }
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const from = dragStartIndex.current;
      const to = indexAtPoint(ev.clientX, ev.clientY);
      dragStartIndex.current = null;
      setDragOverIndex(null);
      if (didDrag.current && from !== null && to !== null && from !== to) {
        const next = [...itemsRef.current];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        setItems(next);
        reorderShortcuts(next.map((s) => s.id));
      }
      // クリックとして扱わせないよう、直後のonClickでdidDrag.currentを見て無視する。
      setTimeout(() => (didDrag.current = false), 0);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div>
      {dialog}
      {showAdd && <AddShortcutModal onClose={() => setShowAdd(false)} onAdded={refresh} />}
      {editTarget && (
        <AddShortcutModal editTarget={editTarget} onClose={() => setEditTarget(null)} onAdded={refresh} />
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(60px, 1fr))", gap: "12px 6px" }}>
        {items.map((s, index) => (
          <div
            key={s.id}
            ref={(el) => {
              if (el) tileRefs.current.set(s.id, el);
              else tileRefs.current.delete(s.id);
            }}
            onMouseDown={(e) => startDrag(index, e)}
            style={{
              position: "relative",
              textAlign: "center",
              borderRadius: 8,
              outline: dragOverIndex === index ? "2px dashed var(--accent)" : "none",
              outlineOffset: 2,
              cursor: editing ? "grab" : undefined,
            }}
          >
            <button
              onClick={() => {
                if (didDrag.current) return;
                editing ? setEditTarget(s) : launch(s);
              }}
              onContextMenu={(e) => {
                // FR-CLI-003: フォルダーは右クリックで「ここでターミナルを開く」。
                if (editing || s.kind !== "folder") return;
                e.preventDefault();
                requestNewTerminalTab({ cwd: s.target, title: s.name });
              }}
              title={s.kind === "folder" ? `${s.target}\n右クリック: ここでターミナルを開く` : s.description || s.target}
              style={{
                width: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 5,
                padding: "6px 2px",
                background: "none",
                border: "none",
                cursor: editing ? "inherit" : "pointer",
                color: "var(--text)",
                borderRadius: 8,
                transition: "background var(--transition)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              <ShortcutIcon shortcut={s} size={32} />
              <span
                style={{
                  fontSize: 10.5,
                  color: "var(--text-muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "100%",
                  pointerEvents: "none",
                }}
              >
                {s.name}
              </span>
            </button>
            {editing && (
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteShortcut(s.id).then(refresh);
                }}
                title="削除"
                style={{
                  position: "absolute",
                  top: -6,
                  right: -2,
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "var(--danger)",
                  border: "2px solid var(--surface)",
                  color: "#2a0a0a",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  padding: 0,
                  zIndex: 1,
                }}
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 11, height: 11 }}>
                  <line x1="5" y1="5" x2="15" y2="15" />
                  <line x1="15" y1="5" x2="5" y2="15" />
                </svg>
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() => setShowAdd(true)}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
            padding: "6px 2px",
            background: "none",
            border: "1px dashed var(--border)",
            borderRadius: 8,
            cursor: "pointer",
            color: "var(--text-faint)",
            minHeight: 58,
          }}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" style={{ width: 16, height: 16 }}>
            <line x1="10" y1="5" x2="10" y2="15" />
            <line x1="5" y1="10" x2="15" y2="10" />
          </svg>
          <span style={{ fontSize: 9.5 }}>追加</span>
        </button>
      </div>
    </div>
  );
}
