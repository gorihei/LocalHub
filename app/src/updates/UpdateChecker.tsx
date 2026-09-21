import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * 起動時の更新確認。ネットワーク障害で起動を妨げず、更新が見つかった場合も
 * インストールは行わず通知だけに留める。
 */
export default function UpdateChecker() {
  useEffect(() => {
    let disposed = false;
    const run = async () => {
      try {
        const settings = await invoke<Record<string, string>>("settings_get_all");
        if (settings.updateAutoCheck === "false") return;
        const lastCheck = Number(settings.updateLastCheckAt || 0);
        if (Number.isFinite(lastCheck) && Date.now() - lastCheck < CHECK_INTERVAL_MS) return;

        const update = await check({ timeout: 20_000 });
        if (disposed) return;
        await invoke("settings_set", { key: "updateLastCheckAt", value: String(Date.now()) });
        if (update) {
          await invoke("notifications_push", {
            level: "info",
            title: `Local Hub ${update.version}を利用できます`,
            body: "設定の「アップデート」から内容を確認して更新できます。",
          });
        }
      } catch (error) {
        // 自動確認の失敗は通常作業を妨げない。手動確認では同じエラーをUIに表示する。
        console.warn("アップデートの自動確認に失敗しました:", error);
      }
    };
    void run();
    return () => {
      disposed = true;
    };
  }, []);

  return null;
}
