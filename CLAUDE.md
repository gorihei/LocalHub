# CLAUDE.md

@AGENTS.md

Claude Code は、上記の共通ルールに加えて次を守ってください。

- コマンドは Windows PowerShell 向けに記述・実行する。
- 作業開始時に `git status --short --branch` を確認し、ユーザーの未コミット変更を保持する。
- 変更前に関連する実装、`docs/ARCHITECTURE.md`、`docs/adr/` を読む。
- ビルドやテストを実行した場合は、成功・失敗と対象範囲を最終報告へ含める。
- Cargo コマンドは、プロジェクト内のパスを一貫させるため `app` ディレクトリから実行する。
- GUI を起動する必要がある場合は PowerShell を使い、長時間動くプロセスを放置しない。
