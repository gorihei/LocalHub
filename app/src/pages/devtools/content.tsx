import { useState } from "react";
import { CopyButton, textareaStyle } from "./shared";

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

export function FakeDataTool() {
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

export function MarkdownTool() {
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


