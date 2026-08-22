// FR-CLI-003「フォルダーから『ここでターミナルを開く』」用の小さなpub/sub。
// ランチャーウィジェット(フォルダー種別のショートカット)からCLIウィジェットへ、
// 新規タブを指定ディレクトリで開くよう依頼する。
export type NewTabRequest = { cwd?: string; title?: string };

const EVENT = "local-hub:new-terminal-tab";

export function requestNewTerminalTab(request: NewTabRequest = {}) {
  window.dispatchEvent(new CustomEvent<NewTabRequest>(EVENT, { detail: request }));
}

export function onNewTerminalTabRequested(callback: (request: NewTabRequest) => void): () => void {
  const handler = (e: Event) => callback((e as CustomEvent<NewTabRequest>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
