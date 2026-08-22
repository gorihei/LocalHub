// FR-CLI-002 統合CLIプラグインの1タブ分のターミナル。
// パス/URLのリンク化(@xterm/addon-web-links)、コピー&ペーストの明示キー
// (Ctrl+Shift+C/V。PowerShell自身のCtrl+C割り込みと衝突させないため)に対応。
// 複数タブはTerminalTabs.tsxが個別にこのコンポーネントをマウントすることで
// 実現している(1インスタンス = 1PTYセッション)。
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import type { CliTheme } from "./settings/SettingsContext";

// §8.5「CLIフォントと配色」向けのプリセット配色。xterm.jsのITheme互換。
export const CLI_THEMES: Record<CliTheme, ITheme> = {
  dark: { background: "#0B0F14", foreground: "#F3F4F6", cursor: "#22D3EE" },
  solarized: { background: "#002B36", foreground: "#93A1A1", cursor: "#268BD2" },
  monokai: { background: "#272822", foreground: "#F8F8F2", cursor: "#A6E22E" },
  dracula: { background: "#282A36", foreground: "#F8F8F2", cursor: "#FF79C6" },
};

// FR-CLI-001はMVPではPowerShell必須(Command Prompt/WSLはv1候補)だが、
// 利用者要望によりCommand PromptとGit Bashも選べるようにしている(MVP範囲外の拡張)。
export type ShellKind = "powershell" | "cmd" | "gitbash";

type Props = {
  cwd?: string;
  shell?: ShellKind;
  fontSize?: number;
  cliTheme?: CliTheme;
  onSessionReady?: (sessionId: string) => void;
};

export default function TerminalSpike({ cwd, shell = "powershell", fontSize = 14, cliTheme = "dark", onSessionReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontFamily: '"Cascadia Mono", Consolas, monospace',
      fontSize,
      convertEol: true,
      theme: CLI_THEMES[cliTheme],
    });
    termRef.current = term;
    const fitAddon = new FitAddon();
    fitRef.current = fitAddon;
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fitAddon.fit();

    let sessionId: string | null = null;

    term.onData((data) => {
      if (sessionId) {
        invoke("pty_write", { sessionId, data }).catch((err) => {
          term.writeln(`\r\n[write error] ${String(err)}`);
        });
      }
    });

    // コピー&ペースト: Ctrl+CはPowerShellの割り込みとして素通しし、
    // Ctrl+Shift+C/Vを明示的なコピー/貼り付けに割り当てる。
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "c") {
        const selection = term.getSelection();
        if (selection) navigator.clipboard.writeText(selection).catch(() => {});
        return false;
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "v") {
        navigator.clipboard
          .readText()
          .then((text) => {
            if (sessionId) invoke("pty_write", { sessionId, data: text }).catch(() => {});
          })
          .catch(() => {});
        return false;
      }
      return true;
    });

    // listen()自体は非同期(webview↔コア間の登録往復が必要)なので、それを
    // 待たずにpty_spawnしてしまうと、起動直後(特にアプリのコールドスタート
    // 直後でIPCブリッジが温まっていないタイミング)にPowerShellの起動バナーや
    // 最初のプロンプトを取りこぼすことがあった(初回起動時の最初のタブだけ
    // 何も表示されない不具合の原因)。リスナー登録の完了を待ってから
    // pty_spawnするようにして、この競合を防ぐ。
    const unlistenData = listen<{ session_id: string; data: string }>("pty://data", (event) => {
      if (event.payload.session_id === sessionId) term.write(event.payload.data);
    });
    const unlistenClosed = listen<{ session_id: string }>("pty://closed", (event) => {
      if (event.payload.session_id === sessionId) {
        term.write("\r\n\x1b[33m[プロセスが終了しました]\x1b[0m\r\n");
      }
    });

    Promise.all([unlistenData, unlistenClosed])
      .then(() => invoke<string>("pty_spawn", { cwd, shell }))
      .then((id) => {
        sessionId = id;
        sessionIdRef.current = id;
        onSessionReady?.(id);
        return invoke("pty_resize", { sessionId: id, rows: term.rows, cols: term.cols });
      })
      .catch((err) => {
        term.writeln(`\r\n\x1b[31mPTYの起動に失敗しました: ${String(err)}\x1b[0m`);
      });

    const handleResize = () => {
      fitAddon.fit();
      if (sessionId) {
        invoke("pty_resize", { sessionId, rows: term.rows, cols: term.cols }).catch(() => {
          // リサイズ失敗は致命的ではないため無視する
        });
      }
    };
    window.addEventListener("resize", handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      unlistenData.then((f) => f());
      unlistenClosed.then((f) => f());
      if (sessionId) invoke("pty_close", { sessionId }).catch(() => {});
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      sessionIdRef.current = null;
    };
  }, []);

  // フォントサイズ・配色は§8.5の設定変更時にタブを再生成せず即時反映する
  // (PTYセッションを維持したまま、xterm.jsのoptionsを書き換えるだけで済む)。
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    term.options.theme = CLI_THEMES[cliTheme];
    fitRef.current?.fit();
    const sessionId = sessionIdRef.current;
    if (sessionId) {
      invoke("pty_resize", { sessionId, rows: term.rows, cols: term.cols }).catch(() => {});
    }
  }, [fontSize, cliTheme]);

  return <div ref={containerRef} style={{ height: "100%", width: "100%" }} />;
}
