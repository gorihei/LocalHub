// §5.1 上部バー: 折りたたみ切替、検索/コマンド入力、ダッシュボード編集、ウィンドウ操作。
//
// VSCode風に「OSのウィンドウ枠(タイトルバー)を消し、アプリ自身のヘッダーだけに
// したい」という要望により、tauri.conf.jsonでdecorations:falseにしている。
// その代わりにこのヘッダー自体をdata-tauri-drag-regionとして機能させ(空いた
// 領域をドラッグしてウィンドウ移動できるように)、右端に最小化/最大化/閉じるを
// 自前のボタンとして実装する。
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

type Props = {
  navCollapsed: boolean;
  onToggleNav: () => void;
  onOpenPalette: () => void;
  activityOpen: boolean;
  onToggleActivity: () => void;
};

const appWindow = getCurrentWindow();

function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    appWindow.isMaximized().then(setMaximized).catch(() => {});
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setMaximized).catch(() => {});
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  return (
    <div className="window-controls">
      <button onClick={() => appWindow.minimize()} title="最小化">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
          <line x1="2" y1="9.5" x2="10" y2="9.5" />
        </svg>
      </button>
      <button onClick={() => appWindow.toggleMaximize()} title={maximized ? "元のサイズに戻す" : "最大化"}>
        {maximized ? (
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1">
            <rect x="2.3" y="3.7" width="6" height="6" />
            <path d="M3.7 3.7v-1.4h6v6h-1.4" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1">
            <rect x="2" y="2" width="8" height="8" />
          </svg>
        )}
      </button>
      <button className="close" onClick={() => appWindow.close()} title="閉じる">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
          <line x1="2" y1="2" x2="10" y2="10" />
          <line x1="10" y1="2" x2="2" y2="10" />
        </svg>
      </button>
    </div>
  );
}

export default function TopBar({ navCollapsed, onToggleNav, onOpenPalette, activityOpen, onToggleActivity }: Props) {
  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="topbar-inner" data-tauri-drag-region="deep">
        <div className="brand">
          <button className="icon-btn" onClick={onToggleNav} title="ナビゲーションの折りたたみ">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
              <line x1="3" y1="5" x2="17" y2="5" />
              <line x1="3" y1="10" x2="17" y2="10" />
              <line x1="3" y1="15" x2="10" y2="15" />
            </svg>
          </button>
          <div className="brand-mark">
            <svg viewBox="0 0 20 20" fill="none" stroke="#04141A" strokeWidth="1.8">
              <rect x="3" y="3" width="6" height="6" rx="1.4" />
              <rect x="11" y="3" width="6" height="6" rx="1.4" />
              <rect x="3" y="11" width="6" height="6" rx="1.4" />
              <circle cx="14" cy="14" r="3" />
            </svg>
          </div>
          {!navCollapsed && <span className="brand-name">Local Hub</span>}
        </div>

        <button className="search-bar" onClick={onOpenPalette}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
            <circle cx="9" cy="9" r="6" />
            <line x1="17" y1="17" x2="13.4" y2="13.4" />
          </svg>
          <span>検索またはコマンドを入力…</span>
          <span className="kbd">Ctrl+K</span>
        </button>

        <div className="topbar-actions">
          <button
            className={`icon-btn${activityOpen ? " active" : ""}`}
            onClick={onToggleActivity}
            title="アクティビティ"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M5 10a5 5 0 0 1 10 0v3l1.2 2H3.8L5 13z" />
              <path d="M8.5 17a1.5 1.5 0 0 0 3 0" />
            </svg>
          </button>
          <button className="icon-btn" title="ヘルプ">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="10" cy="10" r="7" />
              <path d="M8 8a2 2 0 1 1 2.8 1.8c-.7.4-.8.9-.8 1.7" />
              <circle cx="10" cy="14" r="0.4" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>

      <WindowControls />
    </header>
  );
}
