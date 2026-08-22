// 付録B ダッシュボードウィジェット「クリップボード履歴」(§4.2 v1候補)。
// クリップボード自体には履歴機能がないため、短い間隔でポーリングして
// 変化を検知し、履歴をSQLite(app_settingsのJSON配列)へ積み上げる方式。
// クリップボードの中身はローカルにしか保存せず、外部送信は一切しない。
//
// 画像(スクリーンショット等)にも対応する。readText()はクリップボードに
// 画像しかない場合(CF_TEXTが無い場合)は失敗するため、そのタイミングで
// readImage()を試す。コピー戻し時に元の解像度を保てるよう、保存はダウン
// スケールせず元サイズのPNG dataURLのまま行う(一覧表示はCSS側で32pxに
// 縮小表示するだけ)。そのぶんSQLiteの保存容量は増える。
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readText, writeText, readImage, writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { Image as TauriImage } from "@tauri-apps/api/image";

type TextEntry = { kind: "text"; text: string; at: number };
type ImageEntry = { kind: "image"; dataUrl: string; width: number; height: number; at: number };
type Entry = TextEntry | ImageEntry;

const SETTINGS_KEY = "clipboardHistory";
const POLL_INTERVAL_MS = 1500;
// 画像チェック(readImage→rgba→canvas decode)はテキストチェックよりずっと重く、
// クリップボードが画像を保持している間は毎回フル解像度のデコードが走って
// アプリ全体がカクつく原因になっていた。画像側だけ間引いて実行する。
const IMAGE_CHECK_EVERY_N_POLLS = 4;
const MAX_ENTRIES = 20;
const MAX_TEXT_LENGTH = 2000;

function quickChecksum(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 97) sum = (sum + bytes[i] * (i + 1)) % 1_000_000_007;
  return sum;
}

function rgbaToPngDataUrl(rgba: Uint8Array, width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return canvas.toDataURL("image/png");
}

/** dataURLを再度rgbaへデコードする(コピー戻し用)。 */
function dataUrlToRgba(dataUrl: string): Promise<{ rgba: Uint8Array; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height).data;
      resolve({ rgba: new Uint8Array(data.buffer), width: img.width, height: img.height });
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

export default function ClipboardWidget() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const entriesRef = useRef<Entry[]>([]);
  entriesRef.current = entries;
  const lastSeenTextRef = useRef<string>("");
  const lastImageChecksumRef = useRef<number | null>(null);

  useEffect(() => {
    invoke<Record<string, string>>("settings_get_all").then((s) => {
      try {
        const parsed: Entry[] = s[SETTINGS_KEY] ? JSON.parse(s[SETTINGS_KEY]) : [];
        setEntries(parsed);
        const first = parsed[0];
        if (first?.kind === "text") lastSeenTextRef.current = first.text;
      } catch {
        // 壊れた保存内容は無視して空履歴から始める
      }
    });
  }, []);

  const persist = (next: Entry[]) => {
    setEntries(next);
    invoke("settings_set", { key: SETTINGS_KEY, value: JSON.stringify(next) }).catch(() => {});
  };

  const pollCountRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      // readText()は「テキストが無い(画像のみ等)」場合に例外を投げる実装と
      // 空文字を返す実装の両方があり得るため、どちらのケースでも画像側の
      // チェックへ進めるようにgotTextで明示的に分岐する。
      let gotText = false;
      try {
        const text = await readText();
        if (!cancelled && text) {
          gotText = true;
          if (text !== lastSeenTextRef.current) {
            lastSeenTextRef.current = text;
            const trimmed = text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) + "…" : text;
            const newEntry: TextEntry = { kind: "text", text: trimmed, at: Date.now() };
            const next: Entry[] = [
              newEntry,
              ...entriesRef.current.filter((e) => !(e.kind === "text" && e.text === trimmed)),
            ].slice(0, MAX_ENTRIES);
            persist(next);
          }
        }
      } catch {
        // CF_TEXTが無い(画像のみ等)場合はここに来る。画像を試す。
      }
      if (gotText || cancelled) return;
      pollCountRef.current += 1;
      if (pollCountRef.current % IMAGE_CHECK_EVERY_N_POLLS !== 0) return;
      try {
        const img: TauriImage = await readImage();
        const [rgba, size] = await Promise.all([img.rgba(), img.size()]);
        if (cancelled) return;
        const checksum = quickChecksum(rgba);
        if (checksum === lastImageChecksumRef.current) return;
        lastImageChecksumRef.current = checksum;
        const dataUrl = rgbaToPngDataUrl(rgba, size.width, size.height);
        const newEntry: ImageEntry = { kind: "image", dataUrl, width: size.width, height: size.height, at: Date.now() };
        const next: Entry[] = [newEntry, ...entriesRef.current].slice(0, MAX_ENTRIES);
        persist(next);
      } catch {
        // 画像も読めない(対応外の形式等)場合は何もしない
      }
    };
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const copyEntry = async (entry: Entry) => {
    if (entry.kind === "text") {
      await writeText(entry.text);
      lastSeenTextRef.current = entry.text;
    } else {
      const { rgba, width, height } = await dataUrlToRgba(entry.dataUrl);
      const built = await TauriImage.new(rgba, width, height);
      await writeImage(built);
      lastImageChecksumRef.current = quickChecksum(rgba);
    }
    setCopiedAt(entry.at);
    setTimeout(() => setCopiedAt(null), 1200);
  };

  const clearHistory = () => persist([]);

  if (entries.length === 0) {
    return <span style={{ color: "var(--text-faint)" }}>コピーした内容(テキスト・画像)がここに表示されます</span>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, height: "100%" }}>
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
        {entries.map((entry) => (
          <button
            key={entry.at}
            onClick={() => copyEntry(entry)}
            title="クリックでコピー"
            style={{
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "var(--surface-raised)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-s)",
              padding: entry.kind === "image" ? 5 : "5px 8px",
              color: copiedAt === entry.at ? "var(--accent-strong)" : "var(--text-muted)",
              fontSize: 11.5,
              cursor: "pointer",
              overflow: "hidden",
            }}
          >
            {entry.kind === "image" ? (
              <>
                <img src={entry.dataUrl} alt="" style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {copiedAt === entry.at ? "コピーしました" : `画像 (${entry.width}×${entry.height})`}
                </span>
              </>
            ) : (
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {copiedAt === entry.at ? "コピーしました" : entry.text}
              </span>
            )}
          </button>
        ))}
      </div>
      <button className="btn" style={{ alignSelf: "flex-end", fontSize: 10.5, height: 22, padding: "0 8px" }} onClick={clearHistory}>
        履歴をクリア
      </button>
    </div>
  );
}
