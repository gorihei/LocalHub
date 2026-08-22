// §6.9 通知とアクティビティ。バックエンド(notifications::push)からのイベントを
// 受け取り、履歴とトースト(自動消去・同一イベントの集約)を管理する。
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useSettings } from "../settings/SettingsContext";

export type NotificationLevel = "success" | "info" | "warning" | "error";

export type NotificationRecord = {
  id: number;
  level: NotificationLevel;
  title: string;
  body: string;
  created_at: string;
};

type Toast = NotificationRecord & { count: number };

const TOAST_LIFETIME_MS = 4000;
const AGGREGATE_WINDOW_MS = 10000;

type Ctx = {
  history: NotificationRecord[];
  toasts: Toast[];
  refreshHistory: () => void;
};

const NotificationContext = createContext<Ctx | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { osNotifications } = useSettings();
  const osNotificationsRef = useRef(osNotifications);
  osNotificationsRef.current = osNotifications;

  const [history, setHistory] = useState<NotificationRecord[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastRef = useRef<Toast | null>(null);

  const refreshHistory = () => {
    invoke<NotificationRecord[]>("notifications_list", { limit: 50 })
      .then(setHistory)
      .catch((err) => console.error("通知履歴の取得に失敗しました:", err));
  };

  useEffect(() => {
    refreshHistory();

    const unlisten = listen<NotificationRecord>("app://notification", (event) => {
      const record = event.payload;
      setHistory((prev) => [record, ...prev].slice(0, 50));

      // 同一タイトルが短時間に連続した場合は件数を積み上げて集約する。
      setToasts((prev) => {
        const now = Date.now();
        const last = lastRef.current;
        if (last && last.title === record.title && now - Date.parse(last.created_at) < AGGREGATE_WINDOW_MS) {
          const merged = { ...last, count: last.count + 1, body: record.body, created_at: record.created_at };
          lastRef.current = merged;
          return prev.map((t) => (t.id === last.id ? merged : t));
        }
        const toast: Toast = { ...record, count: 1 };
        lastRef.current = toast;
        setTimeout(() => {
          setToasts((cur) => cur.filter((t) => t.id !== toast.id));
        }, TOAST_LIFETIME_MS);
        return [...prev, toast];
      });

      if (osNotificationsRef.current) {
        isPermissionGranted()
          .then((granted) => (granted ? granted : requestPermission().then((p) => p === "granted")))
          .then((granted) => {
            if (granted) sendNotification({ title: record.title, body: record.body });
          })
          .catch(() => {
            // OS通知の失敗はアプリ内通知の表示を妨げない
          });
      }
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  return (
    <NotificationContext.Provider value={{ history, toasts, refreshHistory }}>{children}</NotificationContext.Provider>
  );
}

export function useNotifications(): Ctx {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotificationsはNotificationProviderの内側で使ってください");
  return ctx;
}
