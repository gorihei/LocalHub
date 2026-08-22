// FR-CLI-002「複数タブ」。各タブは独立したTerminalSpike(=独立したPTY
// セッション)を持つ。非アクティブなタブはdisplay:noneで隠すだけにし、
// アンマウントしない(アンマウントするとそのタブのPTYセッションが終了して
// しまうため)。
import { useEffect, useRef, useState, type CSSProperties } from "react";
import TerminalSpike, { type ShellKind } from "./TerminalSpike";
import { onNewTerminalTabRequested } from "./terminalTabEvents";
import { useSettings, type CliTheme } from "./settings/SettingsContext";

type Tab = { id: number; cwd?: string; title: string; shell: ShellKind };

let nextTabId = 1;

const CLI_THEME_ORDER: CliTheme[] = ["dark", "solarized", "monokai", "dracula"];
const CLI_THEME_LABELS: Record<CliTheme, string> = {
  dark: "ダーク",
  solarized: "Solarized",
  monokai: "Monokai",
  dracula: "Dracula",
};
// FR-CLI-001はMVPではPowerShell必須(Command Prompt/WSLはv1候補)だが、
// 利用者要望によりCommand PromptとGit Bashも選べるようにしている(MVP範囲外の拡張)。
const SHELL_ORDER: ShellKind[] = ["powershell", "cmd", "gitbash"];
const SHELL_LABELS: Record<ShellKind, string> = {
  powershell: "PowerShell",
  cmd: "コマンドプロンプト",
  gitbash: "Git Bash",
};
const MIN_CLI_FONT_SIZE = 10;
const MAX_CLI_FONT_SIZE = 24;

const fontStepBtnStyle: CSSProperties = {
  width: 16,
  height: 16,
  lineHeight: 1,
  fontSize: 11,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--surface)",
  color: "var(--text-muted)",
  border: "1px solid var(--border-soft)",
  borderRadius: 3,
  cursor: "pointer",
  padding: 0,
};

export default function TerminalTabs() {
  const [tabs, setTabs] = useState<Tab[]>([{ id: nextTabId++, title: "PowerShell 1", shell: "powershell" }]);
  const [activeId, setActiveId] = useState(tabs[0].id);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const { cliFontSize, cliTheme, setCliFontSize, setCliTheme } = useSettings();

  useEffect(
    () =>
      onNewTerminalTabRequested((req) => {
        const id = nextTabId++;
        const title = req.title ?? `PowerShell ${tabsRef.current.length + 1}`;
        setTabs((prev) => [...prev, { id, cwd: req.cwd, title, shell: "powershell" }]);
        setActiveId(id);
      }),
    []
  );

  const addTab = (shell: ShellKind) => {
    const id = nextTabId++;
    setTabs((prev) => [...prev, { id, title: `${SHELL_LABELS[shell]} ${prev.length + 1}`, shell }]);
    setActiveId(id);
  };

  const closeTab = (id: number) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        const freshId = nextTabId++;
        setActiveId(freshId);
        return [{ id: freshId, title: "PowerShell 1", shell: "powershell" }];
      }
      if (activeId === id) setActiveId(next[next.length - 1].id);
      return next;
    });
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 2, borderBottom: "1px solid var(--border-soft)", flexShrink: 0 }}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActiveId(tab.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11.5,
              padding: "7px 10px",
              borderBottom: tab.id === activeId ? "2px solid var(--accent)" : "2px solid transparent",
              color: tab.id === activeId ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            <span>{tab.title}</span>
            {tabs.length > 1 && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                style={{ color: "var(--text-faint)", fontSize: 12, lineHeight: 1 }}
              >
                ×
              </span>
            )}
          </div>
        ))}
        {/* FR-CLI-001拡張: 新規タブ作成時にシェルの種類を選べる */}
        <select
          value=""
          onChange={(e) => {
            const shell = e.target.value as ShellKind;
            if (shell) addTab(shell);
            e.target.value = "";
          }}
          title="新しいタブを開く"
          style={{
            fontSize: 13,
            padding: "2px 4px",
            marginLeft: 4,
            background: "none",
            color: "var(--text-faint)",
            border: "none",
            cursor: "pointer",
          }}
        >
          <option value="" disabled>
            ＋
          </option>
          {SHELL_ORDER.map((s) => (
            <option key={s} value={s} style={{ background: "var(--surface)", color: "var(--text)" }}>
              {SHELL_LABELS[s]}
            </option>
          ))}
        </select>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, paddingRight: 8 }}>
          {/* §8.5 CLIフォントサイズ: PTYセッションを維持したまま即時反映する */}
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <button
              onClick={() => setCliFontSize(Math.max(MIN_CLI_FONT_SIZE, cliFontSize - 1))}
              title="文字を小さく"
              style={fontStepBtnStyle}
            >
              −
            </button>
            <span style={{ fontSize: 10.5, color: "var(--text-faint)", minWidth: 18, textAlign: "center" }}>{cliFontSize}</span>
            <button
              onClick={() => setCliFontSize(Math.min(MAX_CLI_FONT_SIZE, cliFontSize + 1))}
              title="文字を大きく"
              style={fontStepBtnStyle}
            >
              ＋
            </button>
          </div>
          {/* §8.5 CLI配色: プリセットを順番に切り替える */}
          <select
            value={cliTheme}
            onChange={(e) => setCliTheme(e.target.value as CliTheme)}
            title="配色テーマ"
            style={{
              fontSize: 10.5,
              background: "var(--surface)",
              color: "var(--text-muted)",
              border: "1px solid var(--border-soft)",
              borderRadius: 4,
              padding: "2px 4px",
            }}
          >
            {CLI_THEME_ORDER.map((t) => (
              <option key={t} value={t}>
                {CLI_THEME_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {tabs.map((tab) => (
          <div key={tab.id} style={{ position: "absolute", inset: 0, display: tab.id === activeId ? "block" : "none" }}>
            <TerminalSpike cwd={tab.cwd} shell={tab.shell} fontSize={cliFontSize} cliTheme={cliTheme} />
          </div>
        ))}
      </div>
    </div>
  );
}
