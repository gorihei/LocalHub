// §10「プラグインWebView埋め込み」のホスト側実装。プラグインが自前で書いた
// HTML/JS/CSS(manifest.jsonのcontributes.pages)を、サンドボックス化した
// <iframe>に読み込んで表示する。
//
// プラグイン側のJSはTauri APIへ直接アクセスできない。唯一の通信手段は
// window.postMessageで、iframe内に自動注入されるランタイム(plugin_host.rsの
// bridge_js()、URLは`plugin-ui://.../__bridge.js`)がwindow.localhub.call(commandId,
// params)というPromiseベースのAPIとして提供する。ここではそのメッセージを受け取り、
// コマンドバス(executeCommand)経由で実行してから結果を送り返す。コマンドバスを
// 経由するため、requiresPermissionによる権限チェックも通常のコマンド実行と
// 同様に効く(プラグインUIだからといって権限をバイパスできるわけではない)。
//
// event.source(=このiframeのcontentWindowそのもの)で送信元を照合しているため、
// 同一オリジンで複数のプラグインページが同時に開いていても互いのメッセージを
// 誤って処理することはない。
//
// テーマ同期: ホストのCSS変数(theme.css/SettingsContextのアクセントカラー等)を
// iframeへpostMessageで送り、プラグインのbridge.jsが自分のdocumentElementに
// 反映する。プラグイン側は`var(--accent)`等をそのまま使えばよく、設定画面での
// アクセントカラー変更にも自動で追従する(MutationObserverでdocument.documentElement
// のstyle属性変化を監視し、変化のたびに再送している)。
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { executeCommand } from "../commandBus/commandBus";

// theme.cssで定義されているトークンのうち、プラグインページの見た目に
// 関係しそうなものだけを同期対象にする(内部レイアウト用の値は除外)。
const THEME_VARS = [
  "--bg",
  "--surface",
  "--surface-raised",
  "--surface-hover",
  "--border",
  "--border-soft",
  "--text",
  "--text-muted",
  "--text-faint",
  "--accent",
  "--accent-soft",
  "--accent-strong",
  "--success",
  "--success-soft",
  "--warning",
  "--warning-soft",
  "--danger",
  "--danger-soft",
  "--font-ui",
  "--font-mono",
  "--radius-s",
  "--radius-m",
] as const;

function readTheme(): Record<string, string> {
  const computed = getComputedStyle(document.documentElement);
  const vars: Record<string, string> = {};
  for (const name of THEME_VARS) {
    vars[name] = computed.getPropertyValue(name).trim();
  }
  return vars;
}

type Props = {
  pluginId: string;
  entry: string;
  height?: number | string;
  // "framed"(既定): プラグイン画面の詳細パネルなど、他のコンテンツに囲まれた
  // 場所に置くとき用。枠線・背景・角丸を付けて独立したブロックだと分かるようにする。
  // "flush": ダッシュボードウィジェットのカード内で使うとき用。ウィジェットカード
  // 自体が既に枠を持っているため、iframe側の枠は消してカードとページを一体化させる
  // (「背景色の枠の中にさらに枠」という二重の箱っぽさをなくすため)。
  variant?: "framed" | "flush";
};

type BridgeCallMessage = {
  type: "localhub:call";
  requestId: number;
  commandId: string;
  params: unknown;
};

// フォルダパスをプラグイン側が手打ちさせられていた(ウィジェットとしては
// 使いにくい)問題への対応。プラグインUIはTauri APIへ直接アクセスできないため、
// ホストがネイティブのフォルダ選択ダイアログを代行して結果だけ返す。
type BridgePickFolderMessage = {
  type: "localhub:pickFolder";
  requestId: number;
};

// コンフリクトしたファイルを外部エディタ(OS既定のアプリ)で開く用。
type BridgeOpenPathMessage = {
  type: "localhub:openPath";
  requestId: number;
  path: string;
};

type BridgeCopyTextMessage = { type: "localhub:copyText"; requestId: number; text: string };
type BridgeGetSettingsMessage = { type: "localhub:getSettings"; requestId: number };

function isBridgeCallMessage(data: unknown): data is BridgeCallMessage {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "localhub:call";
}

function isBridgePickFolderMessage(data: unknown): data is BridgePickFolderMessage {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "localhub:pickFolder";
}

function isBridgeOpenPathMessage(data: unknown): data is BridgeOpenPathMessage {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "localhub:openPath";
}

function isBridgeCopyTextMessage(data: unknown): data is BridgeCopyTextMessage {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "localhub:copyText";
}

function isBridgeGetSettingsMessage(data: unknown): data is BridgeGetSettingsMessage {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "localhub:getSettings";
}

export default function PluginPageFrame({ pluginId, entry, height = 420, variant = "framed" }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow) return;

      if (isBridgeCallMessage(event.data)) {
        const { requestId, commandId, params } = event.data;
        const fullCommandId = `plugin.${pluginId}.${commandId}`;
        executeCommand(fullCommandId, params)
          .then((result) => frameWindow.postMessage({ type: "localhub:result", requestId, result }, "*"))
          .catch((err) => frameWindow.postMessage({ type: "localhub:result", requestId, error: String(err) }, "*"));
        return;
      }

      if (isBridgePickFolderMessage(event.data)) {
        const { requestId } = event.data;
        openDialog({ directory: true, multiple: false })
          .then((dir) => frameWindow.postMessage({ type: "localhub:result", requestId, result: typeof dir === "string" ? dir : null }, "*"))
          .catch((err) => frameWindow.postMessage({ type: "localhub:result", requestId, error: String(err) }, "*"));
        return;
      }

      if (isBridgeOpenPathMessage(event.data)) {
        const { requestId, path } = event.data;
        openPath(path)
          .then(() => frameWindow.postMessage({ type: "localhub:result", requestId, result: true }, "*"))
          .catch((err) => frameWindow.postMessage({ type: "localhub:result", requestId, error: String(err) }, "*"));
        return;
      }

      if (isBridgeCopyTextMessage(event.data)) {
        const { requestId, text } = event.data;
        writeText(text)
          .then(() => frameWindow.postMessage({ type: "localhub:result", requestId, result: true }, "*"))
          .catch((err) => frameWindow.postMessage({ type: "localhub:result", requestId, error: String(err) }, "*"));
        return;
      }

      if (isBridgeGetSettingsMessage(event.data)) {
        const { requestId } = event.data;
        invoke("plugin_settings_get", { pluginId })
          .then((result) => frameWindow.postMessage({ type: "localhub:result", requestId, result }, "*"))
          .catch((err) => frameWindow.postMessage({ type: "localhub:result", requestId, error: String(err) }, "*"));
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [pluginId]);

  const sendTheme = () => {
    iframeRef.current?.contentWindow?.postMessage({ type: "localhub:theme", vars: readTheme() }, "*");
  };

  useEffect(() => {
    // アクセントカラー等はdocument.documentElement.style.setPropertyで反映される
    // (SettingsContext.tsx)ため、そのstyle属性の変化を監視して再送する。
    const observer = new MutationObserver(sendTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <iframe
      ref={iframeRef}
      // Windows(WebView2)ではカスタムプロトコルは`http://<scheme>.localhost/<path>`の
      // 形式になる(Tauriの仕様)。このアプリはWindows専用のためこの形式で固定する。
      src={`http://plugin-ui.localhost/${pluginId}/${entry}`}
      sandbox="allow-scripts allow-forms"
      onLoad={sendTheme}
      style={
        variant === "flush"
          ? { width: "100%", height, border: "none", background: "transparent", display: "block" }
          : { width: "100%", height, border: "1px solid var(--border)", borderRadius: "var(--radius-s)", background: "var(--surface)" }
      }
      title={entry}
    />
  );
}
