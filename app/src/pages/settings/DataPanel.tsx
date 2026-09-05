import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, open as openDialog } from "@tauri-apps/plugin-dialog";
import ConfirmDialog from "../../commandBus/ConfirmDialog";

export default function DataPanel() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [importTarget, setImportTarget] = useState<string | null>(null);

  const exportBackup = async () => {
    const dest = await save({
      defaultPath: `local-hub-backup-${new Date().toISOString().slice(0, 10)}.sqlite3`,
      filters: [{ name: "Local Hub バックアップ", extensions: ["sqlite3"] }],
    });
    if (!dest) return;
    setBusy(true);
    setMessage("");
    try {
      await invoke("backup_export", { destPath: dest });
      setMessage(`エクスポートしました: ${dest}`);
    } catch (err) {
      setMessage(`エクスポートに失敗しました: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const pickImportFile = async () => {
    const src = await openDialog({
      multiple: false,
      filters: [{ name: "Local Hub バックアップ", extensions: ["sqlite3"] }],
    });
    if (typeof src === "string") setImportTarget(src);
  };

  const runImport = async () => {
    const src = importTarget;
    setImportTarget(null);
    if (!src) return;
    setBusy(true);
    try {
      await invoke("backup_import_stage", { srcPath: src });
      await invoke("app_restart");
    } catch (err) {
      setMessage(`インポートの準備に失敗しました: ${String(err)}`);
      setBusy(false);
    }
  };

  return (
    <div className="panel-card" style={{ padding: "4px 18px" }}>
      {importTarget && (
        <ConfirmDialog
          title="バックアップをインポートしますか?"
          actor="ユーザー(手動実行)"
          action="選択したバックアップファイルで現在のデータを置き換える"
          target={importTarget}
          impact="ショートカット・起動セット・設定・通知履歴がすべて置き換わります(シークレットは対象外)。反映のためアプリが自動的に再起動します。"
          reversibility="現在のデータはインポート前に自動的に退避されるため、必要なら手動で戻せます"
          requiredPermissions="なし"
          onConfirm={runImport}
          onCancel={() => setImportTarget(null)}
        />
      )}
      <div className="setting-row">
        <div className="setting-label">
          <b>エクスポート</b>
          <span>ショートカット・起動セット・設定・通知履歴をファイルに書き出します(シークレットは含まれません)</span>
        </div>
        <button className="btn" disabled={busy} onClick={exportBackup}>
          エクスポート…
        </button>
      </div>
      <div className="setting-row">
        <div className="setting-label">
          <b>インポート</b>
          <span>バックアップファイルから復元します。反映にはアプリの再起動が必要です</span>
        </div>
        <button className="btn" disabled={busy} onClick={pickImportFile}>
          インポート…
        </button>
      </div>
      {message && (
        <div className="setting-row">
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{message}</span>
        </div>
      )}
    </div>
  );
}


