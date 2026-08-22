// FR-PLUG-005 プラグインマニフェスト。
// コアは`manifest.json`を読み込み、対応APIバージョン(FR-PLUG-006)を確認してから
// プラグインを扱う。実際のプラグイン検出ディレクトリ走査(複数プラグイン対応)は
// Phase 2の範囲では単一のサンプルプラグインのみを対象にしている。

use serde::{Deserialize, Serialize};

/// このコアが対応するプラグインAPIバージョン(FR-PLUG-006)。
pub const SUPPORTED_API_VERSION: &str = "1";

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CommandContribution {
    /// コマンドバス上のid(名前空間付き。UI/パレットからはこちらで参照する)。
    pub id: String,
    pub title: String,
    pub description: String,
    #[serde(rename = "riskLevel")]
    pub risk_level: u8,
    /// プラグインへ実際に送るIPCメソッド名。省略時は`id`をそのまま使う
    /// (id自体が名前空間なしの単純なRPCメソッド名と一致する場合のみ有効)。
    #[serde(default)]
    pub method: Option<String>,
    /// §10 権限ブローカー: このコマンドの実行に必要な権限名(plugin_permission_grants
    /// のpermissionと一致させる)。指定があり、かつ未許可の場合はコアがプラグインへ
    /// 転送する前に拒否する(plugin_host::call_method_checkedを参照)。
    #[serde(default, rename = "requiresPermission")]
    pub requires_permission: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SettingOption {
    pub value: serde_json::Value,
    pub label: String,
}

/// ホストが汎用設定フォームを描画するための宣言。値そのものはマニフェストへ
/// 書かず、通常値はSQLite、secret値はWindows資格情報マネージャーへ保存する。
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SettingContribution {
    pub id: String,
    #[serde(rename = "type")]
    pub setting_type: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub default: serde_json::Value,
    #[serde(default)]
    pub options: Vec<SettingOption>,
}

/// §6.1付録B ダッシュボードウィジェット。プラグインは独自UIコードを注入する
/// のではなく、「このコマンドを定期的に呼んで結果をカードに表示する」という
/// 汎用ウィジェットを宣言する(コアが共通レンダラーで描画する)。
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct WidgetContribution {
    pub id: String,
    pub title: String,
    /// 定期的に呼び出すコマンドバスID(通常は同じプラグインのcontributes.commands、
    /// または他プラグイン/コアのriskLevel<=1コマンド)。
    pub command: String,
    #[serde(default = "default_refresh_ms", rename = "refreshMs")]
    pub refresh_ms: u64,
}

fn default_refresh_ms() -> u64 {
    5000
}

/// §6.6 横断検索 FR-SEARCH-001。プラグインは検索結果を直接返すのではなく、
/// 「クエリを渡すと結果配列を返すコマンド」を宣言する(ウィジェットと同じ
/// 「コアが共通の形で呼ぶ」設計)。呼び出し時のparamsは`{"query": "<入力文字列>"}`。
/// 期待される戻り値は`[{title, subtitle?, actionCommand?, actionParams?}, ...]`で、
/// actionCommandがあれば選択時にコマンドバス経由で実行する。
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SearchProviderContribution {
    pub id: String,
    pub title: String,
    pub command: String,
}

/// プラグイン自身のUI(§10「プラグインWebView埋め込み」)。
/// entryはプラグインディレクトリからの相対パス(例: "ui/index.html")。
/// このHTML/JS/CSSはコアが`plugin-ui://`カスタムプロトコル経由でサンドボックス化した
/// iframeに読み込む。プラグインの実行ファイル(Rustサイドカー)とは独立した仕組みで、
/// ページ側のJSはwindow.localhub.call(commandId, params)を通してのみコアと通信できる
/// (コマンドバス経由なのでrequiresPermissionの権限チェックも通常通り効く)。
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PageContribution {
    pub id: String,
    pub title: String,
    pub entry: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct Contributes {
    #[serde(default)]
    pub settings: Vec<SettingContribution>,
    #[serde(default)]
    pub widgets: Vec<WidgetContribution>,
    #[serde(default)]
    pub commands: Vec<CommandContribution>,
    #[serde(default)]
    pub pages: Vec<PageContribution>,
    #[serde(default, rename = "searchProviders")]
    pub search_providers: Vec<SearchProviderContribution>,
    #[serde(default)]
    pub automation: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(rename = "apiVersion")]
    pub api_version: String,
    pub entry: String,
    pub description: String,
    pub author: String,
    /// §10.5 プラグイン信頼モデル: "official" | "local-dev" | "unverified"。
    #[serde(default = "default_trust")]
    pub trust: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    /// trueならアプリ起動時に自動でこのプラグインを起動する
    /// (§10.5の信頼モデルにより、unverifiedでも自動起動自体は妨げない。
    /// 危険なのは起動そのものではなく個々の操作の権限なので、権限ブローカー
    /// 側で制御する設計)。
    #[serde(default, rename = "autoStart")]
    pub auto_start: bool,
    #[serde(default)]
    pub contributes: Contributes,
}

fn default_trust() -> String {
    "unverified".to_string()
}

/// マニフェストファイルを読み込み、APIバージョン互換性を検証する。
/// 非互換の場合は実行せず理由を返す(FR-PLUG-006)。
pub fn load(manifest_path: &std::path::Path) -> Result<PluginManifest, String> {
    let text = std::fs::read_to_string(manifest_path)
        .map_err(|e| format!("マニフェストの読み込みに失敗しました({}): {e}", manifest_path.display()))?;
    let manifest: PluginManifest =
        serde_json::from_str(&text).map_err(|e| format!("マニフェストの形式が不正です: {e}"))?;

    if manifest.api_version != SUPPORTED_API_VERSION {
        return Err(format!(
            "非対応のAPIバージョンです(マニフェスト: {}, コア対応: {})",
            manifest.api_version, SUPPORTED_API_VERSION
        ));
    }

    Ok(manifest)
}
