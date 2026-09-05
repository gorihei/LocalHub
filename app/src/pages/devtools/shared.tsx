import { useMemo, useState, type CSSProperties } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { Prec, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const textareaStyle: CSSProperties = {
  width: "100%",
  minHeight: 160,
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  resize: "vertical",
};

type EditorLanguage = "text" | "json" | "yaml" | "xml" | "markdown";

type CodeEditorProps = {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  language?: EditorLanguage;
  extensions?: Extension[];
  minHeight?: number;
  placeholder?: string;
};

// CodeMirror標準のTabは行インデントとして働き、行頭へ空白を追加する。
// ツールの入力欄では通常のテキスト編集と同様、現在の選択範囲または
// カーソル位置へタブ文字を挿入する。
const insertTabAtCursor = Prec.highest(
  keymap.of([
    {
      key: "Tab",
      run: (view) => {
        view.dispatch(view.state.replaceSelection("\t"));
        return true;
      },
    },
  ])
);

export function CodeEditor({
  value,
  onChange,
  readOnly = false,
  language = "text",
  extensions,
  minHeight = 160,
  placeholder,
}: CodeEditorProps) {
  const languageExtensions = useMemo<Extension[]>(() => {
    if (extensions) return extensions;
    switch (language) {
      case "json": return [json()];
      case "yaml": return [yaml()];
      case "xml": return [xml()];
      case "markdown": return [markdown()];
      default: return [];
    }
  }, [extensions, language]);

  return (
    <CodeMirror
      className="code-editor"
      value={value}
      height={`${minHeight}px`}
      theme="dark"
      extensions={[insertTabAtCursor, ...languageExtensions]}
      editable={!readOnly}
      readOnly={readOnly}
      onChange={onChange}
      placeholder={placeholder}
      basicSetup={{
        highlightActiveLine: !readOnly,
        highlightActiveLineGutter: !readOnly,
        foldGutter: language !== "text",
      }}
    />
  );
}

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
