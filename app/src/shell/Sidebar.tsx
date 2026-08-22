// §5.2 必須ナビゲーション。
import type { ReactElement } from "react";
import type { PageId } from "./types";

const NAV_ITEMS: { id: PageId; label: string; soon?: boolean; icon: ReactElement }[] = [
  {
    id: "home",
    label: "ホーム",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M4 9.5 10 4l6 5.5" />
        <path d="M5.5 8.5V16h9V8.5" />
      </svg>
    ),
  },
  {
    id: "search",
    label: "検索",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="9" cy="9" r="6" />
        <line x1="17" y1="17" x2="13.4" y2="13.4" />
      </svg>
    ),
  },
  {
    id: "automation",
    label: "自動化",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M11 3 5 12h4l-1 5 7-9h-4z" />
      </svg>
    ),
  },
  {
    id: "plugins",
    label: "プラグイン",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M7 4v2H5a1 1 0 0 0-1 1v2h2a1.4 1.4 0 1 1 0 2H4v2a1 1 0 0 0 1 1h2v-2a1.4 1.4 0 1 1 2 0v2h2a1 1 0 0 0 1-1v-2h2v-2h-2V7a1 1 0 0 0-1-1h-2V4z" />
      </svg>
    ),
  },
  {
    id: "devtools",
    label: "開発者ツール",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M6 6 2.5 10 6 14M14 6l3.5 4L14 14" />
        <path d="M11.5 4.5 8.5 15.5" />
      </svg>
    ),
  },
  {
    id: "processes",
    label: "プロセス・ポート",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="4" width="14" height="3.4" rx="1" />
        <rect x="3" y="8.3" width="14" height="3.4" rx="1" />
        <rect x="3" y="12.6" width="14" height="3.4" rx="1" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "設定",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="10" cy="10" r="2.6" />
        <path d="M10 3v2M10 15v2M17 10h-2M5 10H3M14.8 5.2l-1.4 1.4M6.6 13.4l-1.4 1.4M14.8 14.8l-1.4-1.4M6.6 6.6 5.2 5.2" />
      </svg>
    ),
  },
];

type Props = {
  active: PageId;
  onNavigate: (page: PageId) => void;
};

export default function Sidebar({ active, onNavigate }: Props) {
  return (
    <nav className="sidebar">
      <div className="nav-group">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`nav-item${active === item.id ? " active" : ""}`}
            onClick={() => onNavigate(item.id)}
          >
            {item.icon}
            <span className="label">{item.label}</span>
            {item.soon && <span className="soon">準備中</span>}
          </button>
        ))}
      </div>
    </nav>
  );
}
