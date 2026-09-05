import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import TerminalTabs from "../../TerminalTabs";
import LauncherWidget from "../../shortcuts/LauncherWidget";
import RecentWidget from "../../shortcuts/RecentWidget";
import LaunchSetWidget from "../../shortcuts/LaunchSetWidget";
import { executeCommand } from "../../commandBus/commandBus";
import ActivityWidget from "../ActivityWidget";
import ClipboardWidget from "../ClipboardWidget";
import ClockWidget from "../ClockWidget";
import PluginPageFrame from "../PluginPageFrame";
import QuickNoteWidget from "../QuickNoteWidget";
import StickyNotesWidget from "../StickyNotesWidget";
import SystemWidget from "../SystemWidget";
import {
  pluginPageLayoutId,
  pluginWidgetLayoutId,
  type PluginPageInfo,
  type PluginWidgetInfo,
  type WidgetId,
} from "./config";

function PluginWidgetRenderer({ command, refreshMs }: { command: string; refreshMs: number }) {
  const [text, setText] = useState("読み込み中…");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      executeCommand<unknown>(command)
        .then((result) => {
          if (cancelled) return;
          setText(typeof result === "string" ? result : JSON.stringify(result));
          setFailed(false);
        })
        .catch((err) => {
          if (cancelled) return;
          setText(String(err));
          setFailed(true);
        });
    };
    poll();
    const timer = setInterval(poll, Math.max(1000, refreshMs));
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [command, refreshMs]);

  return <span style={{ color: failed ? "var(--danger)" : "var(--text)", wordBreak: "break-all" }}>{text}</span>;
}

export default function WidgetBody({ id, pluginWidgets, pluginPages }: { id: WidgetId; pluginWidgets: PluginWidgetInfo[]; pluginPages: PluginPageInfo[] }) {
  if (id.startsWith("plugin.")) {
    const spec = pluginWidgets.find((w) => pluginWidgetLayoutId(w) === id);
    if (!spec) return <span style={{ color: "var(--text-faint)" }}>ウィジェットが見つかりません(プラグインが無効か削除されています)</span>;
    return <PluginWidgetRenderer command={spec.command} refreshMs={spec.refreshMs} />;
  }
  if (id.startsWith("page.")) {
    const spec = pluginPages.find((p) => pluginPageLayoutId(p) === id);
    if (!spec) return <span style={{ color: "var(--text-faint)" }}>ページが見つかりません(プラグインが無効か削除されています)</span>;
    return <PluginPageFrame pluginId={spec.pluginId} entry={spec.entry} height="100%" variant="flush" />;
  }
  switch (id) {
    case "cli":
      return <TerminalTabs />;
    case "plugins":
      return <PluginStatusWidget />;
    case "launcher":
      return <LauncherWidget />;
    case "recent":
      return <RecentWidget />;
    case "launchset":
      return <LaunchSetWidget />;
    case "system":
      return <SystemWidget />;
    case "clock":
      return <ClockWidget />;
    case "note":
      return <QuickNoteWidget />;
    case "stickyNotes":
      return <StickyNotesWidget />;
    case "clipboard":
      return <ClipboardWidget />;
    case "activity":
      return <ActivityWidget />;
    default:
      return <span>Phase 5で実データに接続予定です。</span>;
  }
}

function PluginStatusWidget() {
  const [plugins, setPlugins] = useState<{ manifest: { name: string }; state: string }[]>([]);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => {
    invoke<{ manifest: { name: string }; state: string }[]>("plugin_list")
      .then((list) => {
        setPlugins(list);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    refresh();
    const unlisten = listen("plugin://exited", refresh);
    return () => {
      unlisten.then((f) => f());
    };
  }, [refresh]);

  const color: Record<string, string> = {
    running: "var(--success)",
    starting: "var(--success)",
    failed: "var(--danger)",
    degraded: "var(--warning)",
  };
  const stateLabel: Record<string, string> = {
    installed: "インストール済み",
    running: "実行中",
    starting: "起動中",
    failed: "失敗",
    degraded: "一部制限",
    disabled: "無効",
    updating: "更新中",
  };

  if (failed) return <span>状態を取得できませんでした</span>;
  if (plugins.length === 0) return <span style={{ color: "var(--text-faint)" }}>プラグインはありません</span>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {plugins.map((p) => (
        <div key={p.manifest.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{ width: 8, height: 8, borderRadius: "50%", background: color[p.state] ?? "var(--text-faint)", flexShrink: 0 }}
          />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {p.manifest.name}: {stateLabel[p.state] ?? p.state}
          </span>
        </div>
      ))}
    </div>
  );
}

