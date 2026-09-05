import { useState, type CSSProperties } from "react";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const textareaStyle: CSSProperties = {
  width: "100%",
  minHeight: 160,
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  resize: "vertical",
};

export function CopyButton({ text }: { text: string }) {
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

