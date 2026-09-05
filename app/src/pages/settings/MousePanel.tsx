import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function MousePanel() {
  type MouseSettings = {
    rippleEnabled: boolean;
    color: string;
    shape: "circle" | "rounded" | "square";
    durationMs: number;
    size: number;
    thickness: number;
  };
  const defaults: MouseSettings = { rippleEnabled: false, color: "#38BDF8", shape: "circle", durationMs: 620, size: 168, thickness: 6 };
  const [settings, setSettings] = useState<MouseSettings>(defaults);
  const [saved, setSaved] = useState<MouseSettings>(defaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    invoke<MouseSettings>("mouse_effects_status")
      .then((status) => {
        setSettings(status);
        setSaved(status);
      })
      .catch((cause) => setError(String(cause)));
  }, []);

  const apply = async (next: MouseSettings) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await invoke("mouse_effects_update", next);
      setSettings(next);
      setSaved(next);
      setMessage("保存しました");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-card" style={{ padding: "4px 18px" }}>
      <div className="setting-row">
        <div className="setting-label">
          <b>クリック時に波紋を表示</b>
          <span>Windows全体で、左右または中央ボタンを押した位置にリングを表示します</span>
        </div>
        <button className={`toggle${settings.rippleEnabled ? " on" : ""}`} disabled={busy} onClick={() => apply({ ...settings, rippleEnabled: !settings.rippleEnabled })} />
      </div>
      <div className="setting-row">
        <div className="setting-label"><b>色</b><span>波紋の表示色</span></div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="color" value={settings.color} onChange={(event) => setSettings({ ...settings, color: event.target.value.toUpperCase() })} />
          <code style={{ fontSize: 12 }}>{settings.color}</code>
        </div>
      </div>
      <div className="setting-row">
        <div className="setting-label"><b>形</b><span>円、角丸四角、四角から選択</span></div>
        <div className="segmented">
          {([['circle', '円'], ['rounded', '角丸'], ['square', '四角']] as const).map(([value, label]) => (
            <button key={value} className={settings.shape === value ? "active" : ""} onClick={() => setSettings({ ...settings, shape: value })}>{label}</button>
          ))}
        </div>
      </div>
      <div className="setting-row">
        <div className="setting-label"><b>速度</b><span>波紋が広がって消えるまでの時間</span></div>
        <div className="range-wrap">
          <input type="range" min={200} max={2000} step={20} value={settings.durationMs} onChange={(event) => setSettings({ ...settings, durationMs: Number(event.target.value) })} />
          <output>{settings.durationMs}ms</output>
        </div>
      </div>
      <div className="setting-row">
        <div className="setting-label"><b>最大サイズ</b><span>波紋が最も広がったときの直径</span></div>
        <div className="range-wrap">
          <input type="range" min={48} max={240} step={4} value={settings.size} onChange={(event) => setSettings({ ...settings, size: Number(event.target.value) })} />
          <output>{settings.size}px</output>
        </div>
      </div>
      <div className="setting-row">
        <div className="setting-label"><b>線の太さ</b><span>リングの線幅</span></div>
        <div className="range-wrap">
          <input type="range" min={2} max={16} value={settings.thickness} onChange={(event) => setSettings({ ...settings, thickness: Number(event.target.value) })} />
          <output>{settings.thickness}px</output>
        </div>
      </div>
      <div className="setting-row">
        <div className="setting-label"><span>色・形・速度・サイズを変更した後に保存してください</span></div>
        <button className="btn primary" disabled={busy || JSON.stringify(settings) === JSON.stringify(saved)} onClick={() => apply(settings)}>設定を保存</button>
      </div>
      <div className="setting-row">
        <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
          設定は保存され、次回のLocal Hub起動時に自動的に有効になります。波紋はクリックを透過するため、背後のアプリを通常どおり操作できます。
        </span>
      </div>
      {message && <div className="setting-row"><span style={{ color: "var(--text-muted)", fontSize: 12 }}>{message}</span></div>}
      {error && <div className="setting-row"><span style={{ color: "var(--danger)", fontSize: 12 }}>{error}</span></div>}
    </div>
  );
}


