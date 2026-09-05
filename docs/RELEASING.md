# Windows版リリース手順

Local HubのWindowsインストーラーは、GitHub ActionsでビルドしGitHub Releasesから配布する。

## 生成物

- NSISインストーラー（`.exe`）
- Windows Installer（`.msi`）

ワークフローは`v*`タグのpushで起動し、タグに対応する公開Releaseを作成して両方の
インストーラーを添付する。ハイフンを含むバージョンタグ（例: `v0.2.0-beta.1`）は
プレリリースとして公開する。

## リリース前の更新

次の3ファイルのバージョンを同じ値へ更新する。

- `app/src-tauri/tauri.conf.json`の`version`
- `app/src-tauri/Cargo.toml`の`package.version`
- `app/package.json`の`version`

`app/package.json`を変更した場合は、`app/package-lock.json`も同期する。変更履歴を
`docs/CHANGELOG.md`へ記載し、以下を実行する。

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
インストーラーと自動生成されたリリースノートが公開される。

ワークフローはタグのバージョンと上記3ファイルを照合する。不一致の場合はビルド前に
失敗するため、ファイルを修正して新しいタグを作り直す。

## 配布上の注意

現状のインストーラーにはWindowsコード署名を設定していない。そのためダウンロードや
初回実行時にMicrosoft Defender SmartScreenの警告が表示される場合がある。一般向け配布を
本格化する際は、コード署名証明書をGitHub ActionsのSecretsへ安全に登録し、Tauriの
Windows署名設定を追加する。

配布前にリポジトリ直下の`THIRD_PARTY_NOTICES.md`を確認し、依存ライブラリのライセンス
条件を満たしていることを確認する。
