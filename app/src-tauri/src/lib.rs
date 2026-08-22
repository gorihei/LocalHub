mod automation;
mod command_bus;
mod jobs;
mod logging;
mod manifest;
mod notifications;
mod permissions;
mod plugin_host;
mod processes;
mod pty;
mod shortcuts;
mod storage;
mod system;

use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_window_state::StateFlags;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// §14 バックアップのインポート後、次回起動時に反映する方式(storage::
/// apply_pending_import)を採っているため、インポート直後にアプリを
/// 再起動するための明示コマンドを用意している。
#[tauri::command]
fn app_restart(app: tauri::AppHandle) {
    app.restart();
}

/// 通知スパイクの診断用コマンド。フロント側の`sendNotification`(Web
/// Notification APIのシム経由)だと、Rust側で実際に何が起きたか(WinRT呼び出しの
/// 成否)が握りつぶされて見えないため、Result をそのまま返す版を別途用意した。
#[tauri::command]
fn notify_diagnostic(app: tauri::AppHandle) -> Result<(), String> {
    app.notification()
        .builder()
        .title("Local Hub")
        .body("通知スパイク: 診断コマンド経由")
        .show()
        .map_err(|e| format!("{e}"))
}

/// §6.10設定「ショートカット」/FR-LAUNCH-006: ウィンドウ表示切り替え用の
/// グローバルショートカットをユーザーが変更・無効化できるようにする。
/// 現在有効なショートカットを(表示用文字列, パース済みShortcut)の組で保持し、
/// with_handler内での押下判定と、設定画面からの変更の両方から参照する。
#[derive(Default)]
pub struct GlobalShortcutState(pub Mutex<Option<(String, Shortcut)>>);

const DEFAULT_GLOBAL_SHORTCUT: &str = "Ctrl+Shift+H";
const GLOBAL_SHORTCUT_KEY: &str = "globalShortcut";
const GLOBAL_SHORTCUT_ENABLED_KEY: &str = "globalShortcutEnabled";

/// 現在登録中のショートカットを解除し、指定があれば新しいものを登録して
/// 状態を更新する。設定への永続化はしない(呼び出し側の責務)。
fn apply_global_shortcut(app: &AppHandle, shortcut_str: Option<&str>) -> Result<(), String> {
    let state = app.state::<GlobalShortcutState>();
    let mut guard = state.0.lock().unwrap();

    if let Some((_, old)) = guard.as_ref() {
        let _ = app.global_shortcut().unregister(*old);
    }

    match shortcut_str {
        None => {
            *guard = None;
            Ok(())
        }
        Some(s) => {
            let parsed = s
                .parse::<Shortcut>()
                .map_err(|e| format!("ショートカットの形式が正しくありません: {e}"))?;
            app.global_shortcut()
                .register(parsed)
                .map_err(|e| format!("登録に失敗しました(他のアプリと競合している可能性があります): {e}"))?;
            *guard = Some((s.to_string(), parsed));
            Ok(())
        }
    }
}

/// 現在の設定を`{shortcut, enabled}`として返す(未設定時はdefaultを表示用に使う)。
#[tauri::command]
fn global_shortcut_status(state: tauri::State<GlobalShortcutState>) -> serde_json::Value {
    let guard = state.0.lock().unwrap();
    match guard.as_ref() {
        Some((s, _)) => serde_json::json!({ "shortcut": s, "enabled": true }),
        None => serde_json::json!({ "shortcut": DEFAULT_GLOBAL_SHORTCUT, "enabled": false }),
    }
}

/// 設定画面から呼ばれる。enabled=falseならショートカットを解除するだけ、
/// trueならshortcutをパース・登録し、成功時のみ設定へ永続化する。
#[tauri::command]
fn global_shortcut_update(
    app: AppHandle,
    db_state: tauri::State<storage::DbState>,
    shortcut: String,
    enabled: bool,
) -> Result<(), String> {
    apply_global_shortcut(&app, if enabled { Some(shortcut.as_str()) } else { None })?;
    let conn = db_state.0.lock().unwrap();
    storage::settings_set_internal(&conn, GLOBAL_SHORTCUT_KEY, &shortcut)?;
    storage::settings_set_internal(&conn, GLOBAL_SHORTCUT_ENABLED_KEY, if enabled { "true" } else { "false" })?;
    Ok(())
}

/// §11.3: 設定画面の「ログ」タブから、ログファイルの実フォルダをエクスプ
/// ローラーで開けるようにパスを返す。
#[tauri::command]
fn log_dir_path(app: AppHandle) -> Result<String, String> {
    app.path()
        .app_log_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| format!("ログフォルダーの取得に失敗しました: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 多重起動防止: 2つ目の起動を検知したら新しいプロセスは即終了し、
        // 既存ウィンドウを前面に出す。Tauriの推奨に従い最初に登録する。
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        // 付録B ダッシュボードウィジェット「クリップボード履歴」用。
        .plugin(tauri_plugin_clipboard_manager::init())
        // §6.10設定「一般」: OS起動時の自動起動。有効/無効の切り替え自体は
        // 設定ページからautostart_set経由で行う(このinit()はプラグインの
        // 疎通登録のみで、実際にオンにするかはユーザー操作次第)。
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        // §5.3: 前回のウィンドウ位置・サイズ・最大化状態を復元する。
        // 保存先モニターが存在しない場合は保存位置を使わずOS任せにする実装に
        // なっており、「画面外に復元される場合は可視領域へ補正する」要件を満たす。
        //
        // DECORATIONSは意図的に対象から除外している。tauri.conf.jsonで
        // decorations:falseに固定しているが、このプラグインは以前保存した
        // decorated状態(過去のセッションではtrueだった)を起動のたびに復元して
        // しまい、結果的に毎回OSタイトルバーが復活してしまう不具合が実機で
        // 確認されたため。
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::DECORATIONS)
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    // 設定でユーザーが変更・無効化できるため、固定値ではなく
                    // GlobalShortcutStateに現在登録されているものと比較する。
                    // Shortcut::to_string()は内部表現(大文字小文字・順序・キー名が
                    // 入力と異なる)になるため、文字列比較ではなくShortcut同士
                    // (PartialEq)で比較する。
                    let state = app.state::<GlobalShortcutState>();
                    let guard = state.0.lock().unwrap();
                    let Some((_, target)) = guard.as_ref() else {
                        return;
                    };
                    if shortcut != target {
                        return;
                    }
                    if let Some(window) = app.get_webview_window("main") {
                        let visible = window.is_visible().unwrap_or(false);
                        if visible {
                            let _ = window.hide();
                        } else {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(),
        )
        // §10「プラグインWebView埋め込み」: プラグイン自身が書いたHTML/JS/CSSを
        // サンドボックス化したiframeに読み込むためのカスタムプロトコル。
        // Windows/AndroidではURLが`http://plugin-ui.localhost/<pluginId>/<相対パス>`の
        // 形になる(Tauriの仕様、macOS/Linuxは`plugin-ui://localhost/...`)。
        // 詳細はplugin_host::plugin_ui_protocol_handlerのコメントを参照。
        .register_uri_scheme_protocol("plugin-ui", plugin_host::plugin_ui_protocol_handler)
        .manage(pty::PtyState::default())
        .manage(jobs::JobRegistry::default())
        .manage(system::SystemState::default())
        .manage(processes::ProcessState::default())
        .manage(GlobalShortcutState::default())
        .manage(automation::SchedulerState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            app_restart,
            notify_diagnostic,
            global_shortcut_status,
            global_shortcut_update,
            log_dir_path,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            plugin_host::plugin_start,
            plugin_host::plugin_call,
            plugin_host::plugin_restart,
            plugin_host::plugin_recent_logs,
            plugin_host::plugin_status,
            plugin_host::plugin_list,
            plugin_host::plugin_widgets_list,
            plugin_host::plugin_pages_list,
            plugin_host::plugin_search_providers_list,
            plugin_host::plugin_reenable,
            plugin_host::plugins_install,
            plugin_host::plugins_uninstall,
            permissions::permissions_list,
            permissions::permissions_set,
            shortcuts::shortcuts_list,
            shortcuts::shortcuts_recent,
            shortcuts::shortcuts_add,
            shortcuts::shortcuts_update,
            shortcuts::shortcuts_delete,
            shortcuts::shortcuts_set_favorite,
            shortcuts::shortcuts_reorder,
            shortcuts::shortcut_icon,
            shortcuts::shortcuts_launch,
            shortcuts::launch_sets_list,
            shortcuts::launch_set_items,
            shortcuts::launch_sets_add,
            shortcuts::launch_sets_delete,
            shortcuts::launch_sets_run,
            storage::settings_get_all,
            storage::settings_set,
            storage::settings_delete,
            storage::secret_set,
            storage::secret_get,
            storage::secret_delete,
            storage::plugin_settings_get,
            storage::plugin_setting_set,
            storage::plugin_setting_delete,
            storage::backup_export,
            storage::backup_import_stage,
            plugin_host::app_safe_mode_active,
            logging::logs_recent,
            notifications::notifications_list,
            notifications::notifications_test,
            notifications::notifications_push,
            jobs::job_rescan_plugins,
            jobs::job_cancel,
            command_bus::command_bus_list,
            command_bus::command_bus_execute,
            automation::automation_flows_list,
            automation::automation_flow_upsert,
            automation::automation_flow_delete,
            automation::automation_flow_set_enabled,
            automation::automation_flow_run_now,
            system::system_stats,
            processes::processes_list,
            processes::process_kill
        ])
        .setup(|app| {
            let log_dir = app.path().app_log_dir()?;
            let (recent_logs, logging_guard) = logging::init(&log_dir)?;
            app.manage(recent_logs);
            app.manage(logging_guard);
            tracing::info!("Local Hub 起動");

            let db_state = storage::init_store(&app.handle())?;

            // §13.3/AC-11 セーフモード: 短時間に連続で再起動している(=クラッシュ
            // 直後の再起動を繰り返している)場合、プラグインを無効化した状態で
            // 起動する(壊れたプラグインが原因で毎回クラッシュし続ける事態を
            // 避けるため)。判定方式の詳細はstorage::check_rapid_restartを参照。
            let safe_mode = storage::check_rapid_restart(&db_state.0.lock().unwrap());
            if safe_mode {
                tracing::warn!("2回連続で異常終了を検知したため、セーフモードで起動します(プラグイン無効化)");
            }
            app.manage(plugin_host::SafeModeState(safe_mode));

            app.manage(db_state);

            // FR-PLUG-001: 起動時にプラグインを検出する(複数対応)。
            let plugins_dir = app.path().app_data_dir()?.join("plugins");
            std::fs::create_dir_all(&plugins_dir)?;
            let discovered = plugin_host::discover_all(&plugins_dir);
            // コマンドバス登録用に、各プラグインの(id, contributes.commands)を
            // 先に複製しておく(PluginHostStateへmanage()した後はロックが必要になる)。
            let plugin_commands_by_id: Vec<(String, Vec<manifest::CommandContribution>)> =
                discovered.iter().map(|(id, entry)| (id.clone(), entry.manifest.contributes.commands.clone())).collect();
            let auto_start_ids: Vec<String> =
                discovered.iter().filter(|(_, entry)| entry.manifest.auto_start).map(|(id, _)| id.clone()).collect();
            app.manage(plugin_host::PluginHostState { plugins: std::sync::Mutex::new(discovered), plugins_dir });

            // manifest.jsonでautoStart:trueを宣言したプラグインを起動する。
            // セーフモード中はplugin_start自体が拒否するため、ここでは
            // 単に「試みて失敗をログに残す」だけでよい。
            for plugin_id in auto_start_ids {
                if let Err(e) = plugin_host::plugin_start(app.handle().clone(), app.state::<plugin_host::PluginHostState>(), plugin_id.clone()) {
                    tracing::warn!(target: "plugin", %plugin_id, error = %e, "自動起動に失敗しました");
                }
            }

            // §12.4 コマンドバス: UI・パレット・自動化・AIが同じ定義を通して
            // 呼び出せるよう、既存の各機能をコマンドとして登録しておく。
            let bus = command_bus::CommandBus::default();

            // 各プラグインの contributes.commands で宣言されたコマンドを、
            // プラグイン所有(owner_plugin_id)として動的に登録する。実行時は
            // plugin_call経由でサイドカーへ中継するため、プラグインが未起動の
            // 場合は自然に「プラグインが起動していません」エラーになる。
            for (plugin_id, commands) in plugin_commands_by_id {
                command_bus::register_plugin_commands(&bus, &plugin_id, &commands);
            }
            bus.register(
                command_bus::CommandMeta {
                    id: "jobs.rescanPlugins".into(),
                    title: "プラグインを再スキャン".into(),
                    description: "サイドカー実行ファイルの実在を確認し、検出結果を通知します".into(),
                    owner_plugin_id: None,
                    risk_level: 0,
                    supports_undo: false,
                },
                Box::new(|app, _params| {
                    let job_id = jobs::job_rescan_plugins(app.clone(), app.state::<jobs::JobRegistry>());
                    Ok(serde_json::json!({ "jobId": job_id }))
                }),
            );
            bus.register(
                command_bus::CommandMeta {
                    id: "notifications.sendTest".into(),
                    title: "テスト通知を送る".into(),
                    description: "通知パイプラインの疎通確認用の通知を送信します".into(),
                    owner_plugin_id: None,
                    risk_level: 0,
                    supports_undo: false,
                },
                Box::new(|app, _params| {
                    notifications::notifications_test(app.clone());
                    Ok(serde_json::Value::Null)
                }),
            );
            bus.register(
                command_bus::CommandMeta {
                    id: "notifications.clearHistory".into(),
                    title: "通知履歴をすべて削除".into(),
                    description: "保存されている通知履歴を完全に削除します(元に戻せません)".into(),
                    owner_plugin_id: None,
                    risk_level: 2,
                    supports_undo: false,
                },
                Box::new(|app, _params| {
                    notifications::notifications_clear(app.state::<storage::DbState>()).map(|_| serde_json::Value::Null)
                }),
            );
            bus.register(
                command_bus::CommandMeta {
                    id: "shortcuts.launch".into(),
                    title: "ショートカットを起動".into(),
                    description: "登録されたショートカットを実際に起動します".into(),
                    owner_plugin_id: None,
                    risk_level: 1,
                    supports_undo: false,
                },
                Box::new(|app, params| {
                    let id = params.get("id").and_then(|v| v.as_i64()).ok_or("idが指定されていません")?;
                    shortcuts::shortcuts_launch(app.clone(), app.state::<storage::DbState>(), id)
                        .map(|_| serde_json::Value::Null)
                }),
            );
            bus.register(
                command_bus::CommandMeta {
                    id: "launchSets.run".into(),
                    title: "起動セットを実行".into(),
                    description: "登録された起動セットを順番に実行します".into(),
                    owner_plugin_id: None,
                    risk_level: 1,
                    supports_undo: false,
                },
                Box::new(|app, params| {
                    let id = params.get("id").and_then(|v| v.as_i64()).ok_or("idが指定されていません")?;
                    shortcuts::launch_sets_run(app.clone(), app.state::<storage::DbState>(), id)
                        .map(|results| serde_json::to_value(results).unwrap_or(serde_json::Value::Null))
                }),
            );
            app.manage(bus);

            // §6.8 自動化: スケジュールトリガーの監視を開始し、アプリ起動時
            // トリガーのフローを一度だけ実行する。
            automation::spawn_scheduler(app.handle().clone());
            automation::run_startup_flows(&app.handle());

            // §6.10設定「ショートカット」: 保存済みの設定を復元する。壊れた
            // 値や競合で登録に失敗しても、それだけでアプリ起動全体を失敗させ
            // たくないため、エラーはログに残しつつ「無効」のまま起動を続ける。
            {
                let db_state = app.state::<storage::DbState>();
                let conn = db_state.0.lock().unwrap();
                let enabled = storage::settings_get_internal(&conn, GLOBAL_SHORTCUT_ENABLED_KEY).map(|v| v == "true").unwrap_or(true);
                let shortcut = storage::settings_get_internal(&conn, GLOBAL_SHORTCUT_KEY).unwrap_or_else(|| DEFAULT_GLOBAL_SHORTCUT.to_string());
                drop(conn);
                if enabled {
                    if let Err(e) = apply_global_shortcut(&app.handle(), Some(&shortcut)) {
                        tracing::warn!("グローバルショートカットの復元に失敗しました: {e}");
                    }
                }
            }

            // トレイアイコン: 「表示」でウィンドウ復帰、「終了」でアプリを終了する。
            let show_item = MenuItem::with_id(app, "show", "表示", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Local Hub")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // §5.3/§6.10設定「一般」: 閉じるボタンの挙動(トレイに格納/終了)を
            // ユーザーが選べるようにする。既定は「トレイに格納」(既存挙動)。
            if let Some(window) = app.get_webview_window("main") {
                let window_for_close = window.clone();
                let app_for_close = app.handle().clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        let close_behavior = match app_for_close.try_state::<storage::DbState>() {
                            Some(db_state) => {
                                let conn = db_state.0.lock().unwrap();
                                storage::settings_get_internal(&conn, "closeBehavior")
                            }
                            None => None,
                        };
                        if close_behavior.as_deref() == Some("exit") {
                            // prevent_closeせず既定動作(ウィンドウを閉じる)に任せると
                            // トレイアイコンが残ったままになるため、明示的にexitする。
                            app_for_close.exit(0);
                        } else {
                            api.prevent_close();
                            let _ = window_for_close.hide();
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
