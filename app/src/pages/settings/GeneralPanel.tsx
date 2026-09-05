import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isEnabled as autostartIsEnabled, enable as autostartEnable, disable as autostartDisable } from "@tauri-apps/plugin-autostart";

export default function GeneralPanel() {
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


