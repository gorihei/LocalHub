import { useState } from "react";
import { CodeEditor, CopyButton } from "./shared";

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

export function ColorTool() {
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

export function JwtTool() {
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
      <CodeEditor value={token} onChange={decode} minHeight={80} placeholder="eyJhbGciOi..." />
      {error && <div style={{ color: "var(--danger)", fontSize: 12, margin: "10px 0" }}>{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
        <div>
          <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>ヘッダー</label>
          <CodeEditor language="json" value={header} minHeight={120} readOnly />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>ペイロード</label>
          <CodeEditor language="json" value={payload} minHeight={120} readOnly />
        </div>
      </div>
    </div>
  );
}

