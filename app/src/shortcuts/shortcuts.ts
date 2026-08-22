// FR-LAUNCH ショートカット・起動セットのフロント側ヘルパー。
import { invoke } from "@tauri-apps/api/core";
import { executeCommand } from "../commandBus/commandBus";

export type ShortcutKind = "app" | "file" | "folder" | "url" | "command";

export type Shortcut = {
  id: number;
  name: string;
  description: string;
  kind: ShortcutKind;
  target: string;
  args: string;
  cwd: string;
  admin: boolean;
  favorite: boolean;
  tags: string;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  sort_order: number;
};

export type NewShortcut = {
  name: string;
  description?: string;
  kind: ShortcutKind;
  target: string;
  args?: string;
  cwd?: string;
  admin?: boolean;
  tags?: string;
};

// ダッシュボードには複数のウィジェット(ランチャー・最近使った・起動セット)が
// 独立して同じデータを表示しているため、どこかで起動/追加/削除/実行が起きたら
// 他のウィジェットにも再読み込みを促す簡易イベントバス。
const CHANGE_EVENT = "local-hub:shortcuts-changed";
export function notifyShortcutsChanged() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
export function onShortcutsChanged(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

export const listShortcuts = () => invoke<Shortcut[]>("shortcuts_list");
export const recentShortcuts = (limit = 10) => invoke<Shortcut[]>("shortcuts_recent", { limit });

export const addShortcut = async (input: NewShortcut) => {
  const id = await invoke<number>("shortcuts_add", { input });
  notifyShortcutsChanged();
  return id;
};

export const updateShortcut = async (id: number, input: NewShortcut) => {
  await invoke("shortcuts_update", { id, input });
  notifyShortcutsChanged();
};

export const deleteShortcut = async (id: number) => {
  await invoke("shortcuts_delete", { id });
  notifyShortcutsChanged();
};

export const setFavorite = async (id: number, favorite: boolean) => {
  await invoke("shortcuts_set_favorite", { id, favorite });
  notifyShortcutsChanged();
};

export const reorderShortcuts = async (ids: number[]) => {
  await invoke("shortcuts_reorder", { ids });
  notifyShortcutsChanged();
};

// アイコン取得はプロセス呼び出しを伴うため、同じパスに対しては結果をメモ化する。
const iconCache = new Map<string, Promise<string | null>>();
export function getShortcutIcon(path: string): Promise<string | null> {
  if (!iconCache.has(path)) {
    iconCache.set(
      path,
      invoke<string>("shortcut_icon", { path }).catch(() => null)
    );
  }
  return iconCache.get(path)!;
}

// §12.4: 実際の起動はコマンドバス経由(shortcuts.launch)で行う。
export const launchShortcut = async (id: number) => {
  const result = await executeCommand("shortcuts.launch", { id });
  notifyShortcutsChanged();
  return result;
};

export type LaunchSet = { id: number; name: string; created_at: string };
export type LaunchSetItem = { shortcut_id: number; name: string; order_index: number };
export type LaunchResult = { name: string; success: boolean; error: string };

export const listLaunchSets = () => invoke<LaunchSet[]>("launch_sets_list");
export const launchSetItems = (launchSetId: number) =>
  invoke<LaunchSetItem[]>("launch_set_items", { launchSetId });

export const addLaunchSet = async (name: string, shortcutIds: number[]) => {
  const id = await invoke<number>("launch_sets_add", { name, shortcutIds });
  notifyShortcutsChanged();
  return id;
};

export const deleteLaunchSet = async (id: number) => {
  await invoke("launch_sets_delete", { id });
  notifyShortcutsChanged();
};

export const runLaunchSet = async (id: number) => {
  const result = await executeCommand<LaunchResult[]>("launchSets.run", { id });
  notifyShortcutsChanged();
  return result;
};

export const KIND_LABEL: Record<ShortcutKind, string> = {
  app: "EXE",
  file: "FILE",
  folder: "DIR",
  url: "URL",
  command: "CLI",
};
