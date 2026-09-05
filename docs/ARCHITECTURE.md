# Local Hub 現状アーキテクチャ(スナップショット)

このドキュメントは実装が進んだ現時点(2026-08-14)の「実際に何がどう動いているか」を
まとめたものです。要件そのものは`REQUIREMENTS.md`が正、設計判断の経緯・理由は
`docs/adr/`が正で、このファイルは両者を横断して現在の実装状況を一覧できるようにする
ためのスナップショットです。実装が進むと古くなるので、大きな変更をしたときは
更新してください。

## 技術スタック

Tauri 2.x + Rust(バックエンド、`app/src-tauri/`) + React 19 / TypeScript
(フロントエンド、`app/src/`)。経緯は[0001-tech-stack.md](adr/0001-tech-stack.md)、
Phase 0の技術検証結果は[0002-phase0-technical-validation.md](adr/0002-phase0-technical-validation.md)
を参照。

開発環境の既知の癖(壊れたVS2022リンカーの回避、GUIはPowerShell経由で起動必須など)は
`CLAUDE.md`に記載。

## ディレクトリ構成

```
app/
  src-tauri/src/       Rustバックエンド(Tauriコマンド・サイドカー管理・SQLite等)
  src/                 Reactフロントエンド
    pages/             各画面・ダッシュボードウィジェット
    shell/             ウィンドウ枠・サイドバー・トップバー
    settings/          設定コンテキスト(アクセントカラー等のグローバル状態)
    shortcuts/         アプリランチャー・起動セット
    commandBus/         コマンドバスのフロント側ヘルパー・確認ダイアログ
    search/            横断検索・コマンドパレット
    jobs/, notifications/  バックグラウンドジョブ・通知
  plugins/             プラグイン(サイドカー実行ファイル+UI)
    todo-plugin/        ToDoリスト管理
    folder-size-plugin/ フォルダサイズ集計
    ping-plugin/         ネットワーク疎通確認(簡易TCP ping)
docs/
  adr/                 設計判断の記録(Architecture Decision Record)
  ARCHITECTURE.md       このファイル
  SPECIFICATIONS.md     利用者から見える動作と実装契約
  CHANGELOG.md          日付単位の実装修正履歴
REQUIREMENTS.md         要件定義(正)
```

## Rustバックエンド(`src-tauri/src/`)モジュール一覧

| モジュール | 役割 |
|---|---|
| `lib.rs` | Tauri Builderの組み立て、全コマンドの登録、起動時セットアップ |
| `storage.rs` | SQLite初期化、設定/シークレット保存、バックアップ、セーフモード判定 |
| `plugin_host.rs` | プラグインのライフサイクル管理、サイドカーIPC、`plugin-ui://`カスタムプロトコル |
| `manifest.rs` | `manifest.json`のパース・APIバージョン検証 |
| `mouse_effects.rs` | Windows全体に表示するクリック波紋 |
| `port_test.rs` | 任意ホスト・ポートへの読み取り専用TCP疎通確認 |
| `permissions.rs` | 権限ブローカー(§10、プラグインごとの許可/未許可台帳) |
| `command_bus.rs` | コマンドバス(§12.4)。UI・自動化・プラグインが共通で通す実行経路 |
| `automation.rs` | 自動化フロー(トリガー→条件→アクション)、スケジューラ |
| `shortcuts.rs` | アプリランチャー・起動セットのCRUD・起動 |
| `pty.rs` | 統合CLI(ConPTY経由のターミナル) |
| `system.rs` | システム状態ウィジェット用(CPU/メモリ/ネットワーク/稼働時間) |
| `processes.rs` | プロセス・ポート監視ページ |
| `jobs.rs` | バックグラウンドジョブ(プラグイン再スキャン等) |
| `notifications.rs` | 通知履歴・OSトースト通知 |
| `logging.rs` | ログ基盤(`tracing`、直近ログのメモリ保持) |

## フロントエンド画面一覧(`src/pages/`, サイドバー掲載順)

1. **ホーム(ダッシュボード)** — `HomePage.tsx`。react-grid-layoutベースのウィジェット
   グリッド。複数タブによるグループ化、タブ間移動、追加/削除/移動/リサイズ、
   SQLiteへの永続化、1段階Undo。既存の単一レイアウトは初回読み込み時にメインタブへ移行する。
2. **検索** — `SearchPage.tsx`(横断検索)、`CommandPalette.tsx`(Ctrl+K)。
3. **自動化** — `AutomationPage.tsx`。トリガー(手動/起動時/スケジュール)+アクション列の
   フロービルダー。`risk_level>=2`のコマンドは登録自体を拒否(FR-AUTO-005)。
4. **プラグイン** — `PluginsPage.tsx`。検出済みプラグインの一覧・起動/停止・権限許可・
   ログ表示・導入(フォルダ選択)・アンインストール。`contributes.pages`があれば
   [ADR-0003](adr/0003-plugin-webview-architecture.md)の仕組みで専用UIを埋め込み表示。
5. **AI CLI** — `AiCliPage.tsx`。Codex CLI、Claude Code、Gemini CLIを検出し、選択した
   作業フォルダーでConPTYセッションとして起動する。複数セッションの切り替え・終了・
   稼働状態表示に対応し、別画面へ移動してもプロセスを維持する。検出・起動・セキュリティ
   境界の詳細は[ADR-0006](adr/0006-ai-cli-session-management.md)を参照。
6. **開発者ツール** — `DevToolsPage.tsx`。JSON/YAML/XML整形、テキスト変換、UUID/ハッシュ、
   タイムスタンプ変換、正規表現テスト・置換プレビュー、差分表示、カラー変換、JWTデコーダー、
   ダミーデータ生成、Markdownプレビュー、進数変換、URL解析、文字数カウント。
   QRコード生成は`qrcode`で端末内処理し、誤り訂正レベルとPNGサイズを指定して保存できる。
   ポート疎通テスターはRustコアのTCP接続コマンドを使い、任意のホスト・ポートへの
   接続可否を確認する。
   画像背景透過は`@imgly/background-removal` + ONNX Runtime Webで端末内推論し、
   透過PNGとして保存できる。画像データは外部送信しないが、初回実行時はIMG.LY CDNから
   量子化モデル(`isnet_quint8`、約40MB)を取得する。QRコード生成を含むその他のツールは
   外部送信なし。
7. **プロセス・ポート** — `ProcessesPage.tsx`。プロセス検索・CPU/メモリ表示、
   `netstat -ano`によるポート対応、終了操作(確認ダイアログ付き)。
8. **設定** — `SettingsPage.tsx`。外観(アクセントカラー6色・フォントサイズ・密度)、
   一般(自動起動・閉じる動作)、ショートカット(グローバルホットキー)、
   マウス(Windows全体のクリック波紋)、データ(バックアップ書き出し/読み込み)、ログ。
   クリック波紋の有効状態・色・形・速度・サイズ・線幅はSQLiteへ保存し、次回起動時に
   自動復元する。

### ダッシュボードウィジェット一覧(`WIDGET_CATALOG` in `HomePage.tsx`)

アプリランチャー、起動セット、最近使ったショートカット、クイックCLI、システム状態、
プラグイン状態、時計、クイックメモ、クリップボード履歴、最近の通知、ToDoリスト。
組み込み付箋は複数枚の本文・色・更新時刻を`app_settings.stickyNotes`へJSON保存し、
ダッシュボード上で追加・編集・削除できる。配置方法は自動グリッドとドラッグによる
自由配置を切り替えられる。付箋の寸法は内容に応じて自動調整され、右下ハンドルによる
手動リサイズと自動調整への復帰にも対応する。自由配置時の位置・重なり順・寸法も保存する。
これに加え、プラグインが`contributes.widgets`(テキスト表示のみの汎用ウィジェット)や
`contributes.pages`(プラグイン自作UI、`variant="flush"`で枠なし埋め込み)で
提供するウィジェットが動的にカタログへマージされる。

## プラグインシステム

- **検出**: `<app_data_dir>/plugins/*/manifest.json`を起動時に走査(複数プラグイン対応)。
  以前はデバッグビルド限定でリポジトリ同梱の開発用サンプルプラグインも常に検出していたが、
  サンプル一式は削除済み(実用プラグインのみを対象とする)。
- **通信**: サイドカー実行ファイルを子プロセスとして起動し、改行区切りJSONの
  簡易JSON-RPCで標準入出力越しにやり取りする。
- **Windowsでの起動**: GUI版コアからコンソール型サイドカーを起動しても別の
  コンソールウィンドウが表示されないよう、コアが`CREATE_NO_WINDOW`を指定する。
  JSON-RPC用の標準入出力とログ用の標準エラー出力はパイプで保持する。
- **ライフサイクル**: `Installed → Starting → Running → Failed/Disabled`。短時間の
  連続クラッシュ(15秒以内に3回)で自動的に`Disabled`へ落ちる(クラッシュループ検知)。
- **権限**: `manifest.permissions`で要求を宣言し、`contributes.commands[].requiresPermission`
  が指定されたコマンドは、ユーザーがプラグイン画面で許可するまでコアが実行を拒否する
  (既定は未許可、FR-PERM-004)。
- **UI**: [ADR-0003](adr/0003-plugin-webview-architecture.md)参照。
- **自作プラグイン一覧**(`app/plugins/`配下、いずれもRust製サイドカー):
  - `todo-plugin` — ローカルJSON保存のToDoリスト。ダッシュボードウィジェット
    (進捗バー・グラデーションチェックボックス等、独自デザイン)+専用ページ。
  - `folder-size-plugin` — 指定フォルダ直下の容量内訳を大きい順に集計
    (`filesystem:read`権限が必要)。
  - `ping-plugin` — TCP接続確認による簡易ping(`network`権限が必要)。

## データ永続化

- SQLite(`<app_data_dir>/local-hub.sqlite3`)。設定、ショートカット、起動セット、
  ダッシュボードレイアウト、通知履歴、プラグイン権限台帳、自動化フロー等。
- シークレットはSQLiteに置かず、Windows資格情報マネージャー(`keyring-core` +
  `windows-native-keyring-store`)経由で保存。
- バックアップ/復元(§14): DBファイルのコピー書き出し、インポートは
  ステージングしてから次回起動時に安全に適用(稼働中DBの直接差し替えを避ける)。
- セーフモード: 直近起動時刻を比較し、短時間(20秒以内)の再起動が連続したら
  クラッシュループとみなしプラグインを無効化した状態で起動する。

## 実行ファイル

`src-tauri/Cargo.toml`の`[[bin]] name = "LocalHub"`により、生成物は`LocalHub.exe`
(タスクマネージャー等での識別性のため、パッケージ/クレート名`app`自体は変更していない)。

## 既知の制限・今後の課題

- プラグインUI(iframe)は同一オリジン(`http://plugin-ui.localhost`)を共有するが、
  `sandbox`に`allow-same-origin`を付けていないため各読み込みはオペークな一意オリジンに
  なり、`localStorage`等はブラウザ仕様上使えない(プラグイン側で永続化したい設定は
  サイドカー側にコマンドを生やして持たせる想定)。
- `contributes.pages`のファイル配信は「宣言済みentryの親フォルダ配下」という
  ディレクトリ単位の粗い制御。ファイル単位の許可リストではない。
- プラグインの自動テスト・CI相当の仕組みは未整備(手動確認のみ)。
