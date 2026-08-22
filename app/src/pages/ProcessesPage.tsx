// §6.12 プロセス・ポート監視(その他の公式プラグイン、v1)。
// 「プロセス検索、リソース表示、使用中ポートとの対応、実行ファイル位置表示」
// を提供する。終了操作は対象PID・名前・影響を確認してから実行する(§10.3)。
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ConfirmDialog from "../commandBus/ConfirmDialog";
import "./pages.css";

type ProcessInfo = {
  pid: number;
  name: string;
  cpu_percent: number;
  mem_bytes: number;
  exe_path: string | null;
  ports: number[];
};

type SortKey = "mem" | "cpu" | "name";

function formatMem(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

export default function ProcessesPage() {
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [query, setQuery] = useState("");
  const [portOnly, setPortOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("mem");
  const [loading, setLoading] = useState(false);
  const [killTarget, setKillTarget] = useState<ProcessInfo | null>(null);
  const [error, setError] = useState("");

  const refresh = () => {
    setLoading(true);
    invoke<ProcessInfo[]>("processes_list")
      .then(setProcesses)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = processes;
    if (q) {
      list = list.filter((p) => p.name.toLowerCase().includes(q) || String(p.pid).includes(q) || p.ports.some((port) => String(port).includes(q)));
    }
    if (portOnly) list = list.filter((p) => p.ports.length > 0);
    const sorted = [...list];
    if (sortKey === "mem") sorted.sort((a, b) => b.mem_bytes - a.mem_bytes);
    else if (sortKey === "cpu") sorted.sort((a, b) => b.cpu_percent - a.cpu_percent);
    else sorted.sort((a, b) => a.name.localeCompare(b.name, "ja"));
    return sorted;
  }, [processes, query, portOnly, sortKey]);

  const runKill = async () => {
    const target = killTarget;
    setKillTarget(null);
    if (!target) return;
    try {
      await invoke("process_kill", { pid: target.pid });
      refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>プロセス・ポート</h1>
          <p>実行中プロセスの検索とリソース確認、使用中ポートとの対応表示</p>
        </div>
        <button className="btn" onClick={refresh} disabled={loading}>
          {loading ? "更新中…" : "更新"}
        </button>
      </div>

      {killTarget && (
        <ConfirmDialog
          title="プロセスを終了しますか?"
          actor="ユーザー(手動実行)"
          action={`「${killTarget.name}」(PID: ${killTarget.pid})を強制終了する`}
          target={killTarget.exe_path ?? killTarget.name}
          impact={killTarget.ports.length > 0 ? `使用中ポート: ${killTarget.ports.join(", ")} も解放されます` : "保存されていないデータは失われる可能性があります"}
          reversibility="元に戻せません"
          requiredPermissions="対象プロセスへのアクセス権限"
          onConfirm={runKill}
          onCancel={() => setKillTarget(null)}
        />
      )}

      {error && (
        <div className="panel-card" style={{ padding: 10, marginBottom: 12, color: "var(--danger)", fontSize: 12.5 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="名前・PID・ポートで検索…" style={{ flex: 1, minWidth: 200 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
          <input type="checkbox" checked={portOnly} onChange={(e) => setPortOnly(e.target.checked)} />
          ポート使用中のみ
        </label>
        <div className="segmented">
          <button className={sortKey === "mem" ? "active" : ""} onClick={() => setSortKey("mem")}>
            メモリ順
          </button>
          <button className={sortKey === "cpu" ? "active" : ""} onClick={() => setSortKey("cpu")}>
            CPU順
          </button>
          <button className={sortKey === "name" ? "active" : ""} onClick={() => setSortKey("name")}>
            名前順
          </button>
        </div>
      </div>

      <div className="panel-card" style={{ overflowX: "auto" }}>
        <table className="plugin-table">
          <thead>
            <tr>
              <th>プロセス</th>
              <th>PID</th>
              <th>CPU</th>
              <th>メモリ</th>
              <th>ポート</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: "var(--text-faint)", padding: 16 }}>
                  該当するプロセスがありません
                </td>
              </tr>
            )}
            {filtered.slice(0, 300).map((p) => (
              <tr key={p.pid}>
                <td>
                  <b style={{ fontSize: 12.5 }}>{p.name}</b>
                  {p.exe_path && (
                    <div className="row-sub" style={{ maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.exe_path}
                    </div>
                  )}
                </td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{p.pid}</td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>{p.cpu_percent.toFixed(1)}%</td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>{formatMem(p.mem_bytes)}</td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{p.ports.length > 0 ? p.ports.join(", ") : "-"}</td>
                <td>
                  <button className="btn" onClick={() => setKillTarget(p)}>
                    終了
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 300 && (
          <div style={{ padding: 10, fontSize: 11.5, color: "var(--text-faint)" }}>
            {filtered.length}件中300件を表示しています。検索で絞り込んでください。
          </div>
        )}
      </div>
    </div>
  );
}
