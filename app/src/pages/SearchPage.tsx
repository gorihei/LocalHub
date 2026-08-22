// §6.6 横断検索。FR-SEARCH-001/002: コマンドパレットと同じ検索関数を使い、
// ショートカット・コマンドをグループ表示する(ファイル内容の全文検索は§6.6の
// 明記どおり将来機能とし、対象外)。
import { useEffect, useState } from "react";
import { searchAll, type SearchResult } from "../search/search";
import { executeCommand } from "../commandBus/commandBus";
import ConfirmDialog from "../commandBus/ConfirmDialog";
import { useLaunchShortcut } from "../shortcuts/useLaunchShortcut";
import "./pages.css";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [confirmTarget, setConfirmTarget] = useState<SearchResult | null>(null);
  const { launch, dialog } = useLaunchShortcut();

  const runCommand = (r: SearchResult) => {
    if (r.type !== "command") return;
    if (r.command.risk_level >= 2) {
      setConfirmTarget(r);
      return;
    }
    executeCommand(r.command.id).catch(console.error);
  };

  const runPluginResult = (r: SearchResult) => {
    if (r.type !== "plugin" || !r.actionCommand) return;
    executeCommand(r.actionCommand, r.actionParams).catch(console.error);
  };

  useEffect(() => {
    searchAll(query).then(setResults);
  }, [query]);

  const shortcuts = results.filter((r) => r.type === "shortcut");
  const commands = results.filter((r) => r.type === "command");
  const pluginResults = results.filter((r) => r.type === "plugin");

  return (
    <div className="page">
      {dialog}
      {confirmTarget && confirmTarget.type === "command" && (
        <ConfirmDialog
          title={`${confirmTarget.command.title}を実行しますか?`}
          actor="ユーザー(検索ページ)"
          action={confirmTarget.command.title}
          target={confirmTarget.command.owner_plugin_id ?? "コア機能"}
          impact={confirmTarget.command.description}
          reversibility={confirmTarget.command.supports_undo ? "Undoに対応しています" : "元に戻せない可能性があります"}
          requiredPermissions="なし"
          onConfirm={() => {
            executeCommand(confirmTarget.command.id).catch(console.error);
            setConfirmTarget(null);
          }}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
      <div className="page-head">
        <div>
          <h1>検索</h1>
          <p>ショートカットとコマンドを横断して検索します</p>
        </div>
      </div>
      <div className="search-field-lg">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="9" cy="9" r="6" />
          <line x1="17" y1="17" x2="13.4" y2="13.4" />
        </svg>
        <input type="text" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="検索…" />
      </div>
      <div className="privacy-chip">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="10" cy="10" r="7" />
          <path d="M10 6v4l3 2" />
        </svg>
        外部送信するプロバイダーは既定で無効です(FR-SEARCH-004)
      </div>

      <div className="result-group">
        <h4>ショートカット</h4>
        {shortcuts.length === 0 ? (
          <div className="activity-empty" style={{ padding: "8px 4px" }}>
            該当なし
          </div>
        ) : (
          <div className="row-list">
            {shortcuts.map((r) =>
              r.type === "shortcut" ? (
                <div key={r.id} className="item-row" onClick={() => launch(r.shortcut)} style={{ cursor: "pointer" }}>
                  <div className="row-main">
                    <div className="row-title">{r.title}</div>
                    <div className="row-sub">{r.subtitle}</div>
                  </div>
                </div>
              ) : null
            )}
          </div>
        )}
      </div>

      <div className="result-group">
        <h4>コマンド</h4>
        {commands.length === 0 ? (
          <div className="activity-empty" style={{ padding: "8px 4px" }}>
            該当なし
          </div>
        ) : (
          <div className="row-list">
            {commands.map((r) =>
              r.type === "command" ? (
                <div
                  key={r.id}
                  className="item-row"
                  onClick={() => runCommand(r)}
                  style={{ cursor: "pointer" }}
                >
                  <div className="row-main">
                    <div className="row-title">{r.title}</div>
                    <div className="row-sub">{r.subtitle}</div>
                  </div>
                  {r.command.risk_level >= 2 && (
                    <span className="type-tag" style={{ color: "var(--warning)", borderColor: "var(--warning)" }}>
                      要確認
                    </span>
                  )}
                </div>
              ) : null
            )}
          </div>
        )}
      </div>

      <div className="result-group">
        <h4>プラグイン</h4>
        {pluginResults.length === 0 ? (
          <div className="activity-empty" style={{ padding: "8px 4px" }}>
            該当なし
          </div>
        ) : (
          <div className="row-list">
            {pluginResults.map((r) =>
              r.type === "plugin" ? (
                <div
                  key={r.id}
                  className="item-row"
                  onClick={() => runPluginResult(r)}
                  style={{ cursor: r.actionCommand ? "pointer" : "default" }}
                >
                  <div className="row-main">
                    <div className="row-title">{r.title}</div>
                    <div className="row-sub">{r.subtitle}</div>
                  </div>
                </div>
              ) : null
            )}
          </div>
        )}
      </div>
    </div>
  );
}
