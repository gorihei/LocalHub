// §6.6 横断検索 / FR-CMD-004 決定的なランキング。
// コマンドパレットと検索ページの両方から使う共通の検索ロジック
// (FR-SEARCH-001: 各プロバイダーの結果を共通形式へ正規化する、の簡易版)。
import { invoke } from "@tauri-apps/api/core";
import { listShortcuts, KIND_LABEL, type Shortcut } from "../shortcuts/shortcuts";
import { listCommands, executeCommand, type CommandMeta } from "../commandBus/commandBus";

export type SearchResult =
  | { type: "shortcut"; id: string; title: string; subtitle: string; shortcut: Shortcut; score: number }
  | { type: "command"; id: string; title: string; subtitle: string; command: CommandMeta; score: number }
  | { type: "plugin"; id: string; title: string; subtitle: string; actionCommand: string | null; actionParams: unknown; score: number };

type SearchProviderInfo = { pluginId: string; id: string; title: string; command: string };
type PluginSearchItem = { title: string; subtitle?: string; actionCommand?: string; actionParams?: unknown };

// FR-CMD-004: 完全一致 > 前方一致 > 部分一致。同点は利用頻度、最後にID昇順で
// 決定的に並べる(同じ状態・入力には常に同じ順序を返す)。
function matchScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q === t) return 3;
  if (t.startsWith(q)) return 2;
  if (t.includes(q)) return 1;
  return 0;
}

// §6.6 FR-SEARCH-001: プラグイン検索プロバイダー(§10権限モデルに沿い、
// プロバイダー呼び出し自体はcommand_bus_execute経由なので、通常のコマンド
// 実行と同じ扱いになる)。プラグインが未起動/クラッシュ中でも横断検索
// 全体を壊さないよう、1プロバイダーの失敗は無視して他の結果だけ返す。
async function searchPluginProviders(query: string): Promise<SearchResult[]> {
  let providers: SearchProviderInfo[];
  try {
    providers = await invoke<SearchProviderInfo[]>("plugin_search_providers_list");
  } catch {
    return [];
  }
  const perProvider = await Promise.all(
    providers.map(async (provider) => {
      try {
        const items = await executeCommand<PluginSearchItem[]>(provider.command, { query });
        return items.map(
          (item, index): SearchResult => ({
            type: "plugin",
            id: `plugin-${provider.pluginId}-${provider.id}-${index}`,
            title: item.title,
            subtitle: item.subtitle ?? provider.title,
            actionCommand: item.actionCommand ?? null,
            actionParams: item.actionParams ?? null,
            score: query.trim() === "" ? 0.5 : 1.5,
          })
        );
      } catch {
        return [];
      }
    })
  );
  return perProvider.flat();
}

export async function searchAll(query: string): Promise<SearchResult[]> {
  const q = query.trim();

  const [shortcuts, commands, pluginResults] = await Promise.all([
    listShortcuts(),
    listCommands(),
    // 空クエリ時は毎回全プラグインへ問い合わせるのは無駄なので省略する。
    q === "" ? Promise.resolve<SearchResult[]>([]) : searchPluginProviders(q),
  ]);

  const results: SearchResult[] = [...pluginResults];

  for (const s of shortcuts) {
    const score = q === "" ? 1 : Math.max(matchScore(q, s.name), matchScore(q, s.tags) * 0.5);
    if (score > 0) {
      results.push({
        type: "shortcut",
        id: `shortcut-${s.id}`,
        title: s.name,
        subtitle: `${KIND_LABEL[s.kind]}・${s.target}`,
        shortcut: s,
        score: score + s.use_count * 0.01,
      });
    }
  }

  for (const c of commands) {
    const score = q === "" ? 1 : Math.max(matchScore(q, c.title), matchScore(q, c.id) * 0.7);
    if (score > 0) {
      results.push({
        type: "command",
        id: `command-${c.id}`,
        title: c.title,
        subtitle: c.description,
        command: c,
        score,
      });
    }
  }

  results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "ja"));
  return results;
}
