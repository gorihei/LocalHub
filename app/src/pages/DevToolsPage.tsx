// §6.11 開発者ツールボックス。各ツールは機能カテゴリ別モジュールに分割し、
// このページはナビゲーションと選択状態だけを担当する。
import { useState } from "react";
import { JsonTool, YamlTool, XmlTool, TextTool } from "./devtools/format";
import { UuidTool } from "./devtools/identity";
import { TimestampTool, RegexTool, DiffTool } from "./devtools/analysis";
import { ColorTool, JwtTool } from "./devtools/security";
import { FakeDataTool, MarkdownTool } from "./devtools/content";
import { NumberBaseTool, UrlTool, TextCountTool } from "./devtools/text";
import { PasswordTool, UnitTool } from "./devtools/conversion";
import { PortTestTool, QrCodeTool, BackgroundRemovalTool } from "./devtools/system";
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

export default function DevToolsPage() {
  const [tab, setTab] = useState<ToolTab>("json");

  return (
    <div className="page devtools-page">
      <div className="page-head">
        <div>
          <h1>開発者ツールボックス</h1>
          <p>すべてローカルで処理し、入力内容を外部へ送信しません</p>
        </div>
      </div>
      <div className="settings-layout devtools-layout">
        <div className="settings-nav devtools-nav">
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
        <div className="devtools-content">
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
    </div>
  );
}
