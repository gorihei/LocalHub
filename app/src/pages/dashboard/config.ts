import { type Layout, type LayoutItem } from "react-grid-layout";

export const LEGACY_SETTINGS_KEY = "dashboardLayout";
export const TABS_SETTINGS_KEY = "dashboardTabs";
// 列数を増やし行高を下げることで、リサイズ時の刻み幅を細かくしている
// (COLS=12/rowHeight=60だと1段階の変化が大きすぎるという要望への対応)。
export const COLS = 24;
export const ROW_HEIGHT = 30;

export const WIDGET_CATALOG = [
  { id: "launcher", title: "アプリランチャー" },
  { id: "launchset", title: "起動セット" },
  { id: "recent", title: "最近使ったショートカット" },
  { id: "cli", title: "クイックCLI" },
  { id: "system", title: "システム状態" },
  { id: "plugins", title: "プラグイン状態" },
  { id: "clock", title: "時計" },
  { id: "note", title: "クイックメモ" },
  { id: "stickyNotes", title: "付箋" },
  { id: "clipboard", title: "クリップボード履歴" },
  { id: "activity", title: "最近の通知" },
] as const;

export type WidgetId = string;
export type DashboardTab = { id: string; name: string; layout: Layout };

// §6.1付録B: プラグインが宣言する汎用ウィジェット(contributes.widgets)。
// コアが「commandを定期的に呼んで結果を表示する」という共通レンダラーで
// 描画するため、プラグイン自体はUIコードを持たなくてよい。
export type PluginWidgetInfo = { pluginId: string; id: string; title: string; command: string; refreshMs: number };

export function pluginWidgetLayoutId(w: PluginWidgetInfo): string {
  return `plugin.${w.pluginId}.${w.id}`;
}

// §10「プラグインWebView埋め込み」: プラグイン自身が書いたページ(contributes.pages)
// をダッシュボードのウィジェットカードとしても配置できるようにする。専用パネルを
// プラグインごとにホスト側へハードコードするのをやめ、埋め込み場所(プラグイン画面/
// ダッシュボード)をユーザーが選べるようにするための対応。
export type PluginPageInfo = { pluginId: string; id: string; title: string; entry: string };

export function pluginPageLayoutId(p: PluginPageInfo): string {
  return `page.${p.pluginId}.${p.id}`;
}

export const DEFAULT_LAYOUT: Layout = [
  { i: "launcher", x: 0, y: 0, w: 8, h: 8, minW: 6, minH: 6 },
  { i: "launchset", x: 8, y: 0, w: 8, h: 8, minW: 6, minH: 6 },
  { i: "recent", x: 16, y: 0, w: 8, h: 8, minW: 6, minH: 6 },
  { i: "cli", x: 0, y: 8, w: 12, h: 10, minW: 8, minH: 6 },
  { i: "system", x: 12, y: 8, w: 6, h: 10, minW: 4, minH: 6 },
  { i: "plugins", x: 18, y: 8, w: 6, h: 10, minW: 4, minH: 6 },
];

export const DEFAULT_TABS: DashboardTab[] = [{ id: "main", name: "メイン", layout: DEFAULT_LAYOUT }];

export function sanitizeLayout(raw: unknown): Layout | null {
  if (!Array.isArray(raw)) return null;
  const validIds = new Set<string>(WIDGET_CATALOG.map((w) => w.id));
  // 破損/不明なウィジェットは除外して安全に読み込む(FR-DASH-005)。
  // プラグイン提供ウィジェット(plugin.*)は起動時点でまだ一覧を取得できて
  // いない可能性があるため、プレフィックスだけで暫定的に許可しておく
  // (実体が無ければWidgetBody側が「見つかりません」を表示する)。
  const filtered = (raw as LayoutItem[]).filter(
    (item) => item && typeof item.i === "string" && (validIds.has(item.i) || item.i.startsWith("plugin.") || item.i.startsWith("page."))
  );
  return filtered;
}

export function sanitizeTabs(raw: unknown): DashboardTab[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = new Set<string>();
  const tabs = raw.flatMap((value): DashboardTab[] => {
    if (!value || typeof value !== "object") return [];
    const candidate = value as Partial<DashboardTab>;
    if (typeof candidate.id !== "string" || !candidate.id || ids.has(candidate.id)) return [];
    const layout = sanitizeLayout(candidate.layout);
    if (!layout) return [];
    ids.add(candidate.id);
    return [{ id: candidate.id, name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim() : "名称未設定", layout }];
  });
  return tabs.length > 0 ? tabs : null;
}

