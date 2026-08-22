# AGENTS.md

このファイルは、Local Hub リポジトリで作業するコーディングエージェント向けの共通ガイドです。

## プロジェクト概要

Local Hub は Windows 向けのローカルファーストなデスクトップツールです。フロントエンドは React 19 / TypeScript、バックエンドは Tauri 2 / Rust です。プラグインは Rust 製サイドカーとしてコアプロセスから分離します。

設計を変更する前に `docs/ARCHITECTURE.md` と関連する `docs/adr/` を読んでください。実装と文書が食い違う場合は、推測で大規模な変更をせず、差異を明示してください。

## 重要なパス

- `app/src/`: React フロントエンド
- `app/src-tauri/src/`: Tauri / Rust バックエンド
- `app/plugins/`: 独立した Rust プラグイン
- `docs/ARCHITECTURE.md`: 実装のスナップショット
- `docs/adr/`: 設計判断と背景

## 作業ルール

- Windows 固有の動作を維持し、パス、プロセス、ConPTY、資格情報マネージャーの扱いに注意する。
- GUI の開発起動には PowerShell を使う。Git Bash / MSYS2 経由では GUI プロセスが終了する既知の問題がある。
- Rust は明快さを優先する。IPC、プロセス管理、Windows API、`unsafe`、Tauri コマンドの入出力契約には、判断理由が分かるコメントを残す。
- フロントエンドから特権操作を直接実行せず、既存の Tauri コマンド、コマンドバス、権限ブローカーを通す。
- シークレットを SQLite、設定ファイル、ログ、ソースコードへ保存しない。Windows 資格情報マネージャーを使う既存設計を守る。
- プラグイン障害がコアへ波及しないよう、サイドカー境界と JSON-RPC 契約を維持する。
- 依存関係やアーキテクチャを変える場合は、関連 ADR を追加または更新する。
- 無関係な変更を混ぜず、既存のユーザー変更を上書きしない。

## 検証

変更箇所に最も近い検証を行い、実行できなかった検証は理由とともに報告してください。

```powershell
# Rust バックエンド
Set-Location app
cargo check --manifest-path src-tauri/Cargo.toml

# 個別プラグイン（例）
cargo check --manifest-path plugins/todo-plugin/Cargo.toml

# フロントエンドと Tauri アプリ
npm run build
npm run tauri dev
```

## 完了条件

- 対象変更がビルドまたは適切な静的検査を通る。
- セキュリティ境界、データ永続化、プラグイン分離を壊していない。
- 大きな構成変更が `docs/ARCHITECTURE.md` と ADR に反映されている。
- 未検証事項や既知の制約が引き継ぎ時に明記されている。
