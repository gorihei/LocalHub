// §6.10 設定, §8.5 カスタマイズ, §14 移行・バックアップ。
// 実際の読み込み・保存はSettingsContext(SQLiteのapp_settingsテーブル)が担う。
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { isEnabled as autostartIsEnabled, enable as autostartEnable, disable as autostartDisable } from "@tauri-apps/plugin-autostart";
import "./pages.css";
import { executeCommand } from "../commandBus/commandBus";
import { useSettings, ACCENT_COLORS, type Accent } from "../settings/SettingsContext";
import ConfirmDialog from "../commandBus/ConfirmDialog";

type SettingsTab = "appearance" | "general" | "shortcuts" | "data" | "logs";

function DataPanel() {
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

function GeneralPanel() {
  const [autostart, setAutostart] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [closeBehavior, setCloseBehaviorState] = useState<"tray" | "exit">("tray");
  const [error, setError] = useState("");

  useEffect(() => {
    autostartIsEnabled()
      .then(setAutostart)
      .catch((err) => setError(String(err)));
    invoke<Record<string, string>>("settings_get_all")
      .then((s) => setCloseBehaviorState(s.closeBehavior === "exit" ? "exit" : "tray"))
      .catch(() => {});
  }, []);

  const toggleAutostart = async () => {
    setAutostartBusy(true);
    setError("");
    try {
      if (autostart) await autostartDisable();
      else await autostartEnable();
      setAutostart(!autostart);
    } catch (err) {
      setError(`自動起動の設定に失敗しました: ${String(err)}`);
    } finally {
      setAutostartBusy(false);
    }
  };

  const setCloseBehavior = (v: "tray" | "exit") => {
    setCloseBehaviorState(v);
    invoke("settings_set", { key: "closeBehavior", value: v }).catch((err) => setError(String(err)));
  };

  return (
    <div className="panel-card" style={{ padding: "4px 18px" }}>
      <div className="setting-row">
        <div className="setting-label">
          <b>Windows起動時に自動起動</b>
          <span>サインイン時にLocal Hubを自動的に起動します</span>
        </div>
        <button className={`toggle${autostart ? " on" : ""}`} disabled={autostartBusy} onClick={toggleAutostart} />
      </div>
      <div className="setting-row">
        <div className="setting-label">
          <b>閉じるボタンの動作</b>
          <span>ウィンドウを閉じたときにトレイへ格納するか、アプリを終了するか</span>
        </div>
        <div className="segmented">
          <button className={closeBehavior === "tray" ? "active" : ""} onClick={() => setCloseBehavior("tray")}>
            トレイに格納
          </button>
          <button className={closeBehavior === "exit" ? "active" : ""} onClick={() => setCloseBehavior("exit")}>
            終了する
          </button>
        </div>
      </div>
      {error && (
        <div className="setting-row">
          <span style={{ fontSize: 12, color: "var(--danger)" }}>{error}</span>
        </div>
      )}
    </div>
  );
}

function ShortcutsPanel() {
  const [enabled, setEnabled] = useState(true);
  const [shortcut, setShortcutValue] = useState("Ctrl+Shift+H");
  const [draft, setDraft] = useState("Ctrl+Shift+H");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

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
            <span>例: Ctrl+Shift+H / Alt+Space</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} style={{ width: 160 }} />
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

function LogsPanel() {
  const [lines, setLines] = useState<string[]>([]);
  const [dir, setDir] = useState("");

  const refresh = () => {
    invoke<string[]>("logs_recent", { limit: 200 }).then(setLines);
    invoke<string>("log_dir_path").then(setDir);
  };
  useEffect(refresh, []);

  return (
    <div className="panel-card" style={{ padding: "4px 18px" }}>
      <div className="setting-row">
        <div className="setting-label">
          <b>ログフォルダー</b>
          <span style={{ wordBreak: "break-all" }}>{dir || "取得中…"}</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={refresh}>
            更新
          </button>
          <button className="btn" disabled={!dir} onClick={() => dir && openPath(dir)}>
            フォルダーを開く
          </button>
        </div>
      </div>
      <div style={{ padding: "10px 4px 14px" }}>
        <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 6 }}>直近の警告・エラー(最大200件)</div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-muted)",
            maxHeight: 260,
            overflowY: "auto",
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-s)",
            padding: 8,
          }}
        >
          {lines.length === 0 ? <span style={{ color: "var(--text-faint)" }}>警告・エラーはありません</span> : lines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("appearance");
  const {
    accent,
    density,
    fontScale,
    reducedMotion,
    osNotifications,
    setAccent,
    setDensity,
    setFontScale,
    setReducedMotion,
    setOsNotifications,
  } = useSettings();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>設定</h1>
          <p>外観のカスタマイズはリアルタイムに反映され、再起動後も保持されます</p>
        </div>
      </div>
      <div className="settings-layout">
        <div className="settings-nav">
          <button className={tab === "appearance" ? "active" : ""} onClick={() => setTab("appearance")}>
            外観
          </button>
          <button className={tab === "general" ? "active" : ""} onClick={() => setTab("general")}>
            一般
          </button>
          <button className={tab === "shortcuts" ? "active" : ""} onClick={() => setTab("shortcuts")}>
            ショートカット
          </button>
          <button className={tab === "data" ? "active" : ""} onClick={() => setTab("data")}>
            データ
          </button>
          <button className={tab === "logs" ? "active" : ""} onClick={() => setTab("logs")}>
            ログ
          </button>
        </div>
        {tab === "data" && <DataPanel />}
        {tab === "general" && <GeneralPanel />}
        {tab === "shortcuts" && <ShortcutsPanel />}
        {tab === "logs" && <LogsPanel />}
        {tab === "appearance" && (
          <div className="panel-card" style={{ padding: "4px 18px" }}>
            <div className="setting-row">
              <div className="setting-label">
                <b>アクセントカラー</b>
                <span>コマンドパレットやアクティブ状態の強調色</span>
              </div>
              <div className="swatches">
                {(Object.keys(ACCENT_COLORS) as Accent[]).map((key) => (
                  <div
                    key={key}
                    className={`swatch${accent === key ? " selected" : ""}`}
                    style={{ background: ACCENT_COLORS[key].accent }}
                    onClick={() => setAccent(key)}
                    title={key}
                  />
                ))}
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-label">
                <b>UI密度</b>
                <span>情報密度と余白のバランスを調整します</span>
              </div>
              <div className="segmented">
                <button className={density === "comfortable" ? "active" : ""} onClick={() => setDensity("comfortable")}>
                  ゆったり
                </button>
                <button className={density === "compact" ? "active" : ""} onClick={() => setDensity("compact")}>
                  コンパクト
                </button>
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-label">
                <b>フォントサイズ</b>
                <span>UI全体の文字サイズを調整します</span>
              </div>
              <div className="range-wrap">
                <input
                  type="range"
                  min={90}
                  max={120}
                  value={fontScale}
                  onChange={(e) => setFontScale(Number(e.target.value))}
                />
                <output>{fontScale}%</output>
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-label">
                <b>アニメーションを軽減</b>
                <span>トランジションとモーションを最小限にします</span>
              </div>
              <button
                className={`toggle${reducedMotion ? " on" : ""}`}
                onClick={() => setReducedMotion(!reducedMotion)}
              />
            </div>
            <div className="setting-row">
              <div className="setting-label">
                <b>OS通知を使う</b>
                <span>通知をWindowsのトースト通知としても表示します(§6.9)</span>
              </div>
              <button
                className={`toggle${osNotifications ? " on" : ""}`}
                onClick={() => setOsNotifications(!osNotifications)}
              />
            </div>
            <div className="setting-row">
              <div className="setting-label">
                <b>通知のテスト</b>
                <span>通知パイプライン(履歴・トースト・OS通知)の疎通を確認します</span>
              </div>
              <button className="btn" onClick={() => executeCommand("notifications.sendTest")}>
                テスト通知を送る
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
