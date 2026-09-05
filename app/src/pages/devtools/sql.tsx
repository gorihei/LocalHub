import { useMemo, useState } from "react";
import {
  MariaSQL,
  MSSQL,
  MySQL,
  PLSQL,
  PostgreSQL,
  SQLite,
  StandardSQL,
  sql,
  type SQLDialect,
} from "@codemirror/lang-sql";
import type { KeywordCase, SqlLanguage } from "sql-formatter";
import { CodeEditor, CopyButton } from "./shared";

const DIALECTS: { value: SqlLanguage; label: string }[] = [
  { value: "sql", label: "標準SQL" },
  { value: "mysql", label: "MySQL" },
  { value: "mariadb", label: "MariaDB" },
  { value: "postgresql", label: "PostgreSQL" },
  { value: "sqlite", label: "SQLite" },
  { value: "transactsql", label: "SQL Server" },
  { value: "plsql", label: "Oracle PL/SQL" },
  { value: "bigquery", label: "BigQuery" },
  { value: "snowflake", label: "Snowflake" },
];

const EDITOR_DIALECTS: Partial<Record<SqlLanguage, SQLDialect>> = {
  sql: StandardSQL,
  mysql: MySQL,
  mariadb: MariaSQL,
  postgresql: PostgreSQL,
  sqlite: SQLite,
  transactsql: MSSQL,
  tsql: MSSQL,
  plsql: PLSQL,
  // CodeMirrorに専用定義がない方言は、共通構文を装飾できる標準SQLを使う。
  bigquery: StandardSQL,
  snowflake: StandardSQL,
};

export function SqlTool() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [dialect, setDialect] = useState<SqlLanguage>("sql");
  const [keywordCase, setKeywordCase] = useState<KeywordCase>("upper");
  const [tabWidth, setTabWidth] = useState(2);
  const [error, setError] = useState("");
  const languageExtension = useMemo(
    () => sql({ dialect: EDITOR_DIALECTS[dialect] ?? StandardSQL, upperCaseKeywords: keywordCase === "upper" }),
    [dialect, keywordCase]
  );

  const run = async () => {
    try {
      // パーサーを含む比較的大きな依存関係なので、SQL整形を実行した時点で読み込む。
      const { format } = await import("sql-formatter");
      setOutput(format(input, { language: dialect, keywordCase, tabWidth }));
      setError("");
    } catch (err) {
      setOutput("");
      setError(`SQLを整形できませんでした: ${String(err)}`);
    }
  };

  return (
    <div className="panel-card" style={{ padding: 14 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
          方言
          <select className="btn" value={dialect} onChange={(event) => setDialect(event.target.value as SqlLanguage)}>
            {DIALECTS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
          キーワード
          <select className="btn" value={keywordCase} onChange={(event) => setKeywordCase(event.target.value as KeywordCase)}>
            <option value="upper">大文字</option>
            <option value="lower">小文字</option>
            <option value="preserve">維持</option>
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
          インデント
          <select className="btn" value={tabWidth} onChange={(event) => setTabWidth(Number(event.target.value))}>
            <option value={2}>2スペース</option>
            <option value={4}>4スペース</option>
          </select>
        </label>
      </div>
      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>入力</label>
      <CodeEditor
        value={input}
        extensions={[languageExtension]}
        minHeight={180}
        onChange={setInput}
        placeholder="select id, name from users where active = true order by name;"
      />
      <div style={{ margin: "10px 0" }}>
        <button className="btn" onClick={run}>整形</button>
      </div>
      {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 10, whiteSpace: "pre-wrap" }}>{error}</div>}
      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>結果</label>
      <CodeEditor
        value={output}
        extensions={[languageExtension]}
        minHeight={180}
        readOnly
      />
      <div style={{ marginTop: 8 }}>
        <CopyButton text={output} />
      </div>
    </div>
  );
}
