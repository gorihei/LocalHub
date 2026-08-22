import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type SettingDefinition = {
  id: string;
  type: "string" | "secret" | "boolean" | "number" | "select";
  title: string;
  description?: string;
  default?: unknown;
  options?: { value: unknown; label: string }[];
};

type StoredSetting = { id: string; value: unknown; configured: boolean };

export default function PluginSettingsPanel({ pluginId, settings }: { pluginId: string; settings: SettingDefinition[] }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");

  const refresh = () =>
    invoke<StoredSetting[]>("plugin_settings_get", { pluginId }).then((items) => {
      setValues(Object.fromEntries(items.map((item) => [item.id, item.value])));
      setConfigured(Object.fromEntries(items.map((item) => [item.id, item.configured])));
    });

  useEffect(() => {
    refresh().catch((err) => setMessage(String(err)));
  }, [pluginId]);

  const save = async (setting: SettingDefinition) => {
    setMessage("");
    try {
      await invoke("plugin_setting_set", { pluginId, settingId: setting.id, value: values[setting.id] });
      setMessage(`${setting.title}を保存しました`);
      await refresh();
    } catch (err) {
      setMessage(String(err));
    }
  };

  return (
    <div className="panel-card" style={{ padding: 14, marginTop: 16 }}>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 12 }}>設定(manifest.contributes.settings)</div>
      {settings.map((setting) => {
        const value = values[setting.id] ?? setting.default ?? "";
        return (
          <div key={setting.id} style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) minmax(260px, 2fr) auto", gap: 12, alignItems: "center", marginBottom: 12 }}>
            <label style={{ fontSize: 12 }}>
              <b>{setting.title}</b>
              {setting.description && <div style={{ color: "var(--text-faint)", fontSize: 11 }}>{setting.description}</div>}
            </label>
            {setting.type === "boolean" ? (
              <button className={`toggle${value ? " on" : ""}`} onClick={() => setValues((prev) => ({ ...prev, [setting.id]: !value }))} />
            ) : setting.type === "select" ? (
              <select value={String(value)} onChange={(e) => setValues((prev) => ({ ...prev, [setting.id]: e.target.value }))}>
                {setting.options?.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
              </select>
            ) : (
              <input
                type={setting.type === "secret" ? "password" : setting.type === "number" ? "number" : "text"}
                value={String(value ?? "")}
                placeholder={setting.type === "secret" && configured[setting.id] ? "設定済み（変更する場合のみ入力）" : ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [setting.id]: setting.type === "number" ? Number(e.target.value) : e.target.value }))}
              />
            )}
            <button className="btn" onClick={() => save(setting)} disabled={setting.type === "secret" && !value}>保存</button>
          </div>
        );
      })}
      {message && <div style={{ fontSize: 11.5, color: message.includes("保存しました") ? "var(--success)" : "var(--danger)" }}>{message}</div>}
    </div>
  );
}
