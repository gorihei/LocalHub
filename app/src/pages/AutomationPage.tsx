// §6.8 自動化(FR-AUTO-001) trigger -> conditions -> actions。
// MVP範囲(FR-AUTO-002)は起動セットのみとREQUIREMENTS.mdに明記されているが、
// 利用者要望により汎用フロービルダー(v1相当)を実装している。
// FR-AUTO-005: riskLevel>=2(変更・不可逆)のコマンドは保存時にRust側で
// 拒否されるため、自動化に追加できるのは閲覧・軽微操作のみ。
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import ConfirmDialog from "../commandBus/ConfirmDialog";
import "./pages.css";

type ActionInput = { commandId: string; params: unknown };
type TriggerType = "manual" | "startup" | "schedule";

type FlowDto = {
  id: number;
  name: string;
  enabled: boolean;
  triggerType: TriggerType;
  triggerConfig: { time?: string; days?: number[] };
  stopOnFailure: boolean;
  lastRunAt: string | null;
  lastRunStatus: "success" | "error" | null;
  actions: ActionInput[];
};

type CommandMeta = { id: string; title: string; description: string; risk_level: number };

const TRIGGER_LABEL: Record<TriggerType, string> = { manual: "手動", startup: "アプリ起動時", schedule: "スケジュール" };
const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function triggerSummary(flow: FlowDto): string {
  if (flow.triggerType === "schedule") {
    const days = (flow.triggerConfig.days ?? []).map((d) => DAY_LABELS[d]).join("");
    return `毎週${days || "?"} ${flow.triggerConfig.time ?? "--:--"}`;
  }
  return TRIGGER_LABEL[flow.triggerType];
}

function FlowEditor({
  flow,
  commands,
  onClose,
  onSaved,
}: {
  flow: FlowDto | null;
  commands: CommandMeta[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(flow?.name ?? "");
  const [triggerType, setTriggerType] = useState<TriggerType>(flow?.triggerType ?? "manual");
  const [time, setTime] = useState(flow?.triggerConfig.time ?? "09:00");
  const [days, setDays] = useState<number[]>(flow?.triggerConfig.days ?? [1, 2, 3, 4, 5]);
  const [stopOnFailure, setStopOnFailure] = useState(flow?.stopOnFailure ?? true);
  const [actions, setActions] = useState<ActionInput[]>(flow?.actions ?? []);
  const [addCommandId, setAddCommandId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const toggleDay = (d: number) => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  const addAction = () => {
    if (!addCommandId) return;
    setActions((prev) => [...prev, { commandId: addCommandId, params: {} }]);
    setAddCommandId("");
  };

  const updateActionParams = (index: number, text: string) => {
    setActions((prev) => prev.map((a, i) => (i === index ? { ...a, params: text } : a)));
  };

  const removeAction = (index: number) => setActions((prev) => prev.filter((_, i) => i !== index));
  const moveAction = (index: number, dir: -1 | 1) => {
    setActions((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const save = async () => {
    setError("");
    if (!name.trim()) return setError("名前を入力してください");
    if (actions.length === 0) return setError("アクションを1つ以上追加してください");
    let parsedActions: ActionInput[];
    try {
      parsedActions = actions.map((a) => ({ commandId: a.commandId, params: typeof a.params === "string" ? JSON.parse(a.params || "{}") : a.params }));
    } catch {
      setError("アクションのパラメータがJSONとして正しくありません");
      return;
    }
    setSaving(true);
    try {
      await invoke("automation_flow_upsert", {
        input: {
          id: flow?.id ?? null,
          name,
          enabled: flow?.enabled ?? true,
          triggerType,
          triggerConfig: triggerType === "schedule" ? { time, days } : {},
          stopOnFailure,
          actions: parsedActions,
        },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(4,6,10,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ width: 520, maxHeight: "85vh", overflowY: "auto", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--radius-m)", padding: 18 }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 14.5 }}>{flow ? "自動化を編集" : "自動化を追加"}</h3>

        <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>名前</label>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", marginBottom: 10 }} autoFocus />

        <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>トリガー</label>
        <select value={triggerType} onChange={(e) => setTriggerType(e.target.value as TriggerType)} style={{ width: "100%", marginBottom: 10 }}>
          <option value="manual">手動(「今すぐ実行」ボタンのみ)</option>
          <option value="startup">アプリ起動時</option>
          <option value="schedule">スケジュール</option>
        </select>

        {triggerType === "schedule" && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              <div style={{ display: "flex", gap: 4 }}>
                {DAY_LABELS.map((label, d) => (
                  <button
                    key={d}
                    type="button"
                    className={`btn${days.includes(d) ? " active" : ""}`}
                    style={{ width: 30, padding: 0 }}
                    onClick={() => toggleDay(d)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={stopOnFailure} onChange={(e) => setStopOnFailure(e.target.checked)} />
          途中のアクションが失敗したら以降を中断する
        </label>

        <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>
          アクション(上から順に実行)
        </label>
        <div style={{ marginBottom: 8 }}>
          {actions.map((action, i) => {
            const meta = commands.find((c) => c.id === action.commandId);
            return (
              <div key={i} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-s)", padding: 8, marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <b style={{ fontSize: 12 }}>{meta?.title ?? action.commandId}</b>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="btn" style={{ padding: "0 6px", height: 22 }} onClick={() => moveAction(i, -1)} disabled={i === 0}>
                      ↑
                    </button>
                    <button className="btn" style={{ padding: "0 6px", height: 22 }} onClick={() => moveAction(i, 1)} disabled={i === actions.length - 1}>
                      ↓
                    </button>
                    <button className="btn" style={{ padding: "0 6px", height: 22 }} onClick={() => removeAction(i)}>
                      削除
                    </button>
                  </div>
                </div>
                <input
                  value={typeof action.params === "string" ? action.params : JSON.stringify(action.params)}
                  onChange={(e) => updateActionParams(i, e.target.value)}
                  placeholder="パラメータ(JSON, 例: {&quot;id&quot;: 1})"
                  style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 11 }}
                />
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          <select value={addCommandId} onChange={(e) => setAddCommandId(e.target.value)} style={{ flex: 1 }}>
            <option value="">コマンドを選択…</option>
            {commands.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <button className="btn" onClick={addAction} disabled={!addCommandId}>
            追加
          </button>
        </div>

        {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 10 }}>{error}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn btn-primary" style={{ background: "var(--accent)", color: "#062226", borderColor: "var(--accent)" }} disabled={saving} onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function AutomationPage() {
  const [flows, setFlows] = useState<FlowDto[]>([]);
  const [commands, setCommands] = useState<CommandMeta[]>([]);
  const [editing, setEditing] = useState<FlowDto | null | "new">(null);
  const [deleteTarget, setDeleteTarget] = useState<FlowDto | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  const refresh = () => {
    invoke<FlowDto[]>("automation_flows_list").then(setFlows).catch(console.error);
  };

  useEffect(() => {
    refresh();
    invoke<CommandMeta[]>("command_bus_list").then((list) => setCommands(list.filter((c) => c.risk_level <= 1)));
  }, []);

  const toggleEnabled = (flow: FlowDto) => {
    invoke("automation_flow_set_enabled", { id: flow.id, enabled: !flow.enabled }).then(refresh);
  };

  const runNow = async (flow: FlowDto) => {
    setRunningId(flow.id);
    setMessage("");
    try {
      const results = await invoke<{ commandId: string; success: boolean; error: string | null }[]>("automation_flow_run_now", { id: flow.id });
      const failed = results.filter((r) => !r.success).length;
      setMessage(failed > 0 ? `「${flow.name}」: ${failed}件のアクションが失敗しました` : `「${flow.name}」: 実行しました`);
    } catch (err) {
      setMessage(String(err));
    } finally {
      setRunningId(null);
      refresh();
    }
  };

  const runDelete = async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    await invoke("automation_flow_delete", { id: target.id });
    refresh();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>自動化</h1>
          <p>trigger → conditions → actions(§10.3準拠: 変更を伴う操作は自動化に追加できません)</p>
        </div>
        <button className="btn" onClick={() => setEditing("new")}>
          + 自動化を追加
        </button>
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="自動化を削除しますか?"
          actor="ユーザー(手動実行)"
          action={`「${deleteTarget.name}」を削除する`}
          target={deleteTarget.name}
          impact="このフローとアクションの設定がすべて削除されます"
          reversibility="元に戻せません"
          requiredPermissions="なし"
          onConfirm={runDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {editing !== null && (
        <FlowEditor
          flow={editing === "new" ? null : editing}
          commands={commands}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}

      {message && (
        <div className="panel-card" style={{ padding: 10, marginBottom: 12, fontSize: 12.5, color: "var(--text-muted)" }}>
          {message}
        </div>
      )}

      {flows.length === 0 ? (
        <div className="panel-card">
          <div className="empty-state">
            <div className="icon-wrap">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M11 3 5 12h4l-1 5 7-9h-4z" />
              </svg>
            </div>
            <h3>自動化はまだありません</h3>
            <p>「+ 自動化を追加」から、トリガーとアクションを組み合わせたフローを作成できます。</p>
          </div>
        </div>
      ) : (
        <div className="panel-card" style={{ overflowX: "auto" }}>
          <table className="plugin-table">
            <thead>
              <tr>
                <th>名前</th>
                <th>トリガー</th>
                <th>有効</th>
                <th>前回実行</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {flows.map((flow) => (
                <tr key={flow.id}>
                  <td>
                    <b style={{ fontSize: 12.5 }}>{flow.name}</b>
                    <div className="row-sub">{flow.actions.length}件のアクション</div>
                  </td>
                  <td style={{ fontSize: 12 }}>{triggerSummary(flow)}</td>
                  <td>
                    <button className={`toggle${flow.enabled ? " on" : ""}`} onClick={() => toggleEnabled(flow)} />
                  </td>
                  <td style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                    {flow.lastRunAt ? (
                      <span style={{ color: flow.lastRunStatus === "error" ? "var(--danger)" : "var(--text-muted)" }}>
                        {flow.lastRunAt} {flow.lastRunStatus === "error" ? "(失敗)" : "(成功)"}
                      </span>
                    ) : (
                      "未実行"
                    )}
                  </td>
                  <td>
                    <div className="table-actions">
                      <button className="btn" disabled={runningId === flow.id} onClick={() => runNow(flow)}>
                        今すぐ実行
                      </button>
                      <button className="btn" onClick={() => setEditing(flow)}>
                        編集
                      </button>
                      <button className="btn" onClick={() => setDeleteTarget(flow)}>
                        削除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
