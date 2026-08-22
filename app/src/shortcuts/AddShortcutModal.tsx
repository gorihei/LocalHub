// FR-LAUNCH-002 ショートカット属性の入力フォーム。追加・編集の両方に使う。
// ダッシュボードウィジェット(transform付き祖先)から開かれるため、
// document.body直下へポータル描画してposition:fixedのずれを防ぐ。
import { useState } from "react";
import { createPortal } from "react-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { addShortcut, updateShortcut, type Shortcut, type ShortcutKind } from "./shortcuts";

type Props = {
  onClose: () => void;
  onAdded: () => void;
  /** 指定するとこのショートカットを編集するモードになる。 */
  editTarget?: Shortcut;
};

const KIND_OPTIONS: { value: ShortcutKind; label: string; placeholder: string }[] = [
  { value: "app", label: "アプリ(実行ファイル)", placeholder: "C:\\Path\\to\\app.exe" },
  { value: "file", label: "ファイル", placeholder: "C:\\Path\\to\\file.txt" },
  { value: "folder", label: "フォルダー", placeholder: "C:\\Path\\to\\folder" },
  { value: "url", label: "URL", placeholder: "https://example.com" },
  { value: "command", label: "CLIコマンド", placeholder: "git status" },
];

export default function AddShortcutModal({ onClose, onAdded, editTarget }: Props) {
  const [name, setName] = useState(editTarget?.name ?? "");
  const [kind, setKind] = useState<ShortcutKind>(editTarget?.kind ?? "app");
  const [target, setTarget] = useState(editTarget?.target ?? "");
  const [args, setArgs] = useState(editTarget?.args ?? "");
  const [admin, setAdmin] = useState(editTarget?.admin ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!name.trim() || !target.trim()) {
      setError("名前と対象は必須です");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (editTarget) {
        await updateShortcut(editTarget.id, { name, kind, target, args, admin });
      } else {
        await addShortcut({ name, kind, target, args, admin });
      }
      onAdded();
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const kindOption = KIND_OPTIONS.find((k) => k.value === kind)!;

  const browse = async () => {
    const selected = await open({
      directory: kind === "folder",
      multiple: false,
      filters: kind === "app" ? [{ name: "実行ファイル", extensions: ["exe"] }] : undefined,
    });
    if (typeof selected !== "string") return;
    setTarget(selected);
    if (!name.trim()) {
      const base = selected.split(/[\\/]/).pop() ?? selected;
      setName(kind === "app" ? base.replace(/\.exe$/i, "") : base);
    }
  };

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(4,6,10,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ width: 380, background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--radius-m)", padding: 18 }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 14.5 }}>{editTarget ? "ショートカットを編集" : "ショートカットを追加"}</h3>

        <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>名前</label>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", marginBottom: 10 }} autoFocus />

        <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>種類</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as ShortcutKind)} style={{ width: "100%", marginBottom: 10 }}>
          {KIND_OPTIONS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>

        <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>対象</label>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={kindOption.placeholder}
            style={{ flex: 1 }}
          />
          {kind !== "url" && kind !== "command" && (
            <button className="btn" onClick={browse} type="button">
              参照…
            </button>
          )}
        </div>

        {kind === "app" && (
          <>
            <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>
              引数(任意)
            </label>
            <input value={args} onChange={(e) => setArgs(e.target.value)} style={{ width: "100%", marginBottom: 10 }} />
          </>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
          管理者権限で実行する(起動のたびに確認が表示されます)
        </label>

        {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 10 }}>{error}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn btn-primary" style={{ background: "var(--accent)", color: "#062226", borderColor: "var(--accent)" }} disabled={saving} onClick={submit}>
            {editTarget ? "保存" : "追加"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
