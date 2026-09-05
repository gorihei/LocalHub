// §5.1 アプリシェル本体。ナビゲーション状態を持ち、各ページを切り替える。
import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./shell.css";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import StatusBar from "./StatusBar";
import ActivityPanel from "./ActivityPanel";
import type { PageId } from "./types";
import HomePage from "../pages/HomePage";
import SearchPage from "../pages/SearchPage";
import AutomationPage from "../pages/AutomationPage";
import PluginsPage from "../pages/PluginsPage";
import AiCliPage from "../pages/AiCliPage";
import ProcessesPage from "../pages/ProcessesPage";
import SettingsPage from "../pages/SettingsPage";
import ToastStack from "../notifications/ToastStack";
import CommandPalette from "../search/CommandPalette";

const DevToolsPage = lazy(() => import("../pages/DevToolsPage"));

const PAGES: Record<PageId, ComponentType> = {
  home: HomePage,
  search: SearchPage,
  automation: AutomationPage,
  plugins: PluginsPage,
  "ai-cli": AiCliPage,
  devtools: DevToolsPage,
  processes: ProcessesPage,
  settings: SettingsPage,
};

const ERROR_POLL_INTERVAL_MS = 5000;
const NAV_COLLAPSED_KEY = "navCollapsed";

export default function AppShell() {
  const [page, setPage] = useState<PageId>("home");
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [aiCliMounted, setAiCliMounted] = useState(false);

  useEffect(() => {
    if (page === "ai-cli") setAiCliMounted(true);
  }, [page]);

  // サイドバーの開閉状態を記憶する(§6.10「変更は即時反映」)。
  useEffect(() => {
    invoke<Record<string, string>>("settings_get_all")
      .then((s) => setNavCollapsed(s[NAV_COLLAPSED_KEY] === "true"))
      .catch(() => {});
  }, []);
  const toggleNav = () => {
    setNavCollapsed((v) => {
      const next = !v;
      invoke("settings_set", { key: NAV_COLLAPSED_KEY, value: String(next) }).catch(() => {});
      return next;
    });
  };
  const [activityOpen, setActivityOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [errorCount, setErrorCount] = useState(0);
  const [safeMode, setSafeMode] = useState(false);

  // §13.3/AC-11: 2回連続で異常終了した場合、Rust側がセーフモードで起動し
  // プラグインを無効化する。その状態をユーザーに伝える。
  useEffect(() => {
    invoke<boolean>("app_safe_mode_active")
      .then(setSafeMode)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const checkErrors = () => {
      invoke<string[]>("logs_recent", { limit: 200 })
        .then((lines) => setErrorCount(lines.filter((l) => l.includes("ERROR")).length))
        .catch(() => {
          // §11.3: ログ取得の失敗自体でUIを壊さない
        });
    };
    checkErrors();
    const timer = setInterval(checkErrors, ERROR_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  // FR-CMD-001: アプリ内ショートカット(Ctrl+K)でコマンドパレットを即時表示する。
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const PageComponent = PAGES[page];

  return (
    <div className={`shell${navCollapsed ? " nav-collapsed" : ""}`}>
      <TopBar
        navCollapsed={navCollapsed}
        onToggleNav={toggleNav}
        onOpenPalette={() => setPaletteOpen(true)}
        activityOpen={activityOpen}
        onToggleActivity={() => setActivityOpen((v) => !v)}
      />
      <Sidebar active={page} onNavigate={setPage} />
      <main className="main">
        {safeMode && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 16px",
              background: "rgba(245,158,11,0.14)",
              borderBottom: "1px solid var(--warning, #F59E0B)",
              color: "var(--warning, #F59E0B)",
              fontSize: 12.5,
            }}
          >
            <strong>セーフモードで起動しています。</strong>
            <span>2回連続で正常終了できなかったため、プラグインを無効化しています。次回、トレイメニューの「終了」で正しく終了すれば通常起動に戻ります。</span>
          </div>
        )}
        {page !== "ai-cli" && (
          <Suspense fallback={<div className="page">画面を読み込んでいます…</div>}>
            <PageComponent />
          </Suspense>
        )}
        {aiCliMounted && (
          <div style={{ height: "100%", display: page === "ai-cli" ? "block" : "none" }}>
            <AiCliPage />
          </div>
        )}
      </main>
      <StatusBar pluginsRunning={0} pluginsTotal={1} errorCount={errorCount} />
      <ActivityPanel open={activityOpen} onClose={() => setActivityOpen(false)} />
      <ToastStack />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
