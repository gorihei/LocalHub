// §12.4 コマンドバスのフロント側ヘルパー。UIはRustコマンドを直接叩くのではなく、
// ここを経由することでリスクレベルに応じた確認フロー(§10.3)を一貫させる。
import { invoke } from "@tauri-apps/api/core";

export type CommandMeta = {
  id: string;
  title: string;
  description: string;
  owner_plugin_id: string | null;
  risk_level: number;
  supports_undo: boolean;
};

export function listCommands(): Promise<CommandMeta[]> {
  return invoke<CommandMeta[]>("command_bus_list");
}

export function executeCommand<T = unknown>(id: string, params: unknown = null): Promise<T> {
  return invoke<T>("command_bus_execute", { id, params });
}
