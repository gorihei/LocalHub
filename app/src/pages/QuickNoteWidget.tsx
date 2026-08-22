// 付録B ダッシュボードウィジェット「クイックメモ」(§4.2 v1候補だが単純な
// 1件のテキストメモとしてMVPダッシュボードにも同梱する)。
// SQLiteのapp_settingsに1キーとして保存する(複数メモ管理は将来の拡張)。
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const SETTINGS_KEY = "quickNote";
const SAVE_DEBOUNCE_MS = 500;

export default function QuickNoteWidget() {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    invoke<Record<string, string>>("settings_get_all")
      .then((s) => setText(s[SETTINGS_KEY] ?? ""))
      .catch(() => {});
  }, []);

  const onChange = (value: string) => {
    setText(value);
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      invoke("settings_set", { key: SETTINGS_KEY, value })
        .then(() => setSaved(true))
        .catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder="メモを入力…(自動保存されます)"
        style={{
          flex: 1,
          resize: "none",
          border: "none",
          background: "none",
          padding: 0,
          fontSize: 12.5,
          lineHeight: 1.6,
          color: "var(--text)",
        }}
      />
      <div style={{ fontSize: 10, color: "var(--text-faint)", textAlign: "right", flexShrink: 0 }}>{saved ? "保存済み" : "保存中…"}</div>
    </div>
  );
}
