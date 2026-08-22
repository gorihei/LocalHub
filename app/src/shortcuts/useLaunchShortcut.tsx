// 管理者権限フラグ付きショートカットは、実行前に§10.3の確認ダイアログを通す
// (AC-10)。それ以外は即実行し、結果を通知する(リスクレベル1: 実行、結果通知)。
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ConfirmDialog from "../commandBus/ConfirmDialog";
import { launchShortcut, type Shortcut } from "./shortcuts";

export function useLaunchShortcut(onLaunched?: () => void) {
  const [pending, setPending] = useState<Shortcut | null>(null);

  const doLaunch = async (shortcut: Shortcut) => {
    try {
      await launchShortcut(shortcut.id);
      onLaunched?.();
    } catch (err) {
      console.error("起動に失敗しました:", err);
      // 起動失敗がconsole.errorだけだと気づけないため(実際に「何も起きない」
      // ように見えていた原因の一つ)、通知としても必ず表示する。
      invoke("notifications_push", {
        level: "error",
        title: `「${shortcut.name}」の起動に失敗しました`,
        body: String(err),
      }).catch(() => {});
    }
  };

  const launch = (shortcut: Shortcut) => {
    if (shortcut.admin) {
      setPending(shortcut);
      return;
    }
    doLaunch(shortcut);
  };

  const dialog = pending && (
    <ConfirmDialog
      title="管理者権限で実行しますか?"
      actor="ユーザー(手動実行)"
      action={`「${pending.name}」を管理者権限で起動`}
      target={pending.target}
      impact="管理者権限でプロセスが起動します"
      reversibility="実行後の取り消しはできません(起動したプロセス自体は通常どおり終了できます)"
      requiredPermissions="管理者権限"
      onConfirm={() => {
        const shortcut = pending;
        setPending(null);
        if (shortcut) doLaunch(shortcut);
      }}
      onCancel={() => setPending(null)}
    />
  );

  return { launch, dialog };
}
