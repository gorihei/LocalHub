import { useState } from "react";
import { CopyButton } from "./shared";

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

export function UuidTool() {
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


