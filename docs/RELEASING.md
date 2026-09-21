# Windows版リリース手順

Local HubのWindowsインストーラーは、GitHub ActionsでビルドしGitHub Releasesから配布する。

## 生成物

- NSISインストーラー（`.exe`）
- Windows Installer（`.msi`）

ワークフローは`v*`タグのpushで起動し、タグに対応する公開Releaseを作成して両方の
インストーラーを添付する。ハイフンを含むバージョンタグ（例: `v0.2.0-beta.1`）は
プレリリースとして公開する。

## リリース前の更新

次のコマンドでアプリとロックファイルのバージョンを一括更新する。

```powershell
Set-Location app
npm run version:set -- 0.2.0
```

このコマンドは`tauri.conf.json`、`Cargo.toml`、`Cargo.lock`、`package.json`、
`package-lock.json`を同期する。個別に編集しない。変更履歴を`docs/CHANGELOG.md`へ記載し、
以下を実行する。

### Updater署名鍵

Tauri Updaterの秘密鍵はリポジトリへ保存せず、GitHub ActionsのRepository secret
`TAURI_SIGNING_PRIVATE_KEY`へ秘密鍵ファイルの内容を登録する。公開鍵だけを
`app/src-tauri/tauri.conf.json`へ保存する。

開発環境で生成した秘密鍵は`%USERPROFILE%\.tauri\local-hub-updater.key`にある。
紛失すると既存インストールへ新しい更新を配信できなくなるため、安全な場所へ別途
バックアップする。秘密鍵を変更する場合は、旧バージョンから新しい鍵へ移行できる
リリース手順を先に設計し、単純に公開鍵を置き換えない。

```powershell
Set-Location app
npm ci
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## 公開

バージョンが`0.2.0`の場合:

```powershell
git add .
git commit -m "release: v0.2.0"
git push origin main
git tag -a v0.2.0 -m "Local Hub v0.2.0"
git push origin v0.2.0
```

GitHubのActions画面で`Release Windows installer`が成功すると、Releasesページに
インストーラー、Updater用署名、`latest.json`と自動生成されたリリースノートが公開される。

ワークフローはタグのバージョンと全バージョン記載箇所を照合する。不一致の場合はビルド前に
失敗するため、ファイルを修正して新しいタグを作り直す。

## 配布上の注意

現状のインストーラーにはWindowsコード署名を設定していない。そのためダウンロードや
初回実行時にMicrosoft Defender SmartScreenの警告が表示される場合がある。一般向け配布を
本格化する際は、コード署名証明書をGitHub ActionsのSecretsへ安全に登録し、Tauriの
Windows署名設定を追加する。

配布前にリポジトリ直下の`THIRD_PARTY_NOTICES.md`を確認し、依存ライブラリのライセンス
条件を満たしていることを確認する。
