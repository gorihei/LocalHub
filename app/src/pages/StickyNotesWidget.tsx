import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./sticky-notes.css";

type StickyColor = "yellow" | "pink" | "purple" | "blue" | "green" | "gray";
type StickyNote = {
  id: string;
  text: string;
  color: StickyColor;
  updatedAt: number;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  autoSize: boolean;
};
type LayoutMode = "grid" | "free";

const SETTINGS_KEY = "stickyNotes";
const LAYOUT_MODE_KEY = "stickyNotesLayoutMode";
const SAVE_DEBOUNCE_MS = 400;
const COLORS: StickyColor[] = ["yellow", "pink", "purple", "blue", "green", "gray"];

function sizeForText(text: string): { width: number; height: number } {
  const logicalLines = text.split("\n");
  const longestLine = logicalLines.reduce((max, line) => Math.max(max, Array.from(line).length), 0);
  const width = Math.max(180, Math.min(320, 145 + longestLine * 6.5));
  const charactersPerLine = Math.max(12, Math.floor((width - 28) / 6.5));
  const visualLines = logicalLines.reduce(
    (sum, line) => sum + Math.max(1, Math.ceil(Array.from(line).length / charactersPerLine)),
    0,
  );
  return { width: Math.round(width), height: Math.max(145, Math.min(360, 112 + visualLines * 19)) };
}

function newNote(index = 0): StickyNote {
  return {
    id: `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    text: "",
    color: "yellow",
    updatedAt: Date.now(),
    x: Math.min(0.72, (index % 6) * 0.1),
    y: Math.min(0.72, (index % 6) * 0.08),
    z: index + 1,
    width: 180,
    height: 145,
    autoSize: true,
  };
}

function sanitize(raw: unknown): StickyNote[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value, index): StickyNote[] => {
    if (!value || typeof value !== "object") return [];
    const note = value as Partial<StickyNote>;
    if (typeof note.id !== "string" || typeof note.text !== "string") return [];
    return [{
      id: note.id,
      text: note.text,
      color: COLORS.includes(note.color as StickyColor) ? note.color as StickyColor : "yellow",
      updatedAt: typeof note.updatedAt === "number" ? note.updatedAt : Date.now(),
      x: typeof note.x === "number" ? Math.max(0, Math.min(1, note.x)) : 0,
      y: typeof note.y === "number" ? Math.max(0, Math.min(1, note.y)) : 0,
      z: typeof note.z === "number" && Number.isFinite(note.z) ? Math.max(1, Math.round(note.z)) : index + 1,
      width: typeof note.width === "number" ? Math.max(170, Math.min(420, note.width)) : sizeForText(note.text).width,
      height: typeof note.height === "number" ? Math.max(135, Math.min(500, note.height)) : sizeForText(note.text).height,
      autoSize: typeof note.autoSize === "boolean" ? note.autoSize : true,
    }];
  });
}

export default function StickyNotesWidget() {
  const [notes, setNotes] = useState<StickyNote[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(true);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("grid");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestNotes = useRef<StickyNote[]>([]);
  const dirty = useRef(false);
  const mounted = useRef(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const resizeDrag = useRef<{ id: string; startX: number; startY: number; width: number; height: number } | null>(null);

  useEffect(() => {
    invoke<Record<string, string>>("settings_get_all")
      .then((settings) => {
        setLayoutMode(settings[LAYOUT_MODE_KEY] === "free" ? "free" : "grid");
        const value = settings[SETTINGS_KEY];
        if (!value) return;
        try {
          const parsed = JSON.parse(value);
          const restored = sanitize(parsed);
          latestNotes.current = restored;
          setNotes(restored);
          // 画像対応版で保存されたData URLを読み込み時に除去し、DB容量も回収する。
          if (JSON.stringify(parsed) !== JSON.stringify(restored)) {
            invoke("settings_set", { key: SETTINGS_KEY, value: JSON.stringify(restored) }).catch(() => {});
          }
        } catch {
          setNotes([]);
        }
      })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => () => {
    mounted.current = false;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (dirty.current) {
      invoke("settings_set", { key: SETTINGS_KEY, value: JSON.stringify(latestNotes.current) }).catch(() => {});
    }
  }, []);

  const commit = (next: StickyNote[]) => {
    setNotes(next);
    latestNotes.current = next;
    dirty.current = true;
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      invoke("settings_set", { key: SETTINGS_KEY, value: JSON.stringify(next) })
        .then(() => {
          dirty.current = false;
          if (mounted.current) setSaved(true);
        })
        .catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  };

  const updateNote = (id: string, patch: Partial<Pick<StickyNote, "text" | "color">>) => {
    commit(notes.map((note) => {
      if (note.id !== id) return note;
      const automaticSize = typeof patch.text === "string" && note.autoSize ? sizeForText(patch.text) : {};
      return { ...note, ...patch, ...automaticSize, updatedAt: Date.now() };
    }));
  };

  const setMode = (mode: LayoutMode) => {
    setLayoutMode(mode);
    invoke("settings_set", { key: LAYOUT_MODE_KEY, value: mode }).catch(() => {});
  };

  const bringToFront = (id: string) => {
    if (layoutMode !== "free") return;
    const maxZ = notes.reduce((max, note) => Math.max(max, note.z), 0);
    const selected = notes.find((note) => note.id === id);
    if (!selected || selected.z === maxZ) return;
    commit(notes.map((note) => note.id === id ? { ...note, z: maxZ + 1 } : note));
  };

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>, note: StickyNote) => {
    if (layoutMode !== "free" || (event.target as HTMLElement).closest("button")) return;
    const card = event.currentTarget.closest<HTMLElement>(".sticky-note");
    if (!card) return;
    const rect = card.getBoundingClientRect();
    drag.current = { id: note.id, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    setDraggingId(note.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    const container = listRef.current;
    const card = event.currentTarget.closest<HTMLElement>(".sticky-note");
    if (!current || !container || !card) return;
    const bounds = container.getBoundingClientRect();
    const maxX = Math.max(1, bounds.width - card.offsetWidth);
    const maxY = Math.max(1, bounds.height - card.offsetHeight);
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left - current.offsetX) / maxX));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top - current.offsetY) / maxY));
    commit(notes.map((note) => note.id === current.id ? { ...note, x, y, updatedAt: Date.now() } : note));
  };

  const beginResize = (event: ReactPointerEvent<HTMLSpanElement>, note: StickyNote) => {
    resizeDrag.current = {
      id: note.id,
      startX: event.clientX,
      startY: event.clientY,
      width: note.width,
      height: note.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const moveResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const current = resizeDrag.current;
    if (!current) return;
    const width = Math.max(170, Math.min(420, current.width + event.clientX - current.startX));
    const height = Math.max(135, Math.min(500, current.height + event.clientY - current.startY));
    commit(latestNotes.current.map((note) => note.id === current.id
      ? { ...note, width, height, autoSize: false, updatedAt: Date.now() }
      : note));
  };

  const endResize = () => {
    resizeDrag.current = null;
  };

  const restoreAutoSize = (id: string) => {
    commit(notes.map((note) => note.id === id
      ? { ...note, ...sizeForText(note.text), autoSize: true, updatedAt: Date.now() }
      : note));
  };

  const removeNote = (id: string) => {
    commit(notes.filter((note) => note.id !== id));
  };

  const addNote = () => {
    const note = newNote(notes.length);
    note.z = notes.reduce((max, item) => Math.max(max, item.z), 0) + 1;
    commit([...notes, note]);
  };

  return (
    <div className="sticky-notes-widget">
      <div className="sticky-notes-toolbar">
        <span>{notes.length}枚</span>
        <span className="sticky-notes-save-state">{saved ? "保存済み" : "保存中…"}</span>
        <div className="sticky-notes-layout-switch" role="group" aria-label="付箋の配置方法">
          <button className={layoutMode === "grid" ? "active" : ""} type="button" onClick={() => setMode("grid")}>グリッド</button>
          <button className={layoutMode === "free" ? "active" : ""} type="button" onClick={() => setMode("free")}>自由配置</button>
        </div>
        <button className="sticky-notes-add" type="button" onClick={addNote}>
          ＋ 付箋を追加
        </button>
      </div>

      <div ref={listRef} className={`sticky-notes-list sticky-notes-${layoutMode}`}>
        {notes.map((note) => (
          <article
            key={note.id}
            className={`sticky-note sticky-note-${note.color}`}
            onPointerDown={() => bringToFront(note.id)}
            style={{
              "--note-width": `${note.width}px`,
              "--note-height": `${note.height}px`,
              ...(layoutMode === "free" ? {
                "--note-left": `${note.x * 100}%`,
                "--note-top": `${note.y * 100}%`,
                "--note-shift-x": `${note.x * -100}%`,
                "--note-shift-y": `${note.y * -100}%`,
                zIndex: draggingId === note.id ? notes.reduce((max, item) => Math.max(max, item.z), 0) + 1 : note.z,
              } : {}),
            } as CSSProperties}
          >
            <div
              className="sticky-note-head"
              onPointerDown={(event) => beginDrag(event, note)}
              onPointerMove={moveDrag}
              onPointerUp={() => { drag.current = null; setDraggingId(null); }}
              onPointerCancel={() => { drag.current = null; setDraggingId(null); }}
            >
              <div className="sticky-note-colors" aria-label="付箋の色">
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`sticky-note-color sticky-note-color-${color}${note.color === color ? " active" : ""}`}
                    onClick={() => updateNote(note.id, { color })}
                    title={`${color}へ変更`}
                    aria-label={`${color}へ変更`}
                  />
                ))}
              </div>
              {!note.autoSize && (
                <button className="sticky-note-auto-size" type="button" onClick={() => restoreAutoSize(note.id)} title="内容に合わせて自動調整">
                  自動
                </button>
              )}
              <button className="sticky-note-delete" type="button" onClick={() => removeNote(note.id)} title="付箋を削除">
                ×
              </button>
            </div>
            <textarea
              value={note.text}
              onChange={(event) => updateNote(note.id, { text: event.target.value })}
              placeholder="メモを入力…"
              aria-label="付箋の本文"
            />
            <time dateTime={new Date(note.updatedAt).toISOString()}>
              {new Date(note.updatedAt).toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </time>
            <span
              className="sticky-note-resize"
              role="slider"
              aria-label="付箋のサイズを変更"
              aria-valuetext={`${Math.round(note.width)} × ${Math.round(note.height)}`}
              onPointerDown={(event) => beginResize(event, note)}
              onPointerMove={moveResize}
              onPointerUp={endResize}
              onPointerCancel={endResize}
            />
          </article>
        ))}
        {loaded && notes.length === 0 && (
          <button className="sticky-notes-empty" type="button" onClick={() => commit([newNote()])}>
            <strong>付箋はまだありません</strong>
            <span>クリックして最初の付箋を作成</span>
          </button>
        )}
      </div>
    </div>
  );
}
