// §6.2 プラグイン管理画面。マニフェスト(FR-PLUG-005)・ライフサイクル状態
// (FR-PLUG-002)・権限ブローカー(§10)をサイドカーIPC(plugin_host)に実配線している。
// FR-PLUG-003「ローカルパッケージから導入」: フォルダ選択でプラグインを追加できる。
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { executeCommand } from "../commandBus/commandBus";
import ConfirmDialog from "../commandBus/ConfirmDialog";
import PluginPageFrame from "./PluginPageFrame";
import PluginSettingsPanel, { type SettingDefinition } from "./PluginSettingsPanel";
import "./pages.css";

type PluginState = "installed" | "disabled" | "starting" | "running" | "degraded" | "failed" | "updating";

type CommandContribution = {
  id: string;
  title: string;
  description: string;
  riskLevel: number;
};

type PageContribution = { id: string; title: string; entry: string };

type PluginManifest = {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  entry: string;
  description: string;
  author: string;
  trust: string;
  permissions: string[];
  contributes: { commands: CommandContribution[]; pages: PageContribution[]; settings?: SettingDefinition[] };
};

type PluginStatusInfo = {
  manifest: PluginManifest;
  state: PluginState;
};

type PermissionGrant = { permission: string; granted: boolean };

const STATE_PILL: Record<PluginState, { cls: string; label: string }> = {
  installed: { cls: "pill-stopped", label: "インストール済み" },
  disabled: { cls: "pill-stopped", label: "無効" },
  starting: { cls: "pill-running", label: "起動中" },
  running: { cls: "pill-running", label: "実行中" },
  degraded: { cls: "pill-failed", label: "一部制限" },
  failed: { cls: "pill-failed", label: "失敗" },
  updating: { cls: "pill-running", label: "更新中" },
};

const TRUST_LABEL: Record<string, string> = {
  official: "信頼済み公式",
  "local-dev": "ローカル開発",
  unverified: "未確認",
};

export default function PluginsPage() {
  const [plugins, setPlugins] = useState<PluginStatusInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<PermissionGrant[]>([]);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [lastCommandResult, setLastCommandResult] = useState<string>("");
  const [installError, setInstallError] = useState("");
  const [uninstallTarget, setUninstallTarget] = useState<PluginStatusInfo | null>(null);

  const refreshList = () => {
    invoke<PluginStatusInfo[]>("plugin_list")
      .then((list) => {
        setPlugins(list);
        setSelectedId((prev) => (prev && list.some((p) => p.manifest.id === prev) ? prev : (list[0]?.manifest.id ?? null)));
      })
      .catch((err) => console.error("プラグイン一覧の取得に失敗しました:", err));
  };

  const refreshPermissions = (id: string) => {
    invoke<PermissionGrant[]>("permissions_list", { pluginId: id }).then(setPermissions);
  };

  useEffect(() => {
    refreshList();
    const unlisten = listen("plugin://exited", refreshList);
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (selectedId) refreshPermissions(selectedId);
    setLogs([]);
    setLastCommandResult("");
  }, [selectedId]);

  const selected = plugins.find((p) => p.manifest.id === selectedId) ?? null;

  const start = async (id: string) => {
    setBusy(true);
    try {
      await invoke("plugin_start", { id });
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
      refreshList();
    }
  };

  const reenable = async (id: string) => {
    setBusy(true);
    try {
      await invoke("plugin_reenable", { id });
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
      refreshList();
    }
  };

  const restart = async (id: string) => {
    setBusy(true);
    try {
      await invoke("plugin_restart", { id });
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
      refreshList();
    }
  };

  const refreshLogs = async (id: string) => {
    try {
      setLogs(await invoke<string[]>("plugin_recent_logs", { id }));
    } catch {
      // ログ取得の失敗はUI継続に影響させない
    }
  };

  const togglePermission = async (pluginId: string, permission: string, granted: boolean) => {
    await invoke("permissions_set", { pluginId, permission, granted });
    setPermissions((prev) => {
      const existing = prev.find((p) => p.permission === permission);
      if (existing) return prev.map((p) => (p.permission === permission ? { ...p, granted } : p));
      return [...prev, { permission, granted }];
    });
  };

  const addPlugin = async () => {
    setInstallError("");
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    setBusy(true);
    try {
      await invoke("plugins_install", { srcDir: dir });
      refreshList();
    } catch (err) {
      setInstallError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const runUninstall = async () => {
    const target = uninstallTarget;
    setUninstallTarget(null);
    if (!target) return;
    setBusy(true);
    try {
      await invoke("plugins_uninstall", { id: target.manifest.id });
      refreshList();
    } catch (err) {
      setInstallError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>プラグイン</h1>
          <p>検出済み {plugins.length}件</p>
        </div>
        <button className="btn" disabled={busy} onClick={addPlugin}>
          + プラグインを追加(フォルダから)
        </button>
      </div>

      {uninstallTarget && (
        <ConfirmDialog
          title="プラグインをアンインストールしますか?"
          actor="ユーザー(手動実行)"
          action={`「${uninstallTarget.manifest.name}」を削除する`}
          target={uninstallTarget.manifest.id}
          impact="ファイル、設定、APIキー、権限許可、ダッシュボード配置、関連する自動化がすべて削除されます"
          reversibility="元に戻せません(再度導入すれば復元できます)"
          requiredPermissions="なし"
          onConfirm={runUninstall}
          onCancel={() => setUninstallTarget(null)}
        />
      )}

      {installError && (
        <div className="panel-card" style={{ padding: 12, marginBottom: 12, color: "var(--danger)", fontSize: 12.5 }}>
          {installError}
        </div>
      )}

      <div className="panel-card" style={{ overflowX: "auto" }}>
        <table className="plugin-table">
          <thead>
            <tr>
              <th>プラグイン</th>
              <th>状態</th>
              <th>種別</th>
              <th>バージョン</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {plugins.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: "var(--text-faint)", padding: 16 }}>
                  プラグインが見つかりません。「+ プラグインを追加」からmanifest.jsonを含むフォルダを選んでください。
                </td>
              </tr>
            )}
            {plugins.map(({ manifest, state }) => {
              const pill = STATE_PILL[state];
              return (
                <tr
                  key={manifest.id}
                  onClick={() => setSelectedId(manifest.id)}
                  style={{ cursor: "pointer", background: manifest.id === selectedId ? "var(--surface-hover)" : undefined }}
                >
                  <td>
                    <div className="plugin-name">
                      <div>
                        <b>{manifest.name}</b>
                        <div className="row-sub">{manifest.description}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`pill ${pill.cls}`}>{pill.label}</span>
                  </td>
                  <td>{TRUST_LABEL[manifest.trust] ?? manifest.trust}</td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{manifest.version}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="table-actions">
                      {state === "disabled" && (
                        <button className="btn" disabled={busy} onClick={() => reenable(manifest.id)} title="クラッシュ連続により無効化されています">
                          有効化
                        </button>
                      )}
                      <button
                        className="btn"
                        disabled={busy || state === "running" || state === "starting" || state === "disabled"}
                        onClick={() => start(manifest.id)}
                      >
                        起動
                      </button>
                      <button className="btn" disabled={busy || state === "disabled"} onClick={() => restart(manifest.id)}>
                        再起動
                      </button>
                      <button className="btn" onClick={() => refreshLogs(manifest.id)}>
                        ログ
                      </button>
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() => setUninstallTarget(plugins.find((p) => p.manifest.id === manifest.id) ?? null)}
                      >
                        削除
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
            <div className="panel-card" style={{ padding: 14 }}>
              <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 10 }}>
                提供コマンド(manifest.contributes.commands)
              </div>
              {lastCommandResult && (
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    marginBottom: 8,
                    fontFamily: "var(--font-mono)",
                    wordBreak: "break-all",
                  }}
                >
                  {lastCommandResult}
                </div>
              )}
              {selected.manifest.contributes.commands.length === 0 ? (
                <span style={{ fontSize: 12, color: "var(--text-faint)" }}>このプラグインはコマンドを提供していません</span>
              ) : (
                selected.manifest.contributes.commands.map((c) => (
                  <div
                    key={c.id}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}
                  >
                    <div style={{ fontSize: 12 }}>
                      <b>{c.title}</b>
                      <div style={{ color: "var(--text-faint)", fontSize: 11 }}>{c.description}</div>
                    </div>
                    <button
                      className="btn"
                      onClick={async () => {
                        try {
                          const result = await executeCommand(`plugin.${selected.manifest.id}.${c.id}`);
                          setLastCommandResult(`[${c.title}] 成功: ${JSON.stringify(result)}`);
                        } catch (err) {
                          setLastCommandResult(`[${c.title}] エラー: ${String(err)}`);
                        }
                      }}
                    >
                      実行
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="panel-card" style={{ padding: 14 }}>
              <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 10 }}>
                権限(§10) — 既定は未許可(FR-PERM-004)
              </div>
              {selected.manifest.permissions.length === 0 ? (
                <span style={{ fontSize: 12, color: "var(--text-faint)" }}>このプラグインは権限を要求していません</span>
              ) : (
                selected.manifest.permissions.map((perm) => {
                  const granted = permissions.find((p) => p.permission === perm)?.granted ?? false;
                  return (
                    <div
                      key={perm}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}
                    >
                      <span style={{ fontSize: 12 }}>{perm}</span>
                      <button
                        className={`toggle${granted ? " on" : ""}`}
                        onClick={() => togglePermission(selected.manifest.id, perm, !granted)}
                      />
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {selected.manifest.contributes.settings && selected.manifest.contributes.settings.length > 0 && (
            <PluginSettingsPanel pluginId={selected.manifest.id} settings={selected.manifest.contributes.settings} />
          )}

          {/* §10「プラグインWebView埋め込み」: プラグインが宣言したページ(contributes.pages)を
              汎用のiframeで描画する。プラグインIDごとの専用React実装は不要
              (以前はここにプラグインID決め打ちのパネルをハードコードしていたが、
              スケールしないためこの仕組みに置き換えた)。 */}
          {selected.manifest.contributes.pages?.map((page) => (
            <div key={page.id} className="panel-card" style={{ padding: 14, marginTop: 16 }}>
              <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 10 }}>{page.title}</div>
              <PluginPageFrame pluginId={selected.manifest.id} entry={page.entry} />
            </div>
          ))}

          {logs.length > 0 && (
            <div className="panel-card" style={{ marginTop: 16, padding: 12 }}>
              <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 6 }}>直近のログ(標準エラー出力)</div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--text-muted)",
                  maxHeight: 160,
                  overflowY: "auto",
                }}
              >
                {logs.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
