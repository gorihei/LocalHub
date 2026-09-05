// §6.11 開発者ツールボックス(v1)。JSON整形・Base64・URLエンコード・
// UUID/ハッシュ生成・タイムスタンプ変換・正規表現テスト。
// 画像背景透過はONNX Runtime Web、QRコード生成はqrcodeを利用する。
// いずれも入力データを外部へ送信しない
// (§6.11「変換は入力を暗黙に外部送信せず、ローカルで処理する」)。
import { useEffect, useState, type CSSProperties, type ChangeEvent, type DragEvent } from "react";
import * as yaml from "js-yaml";
import QRCode from "qrcode";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import "./pages.css";

type ToolTab =
  | "json"
  | "yaml"
  | "xml"
  | "text"
  | "uuid"
  | "timestamp"
  | "regex"
  | "diff"
  | "color"
  | "jwt"
  | "fake"
  | "markdown"
  | "number"
  | "url"
  | "count"
  | "password"
  | "unit"
  | "qr"
  | "port"
  | "background";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1000);
        });
      }}
      disabled={!text}
    >
      {copied ? "コピーしました" : "コピー"}
    </button>
  );
}

const textareaStyle: CSSProperties = {
  width: "100%",
  minHeight: 160,
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  resize: "vertical",
};

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

function JsonTool() {
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

function YamlTool() {
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

function XmlTool() {
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

function TextTool() {
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

type HashAlgo = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";
const HASH_ALGOS: HashAlgo[] = ["SHA-1", "SHA-256", "SHA-384", "SHA-512"];

// MD5はWeb Crypto API(SubtleCrypto)が対応していない(セキュリティ上非推奨の
// ため意図的に未実装)。追加のライブラリなしで完結させる方針のため省略する。
async function digestHex(algo: HashAlgo, text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest(algo, data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function UuidTool() {
  const [uuids, setUuids] = useState<string[]>([]);
  const [hashInput, setHashInput] = useState("");
  const [hashAlgo, setHashAlgo] = useState<HashAlgo>("SHA-256");
  const [hash, setHash] = useState("");

  const generate = (count: number) => setUuids(Array.from({ length: count }, () => crypto.randomUUID()));

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>UUID生成</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button className="btn" onClick={() => generate(1)}>
          1件生成
        </button>
        <button className="btn" onClick={() => generate(5)}>
          5件生成
        </button>
      </div>
      {uuids.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          {uuids.map((u) => (
            <div key={u} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <code style={{ fontSize: 12, flex: 1 }}>{u}</code>
              <CopyButton text={u} />
            </div>
          ))}
        </div>
      )}

      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>ハッシュ生成(MD5は非対応)</label>
      <input value={hashInput} onChange={(e) => setHashInput(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
      <div style={{ display: "flex", gap: 8 }}>
        <select value={hashAlgo} onChange={(e) => setHashAlgo(e.target.value as HashAlgo)}>
          {HASH_ALGOS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => digestHex(hashAlgo, hashInput).then(setHash)}>
          ハッシュ生成
        </button>
      </div>
      {hash && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <code style={{ fontSize: 11, wordBreak: "break-all", flex: 1 }}>{hash}</code>
          <CopyButton text={hash} />
        </div>
      )}
    </div>
  );
}

const REFERENCE_TIMEZONES = [
  { label: "日本(JST)", zone: "Asia/Tokyo" },
  { label: "協定世界時(UTC)", zone: "UTC" },
  { label: "ニューヨーク", zone: "America/New_York" },
  { label: "ロンドン", zone: "Europe/London" },
  { label: "シドニー", zone: "Australia/Sydney" },
];

function TimestampTool() {
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

function RegexTool() {
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

function DiffTool() {
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

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().replace(/^#/, "").match(/^([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

function ColorTool() {
  const [hex, setHex] = useState("#22D3EE");
  const rgb = hexToRgb(hex);
  const hsl = rgb ? rgbToHsl(...rgb) : null;

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
        <input type="color" value={rgb ? hex : "#000000"} onChange={(e) => setHex(e.target.value)} style={{ width: 44, height: 34, padding: 2 }} />
        <input value={hex} onChange={(e) => setHex(e.target.value)} placeholder="#22D3EE" style={{ fontFamily: "var(--font-mono)", width: 140 }} />
        <div style={{ width: 60, height: 34, borderRadius: "var(--radius-s)", border: "1px solid var(--border)", background: rgb ? hex : "transparent" }} />
      </div>
      {!rgb ? (
        <span style={{ color: "var(--danger)", fontSize: 12 }}>#RGBまたは#RRGGBB形式で入力してください</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            ["HEX", hex.toUpperCase()],
            ["RGB", `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`],
            ["HSL", `hsl(${hsl![0]}, ${hsl![1]}%, ${hsl![2]}%)`],
          ].map(([label, value]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 40, fontSize: 11.5, color: "var(--text-faint)" }}>{label}</span>
              <code style={{ fontSize: 12, flex: 1 }}>{value}</code>
              <CopyButton text={value} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function base64UrlDecode(segment: string): string {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((segment.length + 3) % 4);
  return decodeURIComponent(escape(atob(padded)));
}

function JwtTool() {
  const [token, setToken] = useState("");
  const [header, setHeader] = useState("");
  const [payload, setPayload] = useState("");
  const [error, setError] = useState("");

  const decode = (value: string) => {
    setToken(value);
    const parts = value.trim().split(".");
    if (parts.length < 2) {
      setError(value ? "JWTの形式ではありません(header.payload.signature)" : "");
      setHeader("");
      setPayload("");
      return;
    }
    try {
      setHeader(JSON.stringify(JSON.parse(base64UrlDecode(parts[0])), null, 2));
      setPayload(JSON.stringify(JSON.parse(base64UrlDecode(parts[1])), null, 2));
      setError("");
    } catch (err) {
      setError(`デコードに失敗しました: ${String(err)}`);
      setHeader("");
      setPayload("");
    }
  };

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 10 }}>
        署名の検証は行いません(内容のデコードのみ)。入力は外部へ送信しません。
      </div>
      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>JWTトークン</label>
      <textarea style={{ ...textareaStyle, minHeight: 80 }} value={token} onChange={(e) => decode(e.target.value)} placeholder="eyJhbGciOi..." />
      {error && <div style={{ color: "var(--danger)", fontSize: 12, margin: "10px 0" }}>{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
        <div>
          <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>ヘッダー</label>
          <textarea style={{ ...textareaStyle, minHeight: 120 }} value={header} readOnly />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>ペイロード</label>
          <textarea style={{ ...textareaStyle, minHeight: 120 }} value={payload} readOnly />
        </div>
      </div>
    </div>
  );
}

const FAKE_FAMILY = ["佐藤", "鈴木", "高橋", "田中", "渡辺", "伊藤", "山本", "中村", "小林", "加藤"];
const FAKE_GIVEN = ["翔太", "陽菜", "大輝", "美咲", "健太", "花子", "拓也", "さくら", "蓮", "結衣"];
const FAKE_DOMAINS = ["example.com", "example.org", "example.net"];
const LOREM_WORDS =
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua".split(" ");

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeFakeRow(i: number) {
  const family = randomItem(FAKE_FAMILY);
  const given = randomItem(FAKE_GIVEN);
  const id = crypto.randomUUID();
  const email = `user${i + 1}@${randomItem(FAKE_DOMAINS)}`;
  const phone = `0${Math.floor(Math.random() * 9) + 1}0-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
  const d = new Date(Date.now() - Math.floor(Math.random() * 1000 * 60 * 60 * 24 * 3650));
  return { id, name: `${family} ${given}`, email, phone, createdAt: d.toISOString().slice(0, 10) };
}

function makeLorem(sentences: number): string {
  return Array.from({ length: sentences }, () => {
    const len = 6 + Math.floor(Math.random() * 8);
    const words = Array.from({ length: len }, () => randomItem(LOREM_WORDS));
    const s = words.join(" ");
    return s.charAt(0).toUpperCase() + s.slice(1) + ".";
  }).join(" ");
}

function FakeDataTool() {
  const [count, setCount] = useState(5);
  const [format, setFormat] = useState<"json" | "csv">("json");
  const [output, setOutput] = useState("");
  const [lorem, setLorem] = useState("");

  const generate = () => {
    const rows = Array.from({ length: Math.min(count, 200) }, (_, i) => makeFakeRow(i));
    if (format === "json") {
      setOutput(JSON.stringify(rows, null, 2));
    } else {
      const header = "id,name,email,phone,createdAt";
      const lines = rows.map((r) => [r.id, r.name, r.email, r.phone, r.createdAt].join(","));
      setOutput([header, ...lines].join("\n"));
    }
  };

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>ダミーデータ(氏名・メール・電話番号・UUID)</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <input type="number" min={1} max={200} value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ width: 70 }} />
        <div className="segmented">
          <button className={format === "json" ? "active" : ""} onClick={() => setFormat("json")}>
            JSON
          </button>
          <button className={format === "csv" ? "active" : ""} onClick={() => setFormat("csv")}>
            CSV
          </button>
        </div>
        <button className="btn" onClick={generate}>
          生成
        </button>
      </div>
      <textarea style={textareaStyle} value={output} readOnly />
      <div style={{ marginTop: 8, marginBottom: 18 }}>
        <CopyButton text={output} />
      </div>

      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>Lorem ipsum</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button className="btn" onClick={() => setLorem(makeLorem(3))}>
          3文
        </button>
        <button className="btn" onClick={() => setLorem(makeLorem(8))}>
          8文
        </button>
      </div>
      <textarea style={{ ...textareaStyle, minHeight: 100 }} value={lorem} readOnly />
      <div style={{ marginTop: 8 }}>
        <CopyButton text={lorem} />
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// 依存追加なしの最小限Markdown→HTML変換。見出し/太字/斜体/リンク/コードブロック/
// インラインコード/リスト/引用/水平線/段落のみ対応(フル仕様のCommonMarkではない)。
function markdownToHtml(src: string): string {
  const codeBlocks: string[] = [];
  let text = src.replace(/```([\s\S]*?)```/g, (_, code) => {
    codeBlocks.push(`<pre><code>${escapeHtml(code.trim())}</code></pre>`);
    return ` CODEBLOCK${codeBlocks.length - 1} `;
  });

  text = escapeHtml(text);
  const lines = text.split("\n");
  const htmlLines: string[] = [];
  let inList = false;
  let inQuote = false;

  const closeBlocks = () => {
    if (inList) {
      htmlLines.push("</ul>");
      inList = false;
    }
    if (inQuote) {
      htmlLines.push("</blockquote>");
      inQuote = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine;
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const listItem = line.match(/^[-*]\s+(.*)$/);
    const quoteLine = line.match(/^>\s?(.*)$/);

    if (heading) {
      closeBlocks();
      const level = heading[1].length;
      htmlLines.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      closeBlocks();
      htmlLines.push("<hr />");
    } else if (listItem) {
      if (inQuote) {
        htmlLines.push("</blockquote>");
        inQuote = false;
      }
      if (!inList) {
        htmlLines.push("<ul>");
        inList = true;
      }
      htmlLines.push(`<li>${inlineMarkdown(listItem[1])}</li>`);
    } else if (quoteLine) {
      if (inList) {
        htmlLines.push("</ul>");
        inList = false;
      }
      if (!inQuote) {
        htmlLines.push("<blockquote>");
        inQuote = true;
      }
      htmlLines.push(`${inlineMarkdown(quoteLine[1])}<br/>`);
    } else if (line.trim() === "") {
      closeBlocks();
    } else if (line.startsWith(" CODEBLOCK")) {
      closeBlocks();
      htmlLines.push(line);
    } else {
      closeBlocks();
      htmlLines.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }
  closeBlocks();

  let html = htmlLines.join("\n");
  html = html.replace(/ CODEBLOCK(\d+) /g, (_, i) => codeBlocks[Number(i)]);
  return html;
}

function inlineMarkdown(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function MarkdownTool() {
  const [src, setSrc] = useState("# タイトル\n\n**太字**や*斜体*、`コード`、[リンク](https://example.com)が使えます。\n\n- 項目1\n- 項目2\n");
  const html = markdownToHtml(src);

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 10 }}>
        簡易Markdownプレビュー(見出し/太字/斜体/リンク/リスト/引用/コードブロックに対応)
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <textarea style={{ ...textareaStyle, minHeight: 260 }} value={src} onChange={(e) => setSrc(e.target.value)} />
        <div
          className="panel-card"
          style={{ padding: 12, minHeight: 260, overflow: "auto", fontSize: 13, lineHeight: 1.6 }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}

function NumberBaseTool() {
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

function UrlTool() {
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
        <textarea style={{ ...textareaStyle, minHeight: 70 }} value={encodeInput} onChange={(e) => setEncodeInput(e.target.value)} />
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

function TextCountTool() {
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
      <textarea style={{ ...textareaStyle, minHeight: 200 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="テキストを入力…" />
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

const PASSWORD_CHARS = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{}",
};

function generatePassword(length: number, useLower: boolean, useUpper: boolean, useDigits: boolean, useSymbols: boolean): string {
  let pool = "";
  if (useLower) pool += PASSWORD_CHARS.lower;
  if (useUpper) pool += PASSWORD_CHARS.upper;
  if (useDigits) pool += PASSWORD_CHARS.digits;
  if (useSymbols) pool += PASSWORD_CHARS.symbols;
  if (!pool) return "";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => pool[b % pool.length]).join("");
}

function passwordStrength(length: number, poolSize: number): { label: string; color: string } {
  const entropyBits = length * Math.log2(Math.max(poolSize, 1));
  if (entropyBits < 40) return { label: "弱い", color: "var(--danger)" };
  if (entropyBits < 70) return { label: "普通", color: "var(--warning)" };
  if (entropyBits < 100) return { label: "強い", color: "var(--success)" };
  return { label: "非常に強い", color: "var(--accent)" };
}

function PasswordTool() {
  const [length, setLength] = useState(20);
  const [useLower, setUseLower] = useState(true);
  const [useUpper, setUseUpper] = useState(true);
  const [useDigits, setUseDigits] = useState(true);
  const [useSymbols, setUseSymbols] = useState(true);
  const [password, setPassword] = useState(() => generatePassword(20, true, true, true, true));

  const regenerate = () => setPassword(generatePassword(length, useLower, useUpper, useDigits, useSymbols));

  const poolSize =
    (useLower ? PASSWORD_CHARS.lower.length : 0) +
    (useUpper ? PASSWORD_CHARS.upper.length : 0) +
    (useDigits ? PASSWORD_CHARS.digits.length : 0) +
    (useSymbols ? PASSWORD_CHARS.symbols.length : 0);
  const strength = passwordStrength(length, poolSize);

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 10 }}>
        crypto.getRandomValuesによる暗号学的乱数でパスワードを生成します(すべてローカル処理)
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input readOnly value={password} style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 14 }} />
        <CopyButton text={password} />
        <button className="btn" onClick={regenerate}>
          再生成
        </button>
      </div>
      <div style={{ marginBottom: 14, fontSize: 12, color: strength.color, fontWeight: 600 }}>強度: {strength.label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 11.5, color: "var(--text-faint)", width: 60 }}>文字数</span>
        <input
          type="range"
          min={6}
          max={64}
          value={length}
          onChange={(e) => {
            const v = Number(e.target.value);
            setLength(v);
            setPassword(generatePassword(v, useLower, useUpper, useDigits, useSymbols));
          }}
          style={{ flex: 1 }}
        />
        <span style={{ fontSize: 12, width: 28, textAlign: "right" }}>{length}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
        {(
          [
            ["英小文字", useLower, setUseLower],
            ["英大文字", useUpper, setUseUpper],
            ["数字", useDigits, setUseDigits],
            ["記号", useSymbols, setUseSymbols],
          ] as [string, boolean, (v: boolean) => void][]
        ).map(([label, checked, setter]) => (
          <label key={label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => {
                setter(e.target.checked);
                setPassword(
                  generatePassword(
                    length,
                    label === "英小文字" ? e.target.checked : useLower,
                    label === "英大文字" ? e.target.checked : useUpper,
                    label === "数字" ? e.target.checked : useDigits,
                    label === "記号" ? e.target.checked : useSymbols
                  )
                );
              }}
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}

type UnitCategory = "temperature" | "length" | "weight" | "volume";

const UNIT_DEFS: Record<UnitCategory, { label: string; units: Record<string, number> }> = {
  temperature: { label: "温度", units: {} }, // 個別処理(線形変換ではないため下のtemperatureConvertで扱う)
  length: {
    label: "長さ",
    units: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mile: 1609.344, yard: 0.9144, ft: 0.3048, inch: 0.0254 },
  },
  weight: { label: "重量", units: { kg: 1, g: 0.001, mg: 0.000001, t: 1000, lb: 0.45359237, oz: 0.028349523125 } },
  volume: { label: "容量", units: { L: 1, mL: 0.001, "m3": 1000, gal: 3.785411784, qt: 0.946352946, cup: 0.2365882365 } },
};

const TEMPERATURE_UNITS = ["℃", "℉", "K"] as const;

function temperatureToCelsius(value: number, unit: string): number {
  if (unit === "℃") return value;
  if (unit === "℉") return ((value - 32) * 5) / 9;
  return value - 273.15; // K
}

function celsiusTo(value: number, unit: string): number {
  if (unit === "℃") return value;
  if (unit === "℉") return (value * 9) / 5 + 32;
  return value + 273.15; // K
}

function UnitTool() {
  const [category, setCategory] = useState<UnitCategory>("length");
  const [fromUnit, setFromUnit] = useState("m");
  const [toUnit, setToUnit] = useState("km");
  const [tempFrom, setTempFrom] = useState<(typeof TEMPERATURE_UNITS)[number]>("℃");
  const [tempTo, setTempTo] = useState<(typeof TEMPERATURE_UNITS)[number]>("℉");
  const [input, setInput] = useState("1");

  const n = parseFloat(input);
  const valid = !Number.isNaN(n);

  let result = "";
  if (valid) {
    if (category === "temperature") {
      result = celsiusTo(temperatureToCelsius(n, tempFrom), tempTo).toFixed(4).replace(/\.?0+$/, "");
    } else {
      const units = UNIT_DEFS[category].units;
      const base = n * units[fromUnit];
      result = (base / units[toUnit]).toPrecision(10).replace(/\.?0+$/, "").replace(/\.?0+e/, "e");
    }
  }

  const categoryUnits = category === "temperature" ? TEMPERATURE_UNITS : Object.keys(UNIT_DEFS[category].units);

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {(Object.keys(UNIT_DEFS) as UnitCategory[]).map((c) => (
          <button
            key={c}
            className="btn"
            style={c === category ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
            onClick={() => {
              setCategory(c);
              const units = c === "temperature" ? TEMPERATURE_UNITS : Object.keys(UNIT_DEFS[c].units);
              if (c === "temperature") {
                setTempFrom("℃");
                setTempTo("℉");
              } else {
                setFromUnit(units[0]);
                setToUnit(units[1] ?? units[0]);
              }
            }}
          >
            {UNIT_DEFS[c].label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} style={{ width: 120, fontFamily: "var(--font-mono)" }} />
        <select
          value={category === "temperature" ? tempFrom : fromUnit}
          onChange={(e) => (category === "temperature" ? setTempFrom(e.target.value as (typeof TEMPERATURE_UNITS)[number]) : setFromUnit(e.target.value))}
        >
          {categoryUnits.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <span style={{ color: "var(--text-faint)" }}>=</span>
        <input readOnly value={valid ? result : "無効な値です"} style={{ width: 160, fontFamily: "var(--font-mono)" }} />
        <select
          value={category === "temperature" ? tempTo : toUnit}
          onChange={(e) => (category === "temperature" ? setTempTo(e.target.value as (typeof TEMPERATURE_UNITS)[number]) : setToUnit(e.target.value))}
        >
          {categoryUnits.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        {valid && <CopyButton text={result} />}
      </div>
    </div>
  );
}

type PortTestResult = {
  host: string;
  port: number;
  reachable: boolean;
  latencyMs: number | null;
  remoteAddress: string | null;
  error: string | null;
};

function PortTestTool() {
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("443");
  const [timeoutMs, setTimeoutMs] = useState("2000");
  const [result, setResult] = useState<PortTestResult | null>(null);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);

  const run = async () => {
    const numericPort = Number(port);
    const numericTimeout = Number(timeoutMs);
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
      setError("ポート番号は1〜65535で入力してください");
      return;
    }
    setTesting(true);
    setResult(null);
    setError("");
    try {
      setResult(await invoke<PortTestResult>("tcp_port_test", { host, port: numericPort, timeoutMs: numericTimeout }));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) 120px 140px auto", gap: 8, alignItems: "end" }}>
        <label style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
          ホスト名またはIPアドレス
          <input value={host} onChange={(event) => setHost(event.target.value)} onKeyDown={(event) => event.key === "Enter" && run()} placeholder="example.com" style={{ width: "100%", marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
          ポート
          <input type="number" min={1} max={65535} value={port} onChange={(event) => setPort(event.target.value)} style={{ width: "100%", marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
          タイムアウト
          <select value={timeoutMs} onChange={(event) => setTimeoutMs(event.target.value)} style={{ width: "100%", marginTop: 4 }}>
            <option value="500">500ms</option>
            <option value="1000">1秒</option>
            <option value="2000">2秒</option>
            <option value="5000">5秒</option>
            <option value="10000">10秒</option>
          </select>
        </label>
        <button className="btn primary" onClick={run} disabled={testing || !host.trim()}>{testing ? "確認中…" : "疎通確認"}</button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {[80, 443, 3000, 5432, 6379, 8080].map((commonPort) => (
          <button key={commonPort} className="btn" onClick={() => setPort(String(commonPort))}>{commonPort}</button>
        ))}
      </div>
      {error && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 14 }}>{error}</div>}
      {result && (
        <div className="panel-card" style={{ padding: 14, marginTop: 14, borderColor: result.reachable ? "var(--success)" : "var(--danger)" }}>
          <div style={{ color: result.reachable ? "var(--success)" : "var(--danger)", fontWeight: 700 }}>
            {result.reachable ? "接続成功" : "接続できません"}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7 }}>
            対象: {result.host}:{result.port}<br />
            接続先: {result.remoteAddress ?? "-"}<br />
            応答時間: {result.latencyMs === null ? "-" : `${result.latencyMs}ms`}
            {result.error && <><br />詳細: {result.error}</>}
          </div>
        </div>
      )}
    </div>
  );
}

type QrErrorCorrectionLevel = "L" | "M" | "Q" | "H";

function QrCodeTool() {
  const [input, setInput] = useState("");
  const [size, setSize] = useState(512);
  const [errorCorrectionLevel, setErrorCorrectionLevel] = useState<QrErrorCorrectionLevel>("M");
  const [dataUrl, setDataUrl] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const generate = async () => {
    if (!input) {
      setDataUrl("");
      setError("QRコードにするテキストまたはURLを入力してください");
      return;
    }
    try {
      const generated = await QRCode.toDataURL(input, {
        errorCorrectionLevel,
        width: size,
        margin: 4,
        color: { dark: "#000000ff", light: "#ffffffff" },
      });
      setDataUrl(generated);
      setError("");
    } catch (cause) {
      setDataUrl("");
      setError(`QRコードを生成できませんでした: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  const download = async () => {
    if (!dataUrl || saving) return;
    const destination = await save({
      defaultPath: "qrcode.png",
      filters: [{ name: "PNG画像", extensions: ["png"] }],
    });
    if (!destination) return;

    setSaving(true);
    setError("");
    try {
      const bytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
      await writeFile(destination, bytes);
    } catch (cause) {
      setError(`PNGの保存に失敗しました: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>テキストまたはURL</label>
      <textarea
        style={{ ...textareaStyle, minHeight: 110 }}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        placeholder="https://example.com"
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "10px 0 14px" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          誤り訂正
          <select value={errorCorrectionLevel} onChange={(event) => setErrorCorrectionLevel(event.target.value as QrErrorCorrectionLevel)}>
            <option value="L">L（約7%）</option>
            <option value="M">M（約15%）</option>
            <option value="Q">Q（約25%）</option>
            <option value="H">H（約30%）</option>
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          PNGサイズ
          <select value={size} onChange={(event) => setSize(Number(event.target.value))}>
            {[256, 512, 1024].map((value) => <option key={value} value={value}>{value}×{value}px</option>)}
          </select>
        </label>
        <button className="btn primary" onClick={generate} disabled={!input}>
          QRコードを生成
        </button>
      </div>
      {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <div
        style={{
          minHeight: 300,
          display: "grid",
          placeItems: "center",
          padding: 18,
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-s)",
          background: "#fff",
        }}
      >
        {dataUrl ? (
          <img src={dataUrl} alt="生成したQRコード" style={{ width: "min(100%, 320px)", imageRendering: "pixelated" }} />
        ) : (
          <span style={{ color: "#707070", fontSize: 12 }}>生成したQRコードがここに表示されます</span>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        <button className="btn" onClick={download} disabled={!dataUrl || saving}>
          {saving ? "保存中…" : "PNGを保存"}
        </button>
        <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>入力内容は外部へ送信されません</span>
      </div>
    </div>
  );
}

function BackgroundRemovalTool() {
  const [file, setFile] = useState<File | null>(null);
  const [inputUrl, setInputUrl] = useState("");
  const [outputUrl, setOutputUrl] = useState("");
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("画像を選択してください");
  const [error, setError] = useState("");

  useEffect(() => () => {
    if (inputUrl) URL.revokeObjectURL(inputUrl);
  }, [inputUrl]);

  useEffect(() => () => {
    if (outputUrl) URL.revokeObjectURL(outputUrl);
  }, [outputUrl]);

  const selectFile = (nextFile: File | undefined) => {
    if (!nextFile) return;
    if (!nextFile.type.startsWith("image/")) {
      setError("画像ファイルを選択してください");
      return;
    }

    if (inputUrl) URL.revokeObjectURL(inputUrl);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setFile(nextFile);
    setInputUrl(URL.createObjectURL(nextFile));
    setOutputUrl("");
    setOutputBlob(null);
    setProgress(0);
    setStatus("処理を開始できます");
    setError("");
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    selectFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    selectFile(event.dataTransfer.files[0]);
  };

  const removeImageBackground = async () => {
    if (!file || processing) return;
    setProcessing(true);
    setProgress(0);
    setError("");
    setStatus("AIモデルを準備しています…");

    try {
      // 重いONNXランタイムを、機能が実行されるまでメインバンドルへ読み込まない。
      const { removeBackground } = await import("@imgly/background-removal");
      const result = await removeBackground(file, {
        model: "isnet_quint8",
        device: "cpu",
        output: { format: "image/png", quality: 1, type: "foreground" },
        progress: (_key, current, total) => {
          if (total > 0) setProgress(Math.min(100, Math.round((current / total) * 100)));
          setStatus("AIモデルをダウンロードしています…");
        },
      });

      if (outputUrl) URL.revokeObjectURL(outputUrl);
      setOutputBlob(result);
      setOutputUrl(URL.createObjectURL(result));
      setProgress(100);
      setStatus("背景透過が完了しました");
    } catch (cause) {
      setError(`背景透過に失敗しました: ${cause instanceof Error ? cause.message : String(cause)}`);
      setStatus("処理に失敗しました");
    } finally {
      setProcessing(false);
    }
  };

  const download = async () => {
    if (!outputBlob || !file || saving) return;
    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    const destination = await save({
      defaultPath: `${baseName}-transparent.png`,
      filters: [{ name: "PNG画像", extensions: ["png"] }],
    });
    if (!destination) return;

    setSaving(true);
    setError("");
    setStatus("PNGを保存しています…");
    try {
      await writeFile(destination, new Uint8Array(await outputBlob.arrayBuffer()));
      setStatus(`PNGを保存しました: ${destination}`);
    } catch (cause) {
      setError(`PNGの保存に失敗しました: ${cause instanceof Error ? cause.message : String(cause)}`);
      setStatus("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel-card background-removal-tool">
      <div>
        <h2>画像背景透過</h2>
        <p className="background-removal-note">
          画像は端末内で処理され、外部へ送信されません。初回のみAIモデル（約40MB）をIMG.LYからダウンロードします。
        </p>
      </div>

      <label className="background-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
        <input type="file" accept="image/*" onChange={onFileChange} disabled={processing} />
        <span>{file ? file.name : "画像を選択、またはここへドロップ"}</span>
        <small>PNG、JPEG、WebPなど</small>
      </label>

      {(inputUrl || outputUrl) && (
        <div className="background-preview-grid">
          <figure>
            <figcaption>元画像</figcaption>
            {inputUrl && <img src={inputUrl} alt="背景透過前" />}
          </figure>
          <figure className="transparent-preview">
            <figcaption>透過結果</figcaption>
            {outputUrl ? <img src={outputUrl} alt="背景透過後" /> : <div className="background-preview-empty">処理後の画像が表示されます</div>}
          </figure>
        </div>
      )}

      <div className="background-removal-actions">
        <button className="btn primary" onClick={removeImageBackground} disabled={!file || processing}>
          {processing ? "処理中…" : "背景を透過する"}
        </button>
        <button className="btn" onClick={download} disabled={!outputBlob || processing || saving}>
          {saving ? "保存中…" : "PNGを保存"}
        </button>
        <span>{status}</span>
      </div>

      {processing && <progress className="background-removal-progress" max={100} value={progress} />}
      {error && <div className="background-removal-error">{error}</div>}
    </div>
  );
}

export default function DevToolsPage() {
  const [tab, setTab] = useState<ToolTab>("json");

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>開発者ツールボックス</h1>
          <p>すべてローカルで処理し、入力内容を外部へ送信しません</p>
        </div>
      </div>
      <div className="settings-layout">
        <div className="settings-nav">
          <button className={tab === "json" ? "active" : ""} onClick={() => setTab("json")}>
            JSON整形
          </button>
          <button className={tab === "yaml" ? "active" : ""} onClick={() => setTab("yaml")}>
            YAML変換
          </button>
          <button className={tab === "xml" ? "active" : ""} onClick={() => setTab("xml")}>
            XML整形
          </button>
          <button className={tab === "text" ? "active" : ""} onClick={() => setTab("text")}>
            テキスト変換
          </button>
          <button className={tab === "uuid" ? "active" : ""} onClick={() => setTab("uuid")}>
            UUID/ハッシュ
          </button>
          <button className={tab === "timestamp" ? "active" : ""} onClick={() => setTab("timestamp")}>
            タイムスタンプ
          </button>
          <button className={tab === "regex" ? "active" : ""} onClick={() => setTab("regex")}>
            正規表現テスト
          </button>
          <button className={tab === "diff" ? "active" : ""} onClick={() => setTab("diff")}>
            差分表示
          </button>
          <button className={tab === "color" ? "active" : ""} onClick={() => setTab("color")}>
            カラー変換
          </button>
          <button className={tab === "jwt" ? "active" : ""} onClick={() => setTab("jwt")}>
            JWTデコーダー
          </button>
          <button className={tab === "fake" ? "active" : ""} onClick={() => setTab("fake")}>
            ダミーデータ生成
          </button>
          <button className={tab === "markdown" ? "active" : ""} onClick={() => setTab("markdown")}>
            Markdownプレビュー
          </button>
          <button className={tab === "number" ? "active" : ""} onClick={() => setTab("number")}>
            進数変換
          </button>
          <button className={tab === "url" ? "active" : ""} onClick={() => setTab("url")}>
            URL解析
          </button>
          <button className={tab === "count" ? "active" : ""} onClick={() => setTab("count")}>
            文字数カウント
          </button>
          <button className={tab === "password" ? "active" : ""} onClick={() => setTab("password")}>
            パスワード生成
          </button>
          <button className={tab === "unit" ? "active" : ""} onClick={() => setTab("unit")}>
            単位変換
          </button>
          <button className={tab === "port" ? "active" : ""} onClick={() => setTab("port")}>
            ポート疎通
          </button>
          <button className={tab === "qr" ? "active" : ""} onClick={() => setTab("qr")}>
            QRコード生成
          </button>
          <button className={tab === "background" ? "active" : ""} onClick={() => setTab("background")}>
            画像背景透過
          </button>
        </div>
        {tab === "json" && <JsonTool />}
        {tab === "yaml" && <YamlTool />}
        {tab === "xml" && <XmlTool />}
        {tab === "text" && <TextTool />}
        {tab === "uuid" && <UuidTool />}
        {tab === "timestamp" && <TimestampTool />}
        {tab === "regex" && <RegexTool />}
        {tab === "diff" && <DiffTool />}
        {tab === "color" && <ColorTool />}
        {tab === "jwt" && <JwtTool />}
        {tab === "fake" && <FakeDataTool />}
        {tab === "markdown" && <MarkdownTool />}
        {tab === "number" && <NumberBaseTool />}
        {tab === "url" && <UrlTool />}
        {tab === "count" && <TextCountTool />}
        {tab === "password" && <PasswordTool />}
        {tab === "unit" && <UnitTool />}
        {tab === "port" && <PortTestTool />}
        {tab === "qr" && <QrCodeTool />}
        {tab === "background" && <BackgroundRemovalTool />}
      </div>
    </div>
  );
}
