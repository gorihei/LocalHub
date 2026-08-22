# Third-party notices

Local Hubは、次のサードパーティソフトウェアを含みます。各パッケージには、それぞれのライセンス条件が適用されます。

## IMG.LY Background Removal

- パッケージ: [`@imgly/background-removal`](https://github.com/imgly/background-removal-js)
- バージョン: 1.7.0
- Copyright: IMG.LY GmbH and contributors
- ライセンス: GNU Affero General Public License v3.0 (AGPL-3.0)
- ライセンス本文: インストール後の `app/node_modules/@imgly/background-removal/LICENSE.md`

この依存関係は画像背景透過機能で使用します。Local Hubを配布・提供する場合は、AGPL-3.0の適用範囲とソースコード提供義務を確認してください。別ライセンスが必要な場合はIMG.LYへ問い合わせてください。

## その他の依存関係

その他のJavaScriptおよびRust依存関係の名称・バージョンは、次のロックファイルを参照してください。

- `app/package-lock.json`
- `app/src-tauri/Cargo.lock`
- `app/plugins/*/Cargo.lock`
