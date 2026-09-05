import { useState } from "react";
import * as yaml from "js-yaml";
import { CopyButton, textareaStyle, type JsonValue } from "./shared";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function JsonTreeNode({ label, value, depth }: { label: string | null; value: JsonValue; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const isObject = value !== null && typeof value === "object";
  const indent = { paddingLeft: depth * 14 };

  if (!isObject) {
    const display = typeof value === "string" ? `"${value}"` : String(value);
    const color = typeof value === "string" ? "var(--success)" : typeof value === "number" ? "var(--accent)" : "var(--violet)";
    return (
      <div style={{ ...indent, fontSize: 12, fontFamily: "var(--font-mono)", lineHeight: 1.7 }}>
        {label !== null && <span style={{ color: "var(--text-faint)" }}>{label}: </span>}
        <span style={{ color }}>{display}</span>
      </div>
    );
  }

  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  const bracket = Array.isArray(value) ? ["[", "]"] : ["{", "}"];

  return (
    <div style={indent}>
      <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", lineHeight: 1.7, cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>
        <span style={{ color: "var(--text-faint)", display: "inline-block", width: 12 }}>{open ? "▾" : "▸"}</span>
        {label !== null && <span style={{ color: "var(--text-faint)" }}>{label}: </span>}
        <span style={{ color: "var(--text-muted)" }}>
          {bracket[0]}
          {!open && `…${entries.length}件…`}
          {!open && bracket[1]}
        </span>
      </div>
      {open && (
        <>
          {entries.map(([k, v]) => (
            <JsonTreeNode key={k} label={k} value={v} depth={depth + 1} />
          ))}
          <div style={{ ...indent, fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{bracket[1]}</div>
        </>
      )}
    </div>
  );
}

export function JsonTool() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [parsed, setParsed] = useState<JsonValue | null>(null);
  const [view, setView] = useState<"text" | "tree">("text");
  const [error, setError] = useState("");

  const run = (mode: "format" | "minify") => {
    try {
      const value = JSON.parse(input);
      setOutput(mode === "format" ? JSON.stringify(value, null, 2) : JSON.stringify(value));
      setParsed(value);
      setError("");
    } catch (err) {
      setError(`不正なJSONです: ${String(err)}`);
      setOutput("");
      setParsed(null);
    }
  };

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>入力</label>
      <textarea style={textareaStyle} value={input} onChange={(e) => setInput(e.target.value)} placeholder='{"example": true}' />
      <div style={{ display: "flex", gap: 8, margin: "10px 0" }}>
        <button className="btn" onClick={() => run("format")}>
          整形
        </button>
        <button className="btn" onClick={() => run("minify")}>
          圧縮
        </button>
        <div className="segmented" style={{ marginLeft: "auto" }}>
          <button className={view === "text" ? "active" : ""} onClick={() => setView("text")}>
            テキスト
          </button>
          <button className={view === "tree" ? "active" : ""} onClick={() => setView("tree")}>
            ツリー
          </button>
        </div>
      </div>
      {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>結果</label>
      {view === "text" ? (
        <textarea style={textareaStyle} value={output} readOnly />
      ) : (
        <div style={{ ...textareaStyle, overflow: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-s)", padding: 8 }}>
          {parsed === null ? <span style={{ color: "var(--text-faint)", fontSize: 12 }}>整形を実行してください</span> : <JsonTreeNode label={null} value={parsed} depth={0} />}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <CopyButton text={output} />
      </div>
    </div>
  );
}

export function YamlTool() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");

  const yamlToJson = () => {
    try {
      setOutput(JSON.stringify(yaml.load(input), null, 2));
      setError("");
    } catch (err) {
      setError(String(err));
    }
  };
  const jsonToYaml = () => {
    try {
      setOutput(yaml.dump(JSON.parse(input)));
      setError("");
    } catch (err) {
      setError(String(err));
    }
  };
  const validate = () => {
    try {
      yaml.load(input);
      setError("有効なYAMLです");
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>入力(YAMLまたはJSON)</label>
      <textarea style={textareaStyle} value={input} onChange={(e) => setInput(e.target.value)} placeholder={"key: value\nlist:\n  - a\n  - b"} />
      <div style={{ display: "flex", gap: 8, margin: "10px 0" }}>
        <button className="btn" onClick={yamlToJson}>
          YAML→JSON
        </button>
        <button className="btn" onClick={jsonToYaml}>
          JSON→YAML
        </button>
        <button className="btn" onClick={validate}>
          検証
        </button>
      </div>
      {error && <div style={{ color: error === "有効なYAMLです" ? "var(--success)" : "var(--danger)", fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>結果</label>
      <textarea style={textareaStyle} value={output} readOnly />
      <div style={{ marginTop: 8 }}>
        <CopyButton text={output} />
      </div>
    </div>
  );
}

/** XMLServializerはインデントを付けないため、開閉タグの前後に改行を入れて
 * 深さに応じたインデントを付け直す簡易フォーマッタ。 */
function prettyPrintXml(xml: string): string {
  const collapsed = xml.replace(/>\s*</g, "><").trim();
  let formatted = "";
  let depth = 0;
  const tokens = collapsed.split(/(?=<)/);
  for (const token of tokens) {
    if (!token) continue;
    const isClosing = /^<\//.test(token);
    const isSelfClosing = /\/>\s*$/.test(token) || /^<\?/.test(token) || /^<!/.test(token);
    if (isClosing) depth = Math.max(0, depth - 1);
    formatted += "  ".repeat(depth) + token + "\n";
    if (!isClosing && !isSelfClosing) depth += 1;
  }
  return formatted.trim();
}

export function XmlTool() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");

  const format = () => {
    const doc = new DOMParser().parseFromString(input, "application/xml");
    const errorNode = doc.querySelector("parsererror");
    if (errorNode) {
      setError(`不正なXMLです: ${errorNode.textContent}`);
      setOutput("");
      return;
    }
    setOutput(prettyPrintXml(input));
    setError("");
  };

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>入力</label>
      <textarea style={textareaStyle} value={input} onChange={(e) => setInput(e.target.value)} placeholder="<root><item>value</item></root>" />
      <div style={{ display: "flex", gap: 8, margin: "10px 0" }}>
        <button className="btn" onClick={format}>
          整形・検証
        </button>
      </div>
      {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 10, whiteSpace: "pre-wrap" }}>{error}</div>}
      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>結果</label>
      <textarea style={textareaStyle} value={output} readOnly />
      <div style={{ marginTop: 8 }}>
        <CopyButton text={output} />
      </div>
    </div>
  );
}

export function TextTool() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");

  const run = (fn: (s: string) => string) => {
    try {
      setOutput(fn(input));
      setError("");
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>入力</label>
      <textarea style={{ ...textareaStyle, minHeight: 100 }} value={input} onChange={(e) => setInput(e.target.value)} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0" }}>
        <button className="btn" onClick={() => run((s) => btoa(unescape(encodeURIComponent(s))))}>
          Base64エンコード
        </button>
        <button className="btn" onClick={() => run((s) => decodeURIComponent(escape(atob(s))))}>
          Base64デコード
        </button>
        <button className="btn" onClick={() => run((s) => encodeURIComponent(s))}>
          URLエンコード
        </button>
        <button className="btn" onClick={() => run((s) => decodeURIComponent(s))}>
          URLデコード
        </button>
        <button
          className="btn"
          onClick={() => run((s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!))}
        >
          HTMLエスケープ
        </button>
        <button className="btn" onClick={() => run((s) => s.toUpperCase())}>
          大文字化
        </button>
        <button className="btn" onClick={() => run((s) => s.toLowerCase())}>
          小文字化
        </button>
        <button className="btn" onClick={() => run((s) => s.replace(/\r\n|\r|\n/g, "\r\n"))}>
          改行→CRLF
        </button>
        <button className="btn" onClick={() => run((s) => s.replace(/\r\n|\r/g, "\n"))}>
          改行→LF
        </button>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 10 }}>
        文字数: {input.length} / 行数: {input === "" ? 0 : input.split("\n").length}
      </div>
      {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>結果</label>
      <textarea style={{ ...textareaStyle, minHeight: 100 }} value={output} readOnly />
      <div style={{ marginTop: 8 }}>
        <CopyButton text={output} />
      </div>
    </div>
  );
}


