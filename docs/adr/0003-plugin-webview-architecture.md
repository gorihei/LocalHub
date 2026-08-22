# ADR-0003: プラグインWebView埋め込みアーキテクチャ

## ステータス

決定・実装済み(2026-08-14)

## 経緯

Phase 2でプラグイン機構(サイドカー実行ファイル + 標準入出力JSON-RPC)を実装した際、
プラグインが提供できるUIは以下の2種類の「コアが共通レンダラーで描画する」汎用UIのみだった。

- `contributes.widgets`: 指定コマンドを定期実行し、結果をテキストとしてそのまま
  ダッシュボードカードに表示するだけの汎用ウィジェット
- `contributes.commands`: コマンドパレット/プラグイン画面に「タイトル+実行ボタン」
  として並ぶだけで、**パラメータを渡す手段がなかった**

このため実用的なプラグイン(ToDoリスト、フォルダサイズ集計、ネットワーク疎通確認)を
実際に作ってみたところ、パラメータが必要な操作(フォルダパス指定、ホスト指定など)が
事実上使えず、「動くリッチなUIが欲しければコア側のReactコードにプラグインIDを
決め打ちして個別に書く」という運用になった。これはプラグインを追加するたびに
コア側の変更が必要になり、スケールしない。**この設計変更をユーザーに確認せず
進めてしまった**ことも問題として指摘された。

対応として、ユーザーに次の3案を提示し選んでもらった。

1. 現状維持(コア側に都度実装)
2. `contributes.pages`をプラグインが「フォームの項目リスト」のような宣言だけで
   済むよう実装する(ホストが共通レンダラーで描画、プラグインは任意コードを書けない)
3. **プラグインWebView埋め込み**(プラグインが自分のHTML/JS/CSSを書き、ホストが
   サンドボックス化したiframeに埋め込んで描画する)

ユーザーは3を選択した。

## 決定

プラグインは`manifest.json`の`contributes.pages`に自分のUIエントリを宣言できる。

```json
"contributes": {
  "pages": [
    { "id": "todo.main", "title": "ToDoリスト", "entry": "ui/index.html" }
  ]
}
```

`entry`はプラグインディレクトリからの相対パス。このHTML/JS/CSSはコアの
カスタムURIスキーム`plugin-ui://`経由で配信され、サンドボックス化した
`<iframe sandbox="allow-scripts allow-forms">`に読み込まれる。

### 通信方式

プラグインのUI(iframe内のJS)はTauriのAPIへ直接アクセスできない。唯一の通信手段は
`window.postMessage`で、iframeに自動注入されるランタイム(`__bridge.js`、
プラグイン自身は書かない)が`window.localhub`という薄いAPIを提供する。

- `window.localhub.call(commandId, params)` — コマンドバス経由でコマンドを実行する。
  `commandId`はプラグイン自身から見た短いid(例: `"todo.add"`)で、フルのコマンドバスid
  (`plugin.<pluginId>.todo.add`)への変換はホスト側(`PluginPageFrame.tsx`)が行う。
  コマンドバス経由のため、`requiresPermission`による権限チェックも通常通り効く
  (プラグインUIだからといって権限をバイパスできない)。
- `window.localhub.pickFolder()` — ネイティブのフォルダ選択ダイアログをホストに
  代行してもらう(サンドボックス化されたiframeはファイルシステムダイアログを
  直接開けないため)。

### セキュリティ境界

- `sandbox="allow-scripts allow-forms"`で`allow-same-origin`は付けない
  (iframeは毎回オペークな一意オリジンになり、他のプラグインページやホストの
  DOM・Cookie・localStorageへは触れられない)
- `event.source`(iframeの`contentWindow`そのもの)で送信元を照合しているため、
  複数のプラグインページが同時に開いていても互いのメッセージを誤って処理しない
- 配信対象ファイルは、宣言済み`contributes.pages`の`entry`の**親フォルダ配下のみ**
  (プラグインディレクトリ内の無関係なファイルは読めない)。加えて`canonicalize()`した
  上でプラグインディレクトリ配下かを二重チェックし、`..`によるパストラバーサルを防ぐ
  (`plugin_host::plugin_ui_protocol_handler`)

### テーマ同期

ホストのCSS変数(`--bg`/`--accent`等、`theme.css`参照)を`postMessage`で
iframeへ送り、`__bridge.js`が自分の`documentElement`に反映する。プラグイン側は
`var(--accent)`のようにテーマトークンを使うだけで、設定画面でのアクセントカラー
変更にも自動追従する。ホスト側は`document.documentElement`の`style`属性を
`MutationObserver`で監視し、変化のたびに再送する。

`__bridge.js`は最低限のベーススタイル(body/button/inputの既定色)も`<head>`の
先頭に注入する。プラグイン側の`<style>`は文書順で後になるため、同じ詳細度でも
自然に上書きできる(プラグインは差分だけ書けばよい)。

### 埋め込み場所

`contributes.pages`はプラグイン画面の詳細パネル(`variant="framed"`: 枠線・背景付き)
だけでなく、ダッシュボードウィジェット(`variant="flush"`: 枠なし・ウィジェットカードに
一体化)としても配置できる。同じページ実装を両方の埋め込み先で共有する。

## 影響

- 以前ホスト側にハードコードしていたプラグイン固有パネル(`FolderSizePanel`/
  `PingPanel`)は廃止し、`PluginPageFrame.tsx`という汎用コンポーネントに置き換えた
- `manifest.rs`の`Contributes.pages`を`Vec<serde_json::Value>`(未使用の
  プレースホルダ)から`Vec<PageContribution>`(型付き)に変更
- 新規Tauriコマンド: `plugin_pages_list`(全プラグインの`contributes.pages`を
  まとめて返す。ダッシュボードのウィジェットカタログにマージするため)

## 見送った代替案

- **案2(`contributes.pages`をフォーム宣言のみに限定)**: プラグイン側で任意の
  デザイン・アニメーションができない。個人用アプリでプラグインを「作り込む」
  楽しさを優先し、案3(自由なHTML/JS)を選んだ。
