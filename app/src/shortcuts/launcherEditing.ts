// アプリランチャーウィジェットの編集モード切替を、ダッシュボードの共通
// widget-headに置くボタンとウィジェット本体(LauncherWidget)の間で共有するための
// 小さなpub/sub。両者は別コンポーネントだがヘッダーとボディが分かれているため
// (HomePage側が共通widget-headを描画する構造)、propsで渡す代わりにこちらを使う。
let editing = false;
const EVENT = "local-hub:launcher-editing-changed";

export function isLauncherEditing() {
  return editing;
}

export function toggleLauncherEditing() {
  editing = !editing;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: editing }));
}

export function onLauncherEditingChanged(callback: (editing: boolean) => void): () => void {
  const handler = (e: Event) => callback((e as CustomEvent<boolean>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
