import { useState } from "react";
import { CodeEditor, CopyButton } from "./shared";

export function NumberBaseTool() {
  const [decimal, setDecimal] = useState("255");

  const update = (value: string, base: number) => {
    const n = parseInt(value.trim() || "0", base);
    if (Number.isNaN(n) || n < 0) return;
    setDecimal(String(n));
  };

  const n = parseInt(decimal || "0", 10);
  const valid = !Number.isNaN(n) && n >= 0;
  const fields: [string, string, number][] = [
    ["2進数", valid ? n.toString(2) : "", 2],
    ["8進数", valid ? n.toString(8) : "", 8],
    ["10進数", valid ? n.toString(10) : "", 10],
    ["16進数", valid ? n.toString(16).toUpperCase() : "", 16],
  ];

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 10 }}>0以上の整数を各進数で相互変換します</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {fields.map(([label, value, base]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 56, fontSize: 11.5, color: "var(--text-faint)" }}>{label}</span>
            <input
              value={value}
              onChange={(e) => update(e.target.value, base)}
              style={{ flex: 1, fontFamily: "var(--font-mono)" }}
              placeholder={!valid ? "無効な値です" : undefined}
            />
            <CopyButton text={value} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function UrlTool() {
  const [raw, setRaw] = useState("https://example.com/path/to/page?foo=1&bar=hello#section");
  const [error, setError] = useState("");
  const [encodeInput, setEncodeInput] = useState("");

  let parsed: URL | null = null;
  try {
    parsed = raw.trim() ? new URL(raw.trim()) : null;
    if (error) setError("");
  } catch {
    parsed = null;
  }

  const rows: [string, string][] = parsed
    ? [
        ["protocol", parsed.protocol],
        ["host", parsed.host],
        ["hostname", parsed.hostname],
        ["port", parsed.port || "(既定)"],
        ["pathname", parsed.pathname],
        ["search", parsed.search || "(なし)"],
        ["hash", parsed.hash || "(なし)"],
      ]
    : [];

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>URL</label>
      <input value={raw} onChange={(e) => setRaw(e.target.value)} style={{ width: "100%", fontFamily: "var(--font-mono)" }} />
      {!parsed && raw.trim() && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>有効なURLではありません</div>}
      {parsed && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map(([label, value]) => (
            <div key={label} style={{ display: "flex", gap: 8 }}>
              <span style={{ width: 80, fontSize: 11.5, color: "var(--text-faint)" }}>{label}</span>
              <code style={{ fontSize: 12 }}>{value}</code>
            </div>
          ))}
          {[...parsed.searchParams.entries()].length > 0 && (
            <>
              <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>クエリパラメータ</div>
              <table className="plugin-table">
                <tbody>
                  {[...parsed.searchParams.entries()].map(([k, v], i) => (
                    <tr key={`${k}-${i}`}>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{k}</td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
        <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>URLエンコード/デコード</label>
        <CodeEditor value={encodeInput} onChange={setEncodeInput} minHeight={70} />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="btn" onClick={() => setEncodeInput(encodeURIComponent(encodeInput))}>
            エンコード
          </button>
          <button
            className="btn"
            onClick={() => {
              try {
                setEncodeInput(decodeURIComponent(encodeInput));
              } catch (err) {
                setError(String(err));
              }
            }}
          >
            デコード
          </button>
          <CopyButton text={encodeInput} />
        </div>
        {error && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 6 }}>{error}</div>}
      </div>
    </div>
  );
}

export function TextCountTool() {
  const [text, setText] = useState("");
  const chars = [...text].length;
  const charsNoSpace = [...text.replace(/\s/g, "")].length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const lines = text === "" ? 0 : text.split("\n").length;
  const bytes = new TextEncoder().encode(text).length;

  const stats: [string, number][] = [
    ["文字数", chars],
    ["文字数(空白除く)", charsNoSpace],
    ["単語数(空白区切り)", words],
    ["行数", lines],
    ["バイト数(UTF-8)", bytes],
  ];

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <CodeEditor value={text} onChange={setText} minHeight={200} placeholder="テキストを入力…" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 12 }}>
        {stats.map(([label, value]) => (
          <div key={label} className="panel-card" style={{ padding: "8px 12px" }}>
            <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{label}</div>
            <div style={{ fontSize: 18, fontVariantNumeric: "tabular-nums" }}>{value.toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

