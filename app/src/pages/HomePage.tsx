// §6.1 ダッシュボード(付録B: MVP初期ウィジェット)。
// FR-DASH-001〜005・007に対応:
//   - 追加/削除/移動/リサイズ、編集モード分離
//   - SQLite(app_settingsテーブル)への永続化、保存失敗時は通知して直前の
//     正常なレイアウトを維持
//   - 変更直後のUndo(1段階)、初期レイアウトへの復元
//   - 破損/不明なウィジェットを除外して安全に読み込む
//   - キーボードでの選択・移動・リサイズ
//
// アプリランチャー・起動セット・最近使ったショートカット・システム状態は
// Phase 4/5で実データに置き換える(現時点ではプレースホルダー)。
// プラグイン状態のみplugin_statusに実配線している。
import { useCallback, useEffect, useRef, useState } from "react";
import GridLayout, { type Layout, type LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./pages.css";
import TerminalTabs from "../TerminalTabs";
import LauncherWidget from "../shortcuts/LauncherWidget";
import RecentWidget from "../shortcuts/RecentWidget";
import LaunchSetWidget from "../shortcuts/LaunchSetWidget";
import SystemWidget from "./SystemWidget";
import ClockWidget from "./ClockWidget";
import QuickNoteWidget from "./QuickNoteWidget";
import ClipboardWidget from "./ClipboardWidget";
import ActivityWidget from "./ActivityWidget";
import PluginPageFrame from "./PluginPageFrame";
import { isLauncherEditing, onLauncherEditingChanged, toggleLauncherEditing } from "../shortcuts/launcherEditing";
import { executeCommand } from "../commandBus/commandBus";

const LEGACY_SETTINGS_KEY = "dashboardLayout";
const TABS_SETTINGS_KEY = "dashboardTabs";
// 列数を増やし行高を下げることで、リサイズ時の刻み幅を細かくしている
// (COLS=12/rowHeight=60だと1段階の変化が大きすぎるという要望への対応)。
const COLS = 24;
const ROW_HEIGHT = 30;

const WIDGET_CATALOG = [
  { id: "launcher", title: "アプリランチャー" },
  { id: "launchset", title: "起動セット" },
  { id: "recent", title: "最近使ったショートカット" },
  { id: "cli", title: "クイックCLI" },
  { id: "system", title: "システム状態" },
  { id: "plugins", title: "プラグイン状態" },
  { id: "clock", title: "時計" },
  { id: "note", title: "クイックメモ" },
  { id: "clipboard", title: "クリップボード履歴" },
  { id: "activity", title: "最近の通知" },
] as const;

type WidgetId = string;
type DashboardTab = { id: string; name: string; layout: Layout };

// §6.1付録B: プラグインが宣言する汎用ウィジェット(contributes.widgets)。
// コアが「commandを定期的に呼んで結果を表示する」という共通レンダラーで
// 描画するため、プラグイン自体はUIコードを持たなくてよい。
type PluginWidgetInfo = { pluginId: string; id: string; title: string; command: string; refreshMs: number };

function pluginWidgetLayoutId(w: PluginWidgetInfo): string {
  return `plugin.${w.pluginId}.${w.id}`;
}

// §10「プラグインWebView埋め込み」: プラグイン自身が書いたページ(contributes.pages)
// をダッシュボードのウィジェットカードとしても配置できるようにする。専用パネルを
// プラグインごとにホスト側へハードコードするのをやめ、埋め込み場所(プラグイン画面/
// ダッシュボード)をユーザーが選べるようにするための対応。
type PluginPageInfo = { pluginId: string; id: string; title: string; entry: string };

function pluginPageLayoutId(p: PluginPageInfo): string {
  return `page.${p.pluginId}.${p.id}`;
}

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

const DEFAULT_LAYOUT: Layout = [
  { i: "launcher", x: 0, y: 0, w: 8, h: 8, minW: 6, minH: 6 },
  { i: "launchset", x: 8, y: 0, w: 8, h: 8, minW: 6, minH: 6 },
  { i: "recent", x: 16, y: 0, w: 8, h: 8, minW: 6, minH: 6 },
  { i: "cli", x: 0, y: 8, w: 12, h: 10, minW: 8, minH: 6 },
  { i: "system", x: 12, y: 8, w: 6, h: 10, minW: 4, minH: 6 },
  { i: "plugins", x: 18, y: 8, w: 6, h: 10, minW: 4, minH: 6 },
];

const DEFAULT_TABS: DashboardTab[] = [{ id: "main", name: "メイン", layout: DEFAULT_LAYOUT }];

function sanitizeLayout(raw: unknown): Layout | null {
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

function sanitizeTabs(raw: unknown): DashboardTab[] | null {
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

function WidgetBody({ id, pluginWidgets, pluginPages }: { id: WidgetId; pluginWidgets: PluginWidgetInfo[]; pluginPages: PluginPageInfo[] }) {
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

export default function HomePage() {
  const [tabs, setTabs] = useState<DashboardTab[]>(DEFAULT_TABS);
  const [activeTabId, setActiveTabId] = useState("main");
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [focusedId, setFocusedId] = useState<WidgetId | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const [launcherEditing, setLauncherEditing] = useState(isLauncherEditing);
  useEffect(() => onLauncherEditingChanged(setLauncherEditing), []);

  const [pluginWidgets, setPluginWidgets] = useState<PluginWidgetInfo[]>([]);
  useEffect(() => {
    invoke<PluginWidgetInfo[]>("plugin_widgets_list").then(setPluginWidgets).catch(() => {});
  }, []);
  const [pluginPages, setPluginPages] = useState<PluginPageInfo[]>([]);
  useEffect(() => {
    invoke<PluginPageInfo[]>("plugin_pages_list").then(setPluginPages).catch(() => {});
  }, []);
  const fullCatalog = [
    ...WIDGET_CATALOG,
    ...pluginWidgets.map((w) => ({ id: pluginWidgetLayoutId(w), title: `${w.title}(プラグイン)` })),
    ...pluginPages.map((p) => ({ id: pluginPageLayoutId(p), title: `${p.title}(プラグインページ)` })),
  ];
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const layout = activeTab?.layout ?? [];

  const lastGoodTabs = useRef<DashboardTab[]>(DEFAULT_TABS);
  const undoLayout = useRef<{ tabId: string; layout: Layout } | null>(null);
  const [hasUndo, setHasUndo] = useState(false);
  const beforeChangeRef = useRef<Layout | null>(null);

  useEffect(() => {
    invoke<Record<string, string>>("settings_get_all")
      .then((stored) => {
        const parsedTabs = stored[TABS_SETTINGS_KEY] ? sanitizeTabs(JSON.parse(stored[TABS_SETTINGS_KEY])) : null;
        const legacyLayout = stored[LEGACY_SETTINGS_KEY] ? sanitizeLayout(JSON.parse(stored[LEGACY_SETTINGS_KEY])) : null;
        const next = parsedTabs ?? [{ ...DEFAULT_TABS[0], layout: legacyLayout?.length ? legacyLayout : DEFAULT_LAYOUT }];
        setTabs(next);
        setActiveTabId(next[0].id);
        lastGoodTabs.current = next;
        if (!parsedTabs) {
          invoke("settings_set", { key: TABS_SETTINGS_KEY, value: JSON.stringify(next) }).catch(() => {});
        }
      })
      .catch((err) => console.error("ダッシュボードレイアウトの読み込みに失敗しました:", err))
      .finally(() => setLoaded(true));
  }, []);

  const persistTabs = useCallback(async (next: DashboardTab[]) => {
    try {
      await invoke("settings_set", { key: TABS_SETTINGS_KEY, value: JSON.stringify(next) });
      lastGoodTabs.current = next;
    } catch (err) {
      // FR-DASH-004: 保存失敗時は通知し、直前の正常なレイアウトを保持する。
      invoke("notifications_push", {
        level: "error",
        title: "ダッシュボードの保存に失敗しました",
        body: String(err),
      }).catch(() => {});
      setTabs(lastGoodTabs.current);
    }
  }, []);

  const commitLayout = useCallback(
    (next: Layout, forUndo: Layout | null) => {
      if (!activeTab) return;
      if (forUndo) {
        undoLayout.current = { tabId: activeTab.id, layout: forUndo };
        setHasUndo(true);
      }
      const nextTabs = tabs.map((tab) => (tab.id === activeTab.id ? { ...tab, layout: next } : tab));
      setTabs(nextTabs);
      persistTabs(nextTabs);
    },
    [activeTab, persistTabs, tabs]
  );

  const undo = () => {
    if (!undoLayout.current) return;
    const restored = undoLayout.current;
    undoLayout.current = null;
    setHasUndo(false);
    const nextTabs = tabs.map((tab) => (tab.id === restored.tabId ? { ...tab, layout: restored.layout } : tab));
    setTabs(nextTabs);
    setActiveTabId(restored.tabId);
    persistTabs(nextTabs);
  };

  const resetLayout = () => {
    setTabs(DEFAULT_TABS);
    setActiveTabId("main");
    undoLayout.current = null;
    setHasUndo(false);
    persistTabs(DEFAULT_TABS);
  };

  const addTab = () => {
    const id = `tab-${Date.now().toString(36)}`;
    const next = [...tabs, { id, name: `タブ ${tabs.length + 1}`, layout: [] }];
    setTabs(next);
    setActiveTabId(id);
    persistTabs(next);
  };

  const renameActiveTab = (name: string) => {
    if (!activeTab) return;
    setTabs((current) => current.map((tab) => (tab.id === activeTab.id ? { ...tab, name } : tab)));
  };

  const saveActiveTabName = () => {
    if (!activeTab) return;
    const normalized = activeTab.name.trim() || "名称未設定";
    const next = tabs.map((tab) => (tab.id === activeTab.id ? { ...tab, name: normalized } : tab));
    setTabs(next);
    persistTabs(next);
  };

  const deleteActiveTab = () => {
    if (!activeTab || tabs.length <= 1) return;
    if (!window.confirm(`「${activeTab.name}」を削除しますか？\n配置中のウィジェットもホームから外れます。`)) return;
    const index = tabs.findIndex((tab) => tab.id === activeTab.id);
    const next = tabs.filter((tab) => tab.id !== activeTab.id);
    setTabs(next);
    setActiveTabId(next[Math.min(index, next.length - 1)].id);
    persistTabs(next);
  };

  const addWidget = (id: WidgetId) => {
    // y: Infinityでreact-grid-layoutに自動配置させたかったが、その解決結果を
    // 拾うためだけに付けていたonLayoutChange={setLayout}が、削除直後の
    // 再計算で古いlayoutを書き戻してしまい「削除してもすぐ元に戻る」原因に
    // なっていた。onLayoutChangeへ依存せず、既存アイテムの最下段を自前で
    // 計算して配置する。
    const nextY = layout.reduce((max, item) => Math.max(max, item.y + item.h), 0);
    const next: Layout = [...layout, { i: id, x: 0, y: nextY, w: 4, h: 4, minW: 2, minH: 2 }];
    commitLayout(next, layout);
  };

  const removeWidget = (id: WidgetId) => {
    commitLayout(
      layout.filter((l) => l.i !== id),
      layout
    );
  };

  const moveWidget = (id: WidgetId, targetTabId: string) => {
    if (!activeTab || targetTabId === activeTab.id) return;
    const item = layout.find((entry) => entry.i === id);
    if (!item) return;
    const nextTabs = tabs.map((tab) => {
      if (tab.id === activeTab.id) return { ...tab, layout: tab.layout.filter((entry) => entry.i !== id) };
      if (tab.id === targetTabId) {
        const nextY = tab.layout.reduce((max, entry) => Math.max(max, entry.y + entry.h), 0);
        return { ...tab, layout: [...tab.layout, { ...item, x: 0, y: nextY }] };
      }
      return tab;
    });
    setTabs(nextTabs);
    persistTabs(nextTabs);
  };

  // キーボード操作(FR-DASH-007): 編集モード中、選択中のウィジェットを
  // 矢印キーで移動、Shift+矢印キーでリサイズする。
  const handleKeyDown = (e: React.KeyboardEvent, id: WidgetId) => {
    if (!editing) return;
    const deltas: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const delta = deltas[e.key];
    if (!delta) return;
    e.preventDefault();
    const [dx, dy] = delta;
    const next = layout.map((item) => {
      if (item.i !== id) return item;
      if (e.shiftKey) {
        const minW = item.minW ?? 1;
        const minH = item.minH ?? 1;
        return { ...item, w: Math.max(minW, item.w + dx), h: Math.max(minH, item.h + dy) };
      }
      return { ...item, x: Math.max(0, Math.min(COLS - item.w, item.x + dx)), y: Math.max(0, item.y + dy) };
    });
    commitLayout(next, beforeChangeRef.current ?? layout);
    beforeChangeRef.current = null;
  };

  const placedIds = new Set(tabs.flatMap((tab) => tab.layout.map((item) => item.i)));
  const availableToAdd = fullCatalog.filter((w) => !placedIds.has(w.id));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>ホーム</h1>
          <p>編集モードではドラッグ/矢印キーで移動、右下ハンドル/Shift+矢印キーでリサイズできます</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {editing && hasUndo && (
            <button className="btn" onClick={undo}>
              元に戻す
            </button>
          )}
          {editing && (
            <button className="btn" onClick={resetLayout}>
              タブと配置を初期化
            </button>
          )}
          {editing && availableToAdd.length > 0 && (
            <select
              className="btn"
              value=""
              onChange={(e) => {
                if (e.target.value) addWidget(e.target.value as WidgetId);
              }}
            >
              <option value="">+ ウィジェットを追加</option>
              {availableToAdd.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.title}
                </option>
              ))}
            </select>
          )}
          <button className={`btn${editing ? " active" : ""}`} onClick={() => setEditing((e) => !e)}>
            {editing ? "編集を終了" : "ダッシュボードを編集"}
          </button>
        </div>
      </div>

      <div className="dashboard-tabs-row">
        <div className="dashboard-tabs" role="tablist" aria-label="ダッシュボードグループ">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === activeTabId}
              className={`dashboard-tab${tab.id === activeTabId ? " active" : ""}`}
              onClick={() => {
                setActiveTabId(tab.id);
                setFocusedId(null);
              }}
            >
              <span>{tab.name}</span>
              <small>{tab.layout.length}</small>
            </button>
          ))}
          {editing && (
            <button className="dashboard-tab-add" type="button" onClick={addTab} title="タブを追加">
              ＋
            </button>
          )}
        </div>
        {editing && activeTab && (
          <div className="dashboard-tab-editing">
            <input
              className="dashboard-tab-name"
              value={activeTab.name}
              aria-label="現在のタブ名"
              onChange={(event) => renameActiveTab(event.target.value)}
              onBlur={saveActiveTabName}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
            <button className="btn" type="button" onClick={deleteActiveTab} disabled={tabs.length <= 1}>
              タブを削除
            </button>
          </div>
        )}
      </div>

      {loaded && (
        <div
          ref={(el) => {
            if (el && el.clientWidth !== containerWidth) setContainerWidth(el.clientWidth);
          }}
          // ドラッグ/リサイズ中にマウスがプラグインページの<iframe>の上を通過すると、
          // iframeは別ドキュメントなのでmousemove/mouseupイベントがそちらに奪われ、
          // react-grid-layout側がイベントを見失って「途中で動かせなくなって固まる」
          // 状態になる。isDraggingの間だけ全iframeのpointer-eventsを切ることで防ぐ
          // (pages.cssの.dashboard-dragging iframe参照)。
          className={isDragging ? "dashboard-dragging" : undefined}
        >
          {containerWidth > 0 && (
            <GridLayout
              key={activeTabId}
              width={containerWidth}
              layout={layout}
              // containerPadding:nullはmarginと同じ値にフォールバックする実装のため、
              // .pageのパディングと二重に効いてしまう。明示的に0にして防ぐ。
              gridConfig={{ cols: COLS, rowHeight: ROW_HEIGHT, margin: [10, 10], containerPadding: [0, 0], maxRows: Infinity }}
              // cancel: widget-head内の削除/編集ボタンやタブ移動selectがドラッグ開始として
              // 吸収され、クリックが届かなくなっていたため除外する。
              // handle: widget-head(タイトルバー)以外からはドラッグを開始できないように
              // 制限する。以前はウィジェット本体(プラグインページの<iframe>を含む)全体が
              // ドラッグ起点になっており、iframe上でmousedownした場合、isDraggingの
              // pointer-events:none切り替えがReactの再レンダーを待つ一瞬の間にiframeへ
              // イベントを奪われてしまい、そのままドラッグを見失って固まることがあった。
              // ドラッグ起点をiframeの外(タイトルバー)に限定することで、この競合状態
              // 自体をなくす。
              dragConfig={{ enabled: editing, bounded: false, threshold: 3, cancel: "button, select, input", handle: ".widget-head" }}
              resizeConfig={{ enabled: editing, handles: ["se"] }}
              onDragStart={() => {
                beforeChangeRef.current = layout;
                setIsDragging(true);
              }}
              onResizeStart={() => {
                beforeChangeRef.current = layout;
                setIsDragging(true);
              }}
              onDragStop={(next: Layout) => {
                commitLayout(next, beforeChangeRef.current);
                beforeChangeRef.current = null;
                setIsDragging(false);
              }}
              onResizeStop={(next: Layout) => {
                commitLayout(next, beforeChangeRef.current);
                beforeChangeRef.current = null;
                setIsDragging(false);
              }}
            >
              {layout.map((item) => {
                const widget = fullCatalog.find((w) => w.id === item.i);
                if (!widget) return null;
                return (
                  <div
                    key={widget.id}
                    className="widget"
                    tabIndex={editing ? 0 : -1}
                    onFocus={() => setFocusedId(widget.id)}
                    onKeyDown={(e) => handleKeyDown(e, widget.id)}
                    style={{
                      outline:
                        editing && focusedId === widget.id
                          ? "2px solid var(--accent)"
                          : editing
                            ? "1px dashed #3a4658"
                            : "none",
                    }}
                  >
                    <div className="widget-head">
                      <h3>{widget.title}</h3>
                      {widget.id === "launcher" && (
                        <button
                          className={`icon-btn${launcherEditing ? " active" : ""}`}
                          onClick={() => toggleLauncherEditing()}
                          title={launcherEditing ? "編集を終了" : "編集"}
                        >
                          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
                            <path d="M13 3l4 4-9 9H4v-4z" />
                          </svg>
                        </button>
                      )}
                      {editing && (
                        <>
                          {tabs.length > 1 && (
                            <select
                              className="widget-tab-select"
                              value=""
                              aria-label={`${widget.title}を別のタブへ移動`}
                              onChange={(event) => {
                                if (event.target.value) moveWidget(widget.id, event.target.value);
                              }}
                            >
                              <option value="">移動…</option>
                              {tabs.filter((tab) => tab.id !== activeTabId).map((tab) => (
                                <option key={tab.id} value={tab.id}>{tab.name}</option>
                              ))}
                            </select>
                          )}
                          <button className="icon-btn" onClick={() => removeWidget(widget.id)} title="削除">
                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <line x1="6" y1="6" x2="14" y2="14" />
                              <line x1="14" y1="6" x2="6" y2="14" />
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                    {/* クイックCLIとプラグインページ系ウィジェットは余白なしで縁いっぱいに
                        表示したいので、widget-bodyの標準paddingを外す(以前は負のマージンで
                        paddingを相殺していたが、overflowの計算がズレて文字の左端が見切れる
                        不具合があったため、paddingそのものを無くす方式に変更)。プラグイン
                        ページは「カードの中にさらに枠付きiframe」という二重の箱っぽさを
                        なくすため、iframe自体もvariant="flush"で枠なしにしている。 */}
                    <div className={`widget-body${widget.id === "cli" || widget.id.startsWith("page.") ? " widget-body-flush" : ""}`}>
                      <WidgetBody id={widget.id} pluginWidgets={pluginWidgets} pluginPages={pluginPages} />
                    </div>
                  </div>
                );
              })}
            </GridLayout>
          )}
        </div>
      )}
    </div>
  );
}
