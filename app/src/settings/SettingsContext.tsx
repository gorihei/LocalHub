// §6.10 設定の永続化。SQLite(app_settingsテーブル)へ保存し、起動時に読み込んで
// CSS変数/bodyクラスへ即時反映する。「変更は即時反映」(§6.10)の方針に沿い、
// 保存の完了を待たずにUIへ適用してからバックグラウンドで書き込む。
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

export type Accent = "cyan" | "violet" | "green" | "amber" | "rose" | "blue";
type Density = "comfortable" | "compact";

// §8.5「アクセントカラー」。swatchの見た目(SettingsPage.tsx)もここから
// 生成するので、色を増やす場合はこの表に追加するだけでよい。
export const ACCENT_COLORS: Record<Accent, { accent: string; soft: string; strong: string }> = {
  cyan: { accent: "#22D3EE", soft: "rgba(34,211,238,0.14)", strong: "#67E8F9" },
  violet: { accent: "#A78BFA", soft: "rgba(167,139,250,0.16)", strong: "#C4B5FD" },
  green: { accent: "#34D399", soft: "rgba(52,211,153,0.16)", strong: "#6EE7B7" },
  amber: { accent: "#FBBF24", soft: "rgba(251,191,36,0.16)", strong: "#FCD34D" },
  rose: { accent: "#FB7185", soft: "rgba(251,113,133,0.16)", strong: "#FDA4AF" },
  blue: { accent: "#60A5FA", soft: "rgba(96,165,250,0.16)", strong: "#93C5FD" },
};
// §8.5「CLIフォントと配色」。統合CLIウィジェットの全タブに共通で反映する。
export type CliTheme = "dark" | "solarized" | "monokai" | "dracula";

type Settings = {
  accent: Accent;
  density: Density;
  fontScale: number;
  reducedMotion: boolean;
  osNotifications: boolean;
  cliFontSize: number;
  cliTheme: CliTheme;
};

const DEFAULT_SETTINGS: Settings = {
  accent: "cyan",
  density: "comfortable",
  fontScale: 100,
  reducedMotion: false,
  osNotifications: true,
  cliFontSize: 14,
  cliTheme: "dark",
};

type SettingsContextValue = Settings & {
  loaded: boolean;
  setAccent: (v: Accent) => void;
  setDensity: (v: Density) => void;
  setFontScale: (v: number) => void;
  setReducedMotion: (v: boolean) => void;
  setOsNotifications: (v: boolean) => void;
  setCliFontSize: (v: number) => void;
  setCliTheme: (v: CliTheme) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

function applyAccent(value: Accent) {
  const c = ACCENT_COLORS[value] ?? ACCENT_COLORS.cyan;
  const root = document.documentElement.style;
  root.setProperty("--accent", c.accent);
  root.setProperty("--accent-soft", c.soft);
  root.setProperty("--accent-strong", c.strong);
}

function applyDensity(value: Density) {
  document.body.classList.toggle("density-compact", value === "compact");
}

function applyFontScale(value: number) {
  document.documentElement.style.setProperty("--fs-scale", String(value / 100));
}

function applyReducedMotion(value: boolean) {
  document.body.classList.toggle("reduced-motion", value);
}

function persist(key: string, value: string) {
  invoke("settings_set", { key, value }).catch((err) => {
    console.error(`設定の保存に失敗しました(${key}):`, err);
  });
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    invoke<Record<string, string>>("settings_get_all")
      .then((stored) => {
        const next: Settings = {
          accent: (stored.accent as Accent) || DEFAULT_SETTINGS.accent,
          density: (stored.density as Density) || DEFAULT_SETTINGS.density,
          fontScale: stored.fontScale ? Number(stored.fontScale) : DEFAULT_SETTINGS.fontScale,
          reducedMotion: stored.reducedMotion === "true",
          osNotifications: stored.osNotifications === undefined ? DEFAULT_SETTINGS.osNotifications : stored.osNotifications === "true",
          cliFontSize: stored.cliFontSize ? Number(stored.cliFontSize) : DEFAULT_SETTINGS.cliFontSize,
          cliTheme: (stored.cliTheme as CliTheme) || DEFAULT_SETTINGS.cliTheme,
        };
        setSettings(next);
        applyAccent(next.accent);
        applyDensity(next.density);
        applyFontScale(next.fontScale);
        applyReducedMotion(next.reducedMotion);
      })
      .catch((err) => {
        console.error("設定の読み込みに失敗しました:", err);
      })
      .finally(() => setLoaded(true));
  }, []);

  const value: SettingsContextValue = {
    ...settings,
    loaded,
    setAccent: (v) => {
      setSettings((s) => ({ ...s, accent: v }));
      applyAccent(v);
      persist("accent", v);
    },
    setDensity: (v) => {
      setSettings((s) => ({ ...s, density: v }));
      applyDensity(v);
      persist("density", v);
    },
    setFontScale: (v) => {
      setSettings((s) => ({ ...s, fontScale: v }));
      applyFontScale(v);
      persist("fontScale", String(v));
    },
    setReducedMotion: (v) => {
      setSettings((s) => ({ ...s, reducedMotion: v }));
      applyReducedMotion(v);
      persist("reducedMotion", String(v));
    },
    setOsNotifications: (v) => {
      setSettings((s) => ({ ...s, osNotifications: v }));
      persist("osNotifications", String(v));
    },
    setCliFontSize: (v) => {
      setSettings((s) => ({ ...s, cliFontSize: v }));
      persist("cliFontSize", String(v));
    },
    setCliTheme: (v) => {
      setSettings((s) => ({ ...s, cliTheme: v }));
      persist("cliTheme", v);
    },
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettingsはSettingsProviderの内側で使ってください");
  return ctx;
}
