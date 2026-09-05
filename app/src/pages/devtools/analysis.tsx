import { useState } from "react";
import { CopyButton, textareaStyle, type JsonValue } from "./shared";

const REFERENCE_TIMEZONES = [
  { label: "日本(JST)", zone: "Asia/Tokyo" },
  { label: "協定世界時(UTC)", zone: "UTC" },
  { label: "ニューヨーク", zone: "America/New_York" },
  { label: "ロンドン", zone: "Europe/London" },
  { label: "シドニー", zone: "Australia/Sydney" },
];

export function TimestampTool() {
  const [unix, setUnix] = useState(String(Math.floor(Date.now() / 1000)));
  const [iso, setIso] = useState(new Date().toISOString());

  const fromUnix = (v: string) => {
    setUnix(v);
    const n = Number(v);
    if (!Number.isNaN(n)) setIso(new Date(n * 1000).toISOString());
  };
  const fromIso = (v: string) => {
    setIso(v);
    const t = Date.parse(v);
    if (!Number.isNaN(t)) setUnix(String(Math.floor(t / 1000)));
  };

  const now = new Date();

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 10 }}>
        現在時刻: {now.toLocaleString("ja-JP")}(Unix: {Math.floor(now.getTime() / 1000)})
      </div>
      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>Unixタイムスタンプ(秒)</label>
      <input value={unix} onChange={(e) => fromUnix(e.target.value)} style={{ width: "100%", marginBottom: 10, fontFamily: "var(--font-mono)" }} />
      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>ISO 8601(UTC)</label>
      <input value={iso} onChange={(e) => fromIso(e.target.value)} style={{ width: "100%", marginBottom: 10, fontFamily: "var(--font-mono)" }} />
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 12 }}>
        ローカル時刻: {Number.isNaN(Number(unix)) ? "-" : new Date(Number(unix) * 1000).toLocaleString("ja-JP")}
      </div>
      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 6 }}>タイムゾーン変換</label>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {REFERENCE_TIMEZONES.map((tz) => (
          <div key={tz.zone} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <span style={{ color: "var(--text-faint)" }}>{tz.label}</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>
              {Number.isNaN(Number(unix))
                ? "-"
                : new Date(Number(unix) * 1000).toLocaleString("ja-JP", { timeZone: tz.zone, dateStyle: "medium", timeStyle: "medium" })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RegexTool() {
  const [pattern, setPattern] = useState("");
  const [flags, setFlags] = useState("g");
  const [text, setText] = useState("");
  const [replacement, setReplacement] = useState("");

  let matches: RegExpMatchArray[] = [];
  let error = "";
  let replacementPreview = text;
  try {
    if (pattern) {
      const matchFlags = flags.includes("g") ? flags : flags + "g";
      matches = [...text.matchAll(new RegExp(pattern, matchFlags))];
      replacementPreview = text.replace(new RegExp(pattern, flags), replacement);
    }
  } catch (cause) {
    error = String(cause);
  }

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="正規表現(例: \\d+)"
          style={{ flex: 1, fontFamily: "var(--font-mono)" }}
        />
        <input
          value={flags}
          onChange={(e) => setFlags(e.target.value)}
          placeholder="フラグ(例: gi)"
          style={{ width: 90, fontFamily: "var(--font-mono)" }}
        />
      </div>
      {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>テスト対象テキスト</label>
      <textarea style={{ ...textareaStyle, minHeight: 120 }} value={text} onChange={(e) => setText(e.target.value)} />
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 10 }}>{matches.length}件マッチ</div>
      {matches.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8, maxHeight: 160, overflowY: "auto" }}>
          {matches.map((m, i) => (
            <div key={`${m.index}-${i}`} style={{ background: "var(--surface-raised)", padding: "5px 7px", borderRadius: 4 }}>
              <code style={{ display: "block", fontSize: 11.5 }}>[{m.index}] {m[0]}</code>
              {m.slice(1).map((capture, captureIndex) => (
                <code key={captureIndex} style={{ display: "block", marginTop: 3, color: "var(--text-muted)", fontSize: 11 }}>
                  ${captureIndex + 1}: {capture === undefined ? "（未一致）" : capture}
                </code>
              ))}
              {m.groups && Object.entries(m.groups).map(([name, capture]) => (
                <code key={name} style={{ display: "block", marginTop: 3, color: "var(--accent)", fontSize: 11 }}>
                  {name}: {capture === undefined ? "（未一致）" : capture}
                </code>
              ))}
            </div>
          ))}
        </div>
      )}
      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", margin: "14px 0 4px" }}>置換文字列（$1、$&amp;、名前付きグループを使用可能）</label>
      <input value={replacement} onChange={(e) => setReplacement(e.target.value)} style={{ width: "100%", fontFamily: "var(--font-mono)" }} />
      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", margin: "10px 0 4px" }}>置換プレビュー</label>
      <textarea style={{ ...textareaStyle, minHeight: 120 }} value={error ? "" : replacementPreview} readOnly />
      <div style={{ marginTop: 8 }}><CopyButton text={error ? "" : replacementPreview} /></div>
    </div>
  );
}

type DiffLine = { type: "same" | "add" | "remove"; text: string };

/** 標準的なLCS(最長共通部分列)ベースの行単位差分。行数×行数のDPテーブルを
 * 使う素朴な実装だが、開発ツール用途の入力サイズ(数百行程度)では十分。 */
function lineDiff(a: string, b: string): DiffLine[] {
  const linesA = a.split("\n");
  const linesB = b.split("\n");
  const n = linesA.length;
  const m = linesB.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = linesA[i] === linesB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (linesA[i] === linesB[j]) {
      result.push({ type: "same", text: linesA[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: "remove", text: linesA[i] });
      i++;
    } else {
      result.push({ type: "add", text: linesB[j] });
      j++;
    }
  }
  while (i < n) {
    result.push({ type: "remove", text: linesA[i] });
    i++;
  }
  while (j < m) {
    result.push({ type: "add", text: linesB[j] });
    j++;
  }
  return result;
}

/** JSONの構造差分。キー単位で追加/削除/変更を再帰的に検出する。 */
function jsonDiff(a: JsonValue, b: JsonValue, path = "$"): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const isObjA = a !== null && typeof a === "object" && !Array.isArray(a);
  const isObjB = b !== null && typeof b === "object" && !Array.isArray(b);
  if (isObjA && isObjB) {
    const objA = a as { [key: string]: JsonValue };
    const objB = b as { [key: string]: JsonValue };
    const keys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
    const diffs: string[] = [];
    for (const key of keys) {
      const childPath = `${path}.${key}`;
      if (!(key in objA)) diffs.push(`+ ${childPath} = ${JSON.stringify(objB[key])}`);
      else if (!(key in objB)) diffs.push(`- ${childPath} = ${JSON.stringify(objA[key])}`);
      else diffs.push(...jsonDiff(objA[key], objB[key], childPath));
    }
    return diffs;
  }
  return [`~ ${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`];
}

export function DiffTool() {
  const [mode, setMode] = useState<"text" | "json">("text");
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [error, setError] = useState("");

  const textResult = mode === "text" ? lineDiff(left, right) : [];
  let jsonResult: string[] = [];
  if (mode === "json") {
    try {
      jsonResult = jsonDiff(JSON.parse(left || "null"), JSON.parse(right || "null"));
      if (error) setError("");
    } catch (err) {
      if (!error) setError(String(err));
    }
  }

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <div className="segmented" style={{ marginBottom: 10 }}>
        <button className={mode === "text" ? "active" : ""} onClick={() => setMode("text")}>
          テキスト差分
        </button>
        <button className={mode === "json" ? "active" : ""} onClick={() => setMode("json")}>
          JSON構造差分
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>変更前</label>
          <textarea style={{ ...textareaStyle, minHeight: 140 }} value={left} onChange={(e) => setLeft(e.target.value)} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>変更後</label>
          <textarea style={{ ...textareaStyle, minHeight: 140 }} value={right} onChange={(e) => setRight(e.target.value)} />
        </div>
      </div>
      {mode === "json" && error && <div style={{ color: "var(--danger)", fontSize: 12, margin: "10px 0" }}>{error}</div>}
      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", margin: "12px 0 4px" }}>差分</label>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-s)",
          padding: 8,
          maxHeight: 260,
          overflowY: "auto",
        }}
      >
        {mode === "text" ? (
          textResult.length === 0 ? (
            <span style={{ color: "var(--text-faint)" }}>差分はありません</span>
          ) : (
            textResult.map((line, i) => (
              <div
                key={i}
                style={{
                  color: line.type === "add" ? "var(--success)" : line.type === "remove" ? "var(--danger)" : "var(--text-muted)",
                  background: line.type === "add" ? "var(--success-soft)" : line.type === "remove" ? "var(--danger-soft)" : "transparent",
                  whiteSpace: "pre-wrap",
                }}
              >
                {line.type === "add" ? "+ " : line.type === "remove" ? "- " : "  "}
                {line.text}
              </div>
            ))
          )
        ) : jsonResult.length === 0 ? (
          <span style={{ color: "var(--text-faint)" }}>差分はありません</span>
        ) : (
          jsonResult.map((line, i) => (
            <div key={i} style={{ color: line.startsWith("+") ? "var(--success)" : line.startsWith("-") ? "var(--danger)" : "var(--warning)" }}>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}


