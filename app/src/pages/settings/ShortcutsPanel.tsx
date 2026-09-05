import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const SHORTCUT_KEY_CODES = new Set([
  "Backquote", "Backslash", "BracketLeft", "BracketRight", "Comma", "Equal", "Minus", "Period", "Quote", "Semicolon", "Slash",
  "Backspace", "CapsLock", "Enter", "Space", "Tab", "Delete", "End", "Home", "Insert", "PageDown", "PageUp", "PrintScreen", "ScrollLock",
  "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "NumLock", "NumpadAdd", "NumpadDecimal", "NumpadDivide", "NumpadEnter",
  "NumpadEqual", "NumpadMultiply", "NumpadSubtract", "Escape", "Pause", "AudioVolumeDown", "AudioVolumeUp", "AudioVolumeMute",
  "MediaPlay", "MediaPause", "MediaPlayPause", "MediaStop", "MediaTrackNext", "MediaTrackPrevious",
]);

function pressedModifiers(event: React.KeyboardEvent<HTMLInputElement>): string[] {
  return [
    event.ctrlKey && "Ctrl",
    event.shiftKey && "Shift",
    event.altKey && "Alt",
    event.metaKey && "Super",
  ].filter((modifier): modifier is string => Boolean(modifier));
}

/** ブラウザの物理キーコードを、Tauriのグローバルショートカット表現へ変換する。 */
function shortcutFromKeyboardEvent(event: React.KeyboardEvent<HTMLInputElement>): string | null {
  const modifierCodes = new Set(["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"]);
  if (modifierCodes.has(event.code)) return null;

  let key: string | null = null;
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
  else if (/^Numpad[0-9]$/.test(event.code)) key = event.code;
  else if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.code)) key = event.code;
  else if (SHORTCUT_KEY_CODES.has(event.code)) key = event.code;
  if (!key) return null;

  return [...pressedModifiers(event), key].join("+");
}

export default function ShortcutsPanel() {
  const [enabled, setEnabled] = useState(true);
  const [shortcut, setShortcutValue] = useState("Ctrl+Shift+H");
  const [draft, setDraft] = useState("Ctrl+Shift+H");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordingPreview, setRecordingPreview] = useState("キーを入力…");

  const refresh = () => {
    invoke<{ shortcut: string; enabled: boolean }>("global_shortcut_status").then((s) => {
      setEnabled(s.enabled);
      setShortcutValue(s.shortcut);
      setDraft(s.shortcut);
    });
  };
  useEffect(refresh, []);

  const apply = async (nextEnabled: boolean, nextShortcut: string) => {
    setBusy(true);
    setMessage("");
    try {
      await invoke("global_shortcut_update", { shortcut: nextShortcut, enabled: nextEnabled });
      setEnabled(nextEnabled);
      setShortcutValue(nextShortcut);
      setMessage("保存しました");
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusy(false);
    }
  };

  const captureShortcut = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setMessage("");
    if (event.code === "Escape" && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
      setDraft(shortcut);
      setRecording(false);
      setRecordingPreview("キーを入力…");
      event.currentTarget.blur();
      return;
    }
    const captured = shortcutFromKeyboardEvent(event);
    if (captured) {
      setDraft(captured);
      setRecording(false);
      setRecordingPreview("キーを入力…");
      event.currentTarget.blur();
      return;
    }
    const modifiers = pressedModifiers(event);
    if (modifiers.length > 0) setRecordingPreview(`${modifiers.join("+")}+…`);
  };

  const updateModifierPreview = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const modifiers = pressedModifiers(event);
    setRecordingPreview(modifiers.length > 0 ? `${modifiers.join("+")}+…` : "キーを入力…");
  };

  return (
    <div className="panel-card" style={{ padding: "4px 18px" }}>
      <div className="setting-row">
        <div className="setting-label">
          <b>ウィンドウ表示・非表示の切り替え</b>
          <span>他のアプリを使っていてもLocal Hubを瞬時に呼び出せます(例: Ctrl+Shift+H)</span>
        </div>
        <button className={`toggle${enabled ? " on" : ""}`} disabled={busy} onClick={() => apply(!enabled, shortcut)} />
      </div>
      {enabled && (
        <div className="setting-row">
          <div className="setting-label">
            <b>キー割り当て</b>
            <span>入力欄をクリックして、割り当てたいキーの組み合わせを押してください</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={recording ? recordingPreview : draft}
              readOnly
              aria-label="ウィンドウ表示切り替えのショートカット"
              onFocus={() => {
                setRecording(true);
                setRecordingPreview("キーを入力…");
                setMessage("");
              }}
              onBlur={() => setRecording(false)}
              onKeyDown={captureShortcut}
              onKeyUp={updateModifierPreview}
              style={{ width: 180, cursor: "pointer", textAlign: "center" }}
            />
            <button className="btn" disabled={busy || draft === shortcut} onClick={() => apply(true, draft)}>
              適用
            </button>
          </div>
        </div>
      )}
      {message && (
        <div className="setting-row">
          <span style={{ fontSize: 12, color: message === "保存しました" ? "var(--text-muted)" : "var(--danger)" }}>{message}</span>
        </div>
      )}
    </div>
  );
}


