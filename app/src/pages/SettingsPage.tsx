// §6.10 設定。ページ本体はタブ構成を担当し、各設定領域の状態と副作用は
// settings配下のパネルコンポーネントへ分離する。
import { useState } from "react";
import "./pages.css";
import { executeCommand } from "../commandBus/commandBus";
import { useSettings, ACCENT_COLORS, type Accent } from "../settings/SettingsContext";
import DataPanel from "./settings/DataPanel";
import GeneralPanel from "./settings/GeneralPanel";
import MousePanel from "./settings/MousePanel";
import ShortcutsPanel from "./settings/ShortcutsPanel";
import LogsPanel from "./settings/LogsPanel";

type SettingsTab = "appearance" | "general" | "shortcuts" | "mouse" | "data" | "logs";

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
          <button className={tab === "mouse" ? "active" : ""} onClick={() => setTab("mouse")}>
            マウス
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
        {tab === "mouse" && <MousePanel />}
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
