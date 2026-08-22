# Local Hub

Local Hub は、日常的に使うツールや情報をひとつの画面にまとめる Windows 向けデスクトップアプリです。ダッシュボード、アプリランチャー、統合ターミナル、プロセス監視、自動化、プラグインを、ローカルファーストで提供します。

> [!NOTE]
> 現在は開発中です。Windows 固有機能とローカル環境に依存する箇所があるため、セットアップ前に下記の開発環境と既知の注意事項を確認してください。

## 主な機能

- ウィジェットを移動・リサイズできるダッシュボード
- アプリランチャー、起動セット、最近使ったショートカット
- ConPTY を利用したタブ式 PowerShell ターミナル
- 横断検索とコマンドパレット
- プロセス・ポート監視
- 端末内AI処理による画像の背景透過とPNG保存
- トリガー、条件、アクションを組み合わせる自動化
- サイドカープロセスとして分離されたプラグイン
- SQLite によるローカルデータ保存
- Windows 資格情報マネージャーによるシークレット保存
- トレイ常駐、グローバルショートカット、OS 通知

## 技術スタック

- Tauri 2.x
- Rust
- React 19 / TypeScript
- Vite
- SQLite (`rusqlite`)
- WebView2 / ConPTY

## ディレクトリ構成

```text
app/
  src/                 React / TypeScript フロントエンド
  src-tauri/           Rust バックエンドと Tauri 設定
  plugins/             Rust 製サイドカープラグイン
docs/
  adr/                 Architecture Decision Records
  ARCHITECTURE.md       現在の実装構成
```

## 開発環境

対象環境は Windows です。開発には次のツールが必要です。

- Node.js 26.7.0 以上と npm 12.0.2 以上（Volta設定を `app/package.json` に同梱）
- Rust stable と Cargo
- Tauri 2 の Windows 向け前提ツール
- Microsoft Edge WebView2 Runtime
- MSVC C++ Build Tools

この開発環境では、GUI の起動に Git Bash ではなく PowerShell を使用します。詳細は [Phase 0 技術検証](docs/adr/0002-phase0-technical-validation.md)を参照してください。

依存関係のインストールと開発起動:

```powershell
Set-Location app
npm install
npm run tauri dev
```

Rust バックエンドだけを確認する場合:

```powershell
Set-Location app
cargo check --manifest-path src-tauri/Cargo.toml
```

各プラグインは独立した Cargo パッケージです。

```powershell
Set-Location app
cargo check --manifest-path plugins/todo-plugin/Cargo.toml
```

## ドキュメント

- [現状アーキテクチャ](docs/ARCHITECTURE.md)
- [技術スタックの選定](docs/adr/0001-tech-stack.md)
- [Phase 0 技術検証](docs/adr/0002-phase0-technical-validation.md)
- [プラグイン WebView アーキテクチャ](docs/adr/0003-plugin-webview-architecture.md)
- [プラグイン設定とシークレット](docs/adr/0004-plugin-settings-and-secrets.md)

## ライセンス

Local Hubの独自コードは[MIT License](LICENSE)です。画像背景透過機能が利用する
`@imgly/background-removal` はAGPL-3.0で提供されています。配布前に
[サードパーティライセンス](THIRD_PARTY_NOTICES.md)を確認してください。
