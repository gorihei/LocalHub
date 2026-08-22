import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import TerminalSpike from "../TerminalSpike";
import { useSettings } from "../settings/SettingsContext";
import "./ai-cli.css";

type AiCliInfo = {
  id: "codex" | "claude" | "gemini";
  label: string;
  command: string;
  installed: boolean;
  path: string | null;
  version: string | null;
};

type AiSession = {
  id: number;
  cli: AiCliInfo;
  cwd: string;
  status: "starting" | "running" | "closed";
  startedAt: Date;
};

const CLI_COLORS: Record<AiCliInfo["id"], string> = {
  codex: "#22d3ee",
  claude: "#f59e0b",
  gemini: "#a78bfa",
};
const AI_CLI_CWD_KEY = "aiCliWorkingDirectory";

export default function AiCliPage() {
  const [clients, setClients] = useState<AiCliInfo[]>([]);
  const [sessions, setSessions] = useState<AiSession[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [cwd, setCwd] = useState("");
  const [detecting, setDetecting] = useState(true);
  const [error, setError] = useState("");
  const nextId = useRef(1);
  const { cliFontSize, cliTheme } = useSettings();

  const detect = () => {
    setDetecting(true);
    setError("");
    invoke<AiCliInfo[]>("ai_cli_detect")
      .then(setClients)
      .catch((cause) => setError(`AI CLIの検出に失敗しました: ${String(cause)}`))
      .finally(() => setDetecting(false));
  };

  useEffect(() => {
    detect();
    invoke<Record<string, string>>("settings_get_all")
      .then((settings) => {
        const saved = settings[AI_CLI_CWD_KEY];
        if (saved) return saved;
        return invoke<string | null>("ai_cli_default_cwd");
      })
      .then((directory) => directory && setCwd(directory))
      .catch(() => {});
  }, []);

  const chooseFolder = async () => {
    const selected = await open({ directory: true, multiple: false, title: "AI CLIの作業フォルダーを選択" });
    if (typeof selected === "string") {
      setCwd(selected);
      invoke("settings_set", { key: AI_CLI_CWD_KEY, value: selected }).catch(() => {});
    }
  };

  const startSession = (cli: AiCliInfo) => {
    if (!cli.installed) return;
    const id = nextId.current++;
    const session: AiSession = {
      id,
      cli,
      cwd,
      status: "starting",
      startedAt: new Date(),
    };
    setSessions((current) => [...current, session]);
    setActiveId(id);
  };

  const updateStatus = (id: number, status: AiSession["status"]) => {
    setSessions((current) => current.map((session) => (session.id === id ? { ...session, status } : session)));
  };

  const markClosed = (session: AiSession) => {
    updateStatus(session.id, "closed");
    invoke("notifications_push", {
      level: "info",
      title: `${session.cli.label} セッション終了`,
      body: session.cwd || "アプリの作業フォルダー",
    }).catch(() => {});
  };

  const clearFolder = () => {
    setCwd("");
    invoke("settings_delete", { key: AI_CLI_CWD_KEY }).catch(() => {});
  };

  const closeSession = (id: number) => {
    setSessions((current) => {
      const remaining = current.filter((session) => session.id !== id);
      if (activeId === id) setActiveId(remaining.at(-1)?.id ?? null);
      return remaining;
    });
  };

  return (
    <div className="ai-cli-page">
      <header className="ai-cli-head">
        <div>
          <h1>AI CLI</h1>
          <p>AIコーディングCLIを、作業フォルダーごとの常駐セッションとして管理します</p>
        </div>
        <button className="btn" onClick={detect} disabled={detecting}>
          {detecting ? "検出中…" : "再検出"}
        </button>
      </header>

      <section className="ai-cli-launcher">
        <div className="ai-cli-directory">
          <span>作業フォルダー</span>
          <button className="ai-cli-path" onClick={chooseFolder} title={cwd || "作業フォルダーを選択"}>
            {cwd || "未指定（アプリの作業フォルダー）"}
          </button>
          <button className="btn" onClick={chooseFolder}>選択</button>
          {cwd && <button className="btn" onClick={clearFolder}>解除</button>}
        </div>
        <div className="ai-cli-cards">
          {clients.map((cli) => (
            <button key={cli.id} className="ai-cli-card" disabled={!cli.installed} onClick={() => startSession(cli)}>
              <span className="ai-cli-logo" style={{ background: `${CLI_COLORS[cli.id]}22`, color: CLI_COLORS[cli.id] }}>
                {cli.label.slice(0, 1)}
              </span>
              <span className="ai-cli-card-copy">
                <strong>{cli.label}</strong>
                <small>{cli.installed ? cli.version || cli.path : "インストールされていません"}</small>
              </span>
              <span className={`ai-cli-detect-dot ${cli.installed ? "available" : "missing"}`} />
            </button>
          ))}
          {!detecting && clients.length === 0 && <div className="ai-cli-empty">対応するAI CLIが見つかりませんでした</div>}
        </div>
        {error && <div className="ai-cli-error">{error}</div>}
      </section>

      <section className="ai-cli-workspace">
        <aside className="ai-session-list">
          <div className="ai-session-list-title">セッション <span>{sessions.length}</span></div>
          {sessions.map((session) => (
            <button key={session.id} className={`ai-session-item${activeId === session.id ? " active" : ""}`} onClick={() => setActiveId(session.id)}>
              <span className={`ai-session-status ${session.status}`} />
              <span className="ai-session-copy">
                <strong>{session.cli.label}</strong>
                <small>{session.cwd || "アプリの作業フォルダー"}</small>
              </span>
              <span
                className="ai-session-close"
                title="セッションを終了"
                onClick={(event) => {
                  event.stopPropagation();
                  closeSession(session.id);
                }}
              >
                ×
              </span>
            </button>
          ))}
          {sessions.length === 0 && <div className="ai-session-empty">上のCLIを選択してセッションを開始します</div>}
        </aside>

        <div className="ai-session-terminal">
          {sessions.map((session) => (
            <div key={session.id} className="ai-session-terminal-pane" style={{ display: activeId === session.id ? "block" : "none" }}>
              <div className="ai-session-terminal-meta">
                <span>{session.cli.label}</span>
                <span>{session.cwd || "アプリの作業フォルダー"}</span>
                <span>{session.startedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} 開始</span>
              </div>
              <div className="ai-session-terminal-body">
                <TerminalSpike
                  cwd={session.cwd || undefined}
                  aiCliCommand={session.cli.id}
                  fontSize={cliFontSize}
                  cliTheme={cliTheme}
                  onSessionReady={() => updateStatus(session.id, "running")}
                  onSessionClosed={() => markClosed(session)}
                />
              </div>
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="ai-terminal-placeholder">
              <div className="ai-terminal-placeholder-icon">›_</div>
              <strong>AI CLIセッションはまだありません</strong>
              <span>CLIと作業フォルダーを選んで開始してください</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
