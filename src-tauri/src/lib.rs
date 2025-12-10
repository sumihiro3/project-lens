// モジュール宣言
mod backlog; // Backlog APIクライアント
mod commands; // Tauriコマンド（フロントエンドから呼び出される関数）
mod db; // データベースクライアント
mod scheduler; // バックグラウンドスケジューラー
mod scoring; // スコアリングサービス
mod log_commands; // ログ関連コマンド
pub mod rate_limit; // レートリミット情報

#[cfg(test)]
mod sample_test; // テスト環境確認用

/// アプリケーションのメインエントリポイント
///
/// Tauriアプリケーションの初期化と起動を行う。
/// 以下の処理を順に実行する：
/// 1. データベースマイグレーションの準備
/// 2. Tauriプラグインの初期化（通知、HTTP、ログ、SQL）
/// 3. コマンドハンドラーの登録
/// 4. セットアップフック内でデータベースクライアントとスケジューラーを初期化
/// 5. アプリケーションの起動
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // データベースマイグレーション定義を取得
    // let migrations = db::get_migrations();

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        // 通知プラグインを初期化（システムトレイ通知用）
        .plugin(tauri_plugin_notification::init())
        // Shellプラグインを初期化（ブラウザでURLを開く用）
        .plugin(tauri_plugin_shell::init())
        // Openerプラグインを初期化（URLを開く用）
        .plugin(tauri_plugin_opener::init())
        // HTTPプラグインを初期化（Backlog API通信用）
        .plugin(tauri_plugin_http::init())
        // ログプラグインを初期化（デバッグ・エラーログ用）
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .max_file_size(10_000_000) // 10MB
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                .build(),
        )
        // SQLプラグインを初期化（データベースマイグレーション実行）
        // Note: マイグレーションはDbClientで手動実行するため、ここでは空の状態で初期化するか、
        // フロントエンドからのアクセスが不要なら削除しても良いが、念のため残しておく。
        .plugin(
            tauri_plugin_sql::Builder::default()
                .build(),
        )
        // フロントエンドから呼び出せるコマンドを登録
        .invoke_handler(tauri::generate_handler![
            commands::greet,          // テスト用挨拶コマンド
            commands::save_settings,  // 設定保存
            commands::get_settings,   // 設定取得
            commands::fetch_issues,   // Backlogから課題を取得してスコアリング
            commands::fetch_projects, // Backlogからプロジェクト一覧を取得
            commands::get_issues,     // 保存済み課題一覧を取得
            commands::get_workspaces, // ワークスペース一覧を取得
            commands::get_workspace_by_id, // ワークスペースIDから取得
            commands::save_workspace, // ワークスペースを保存
            commands::delete_workspace, // ワークスペースを削除
            commands::toggle_workspace_enabled, // ワークスペースの有効・無効を切り替え
            log_commands::get_log_directory, // ログディレクトリのパスを取得
            log_commands::open_log_directory, // ログディレクトリを開く
            commands::update_menu, // メニュー翻訳を更新
        ])
        // アプリケーション起動時のセットアップ処理
        .setup(|app| {
            use tauri::Manager;

            use tauri::tray::TrayIconBuilder;

            let app_handle = app.handle();

            // メニューバーを作成してセット
            let labels = std::collections::HashMap::new();
            let menu = create_app_menu(app_handle, &labels)?;
            app.set_menu(menu)?;

            // --- システムトレイの構築 ---
            let tray_menu = create_tray_menu(app_handle, &labels)?;

            // トレイアイコンをファイルから読み込み（キャッシュ回避のため）
            // dev環境では失敗する可能性があるため、失敗時はデフォルトアイコンを使用
            let tray_icon = {
                let icon_result = (|| -> Result<tauri::image::Image<'static>, Box<dyn std::error::Error>> {
                    let icon_path = app_handle
                        .path()
                        .resolve("icons/TrayIconTemplate.png", tauri::path::BaseDirectory::Resource)?;
                    
                    let img = image::open(&icon_path)?;
                    let rgba = img.to_rgba8();
                    let (width, height) = rgba.dimensions();
                    Ok(tauri::image::Image::new_owned(rgba.into_raw(), width, height))
                })();

                match icon_result {
                    Ok(icon) => icon,
                    Err(_) => {
                        // フォールバック: デフォルトウィンドウアイコンを使用
                        app.default_window_icon().unwrap().clone()
                    }
                }
            };

            let _tray = TrayIconBuilder::with_id("main")
                .icon(tray_icon)
                .icon_as_template(true)
                .tooltip("ProjectLens")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open_lp" => {
                        use tauri_plugin_opener::OpenerExt;
                        let _ = app.opener().open_url("https://project-lens.netlify.app", None::<&str>);
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(move |tray, event| {
                    use tauri::tray::{TrayIconEvent, MouseButton};
                    match event {
                        TrayIconEvent::Click { button: MouseButton::Left, .. } => {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            // アプリケーションメニューのイベントハンドリング
            app.on_menu_event(|app, event| {
                 match event.id.as_ref() {
                     "about" => {
                        use tauri::Manager;
                        if let Some(window) = app.get_webview_window("about") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        } else {
                            let _ = tauri::WebviewWindowBuilder::new(
                                app,
                                "about",
                                tauri::WebviewUrl::App("about".into()),
                            )
                            .title("About ProjectLens")
                            .inner_size(400.0, 500.0)
                            .resizable(false)
                            .minimizable(false)
                            .maximizable(false)
                            .center()
                            .build();
                        }
                     }
                     "open_lp_menu" => {
                         use tauri_plugin_opener::OpenerExt;
                         let _ = app.opener().open_url("https://project-lens.netlify.app", None::<&str>);
                     }
                     _ => {}
                 }
            });

            // アプリケーションデータディレクトリを取得・作成
            let app_data_dir = app_handle
                .path()
                .app_local_data_dir()
                .expect("failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir).expect("failed to create app data dir");

            // データベースファイルのパスを構築
            // tauri-plugin-sqlと同じパスを使用
            let db_path = app_data_dir.join("projectlens.db");
            let db_url = format!("sqlite:{}", db_path.to_string_lossy());

            // 非同期ランタイムでデータベースクライアントを初期化
            tauri::async_runtime::block_on(async move {
                use sqlx::sqlite::SqliteConnectOptions;
                use std::str::FromStr;

                // SQLite接続オプションを設定（ファイルが存在しない場合は作成）
                let options = SqliteConnectOptions::from_str(&db_url)
                    .expect("failed to parse db url")
                    .create_if_missing(true);

            // データベースクライアントを作成してアプリケーション状態に登録
                let db_client = db::DbClient::new_with_options(options)
                    .await
                    .expect("failed to init db client");
                
                // マイグレーションを実行
                db_client.migrate().await.expect("failed to migrate db");
                
                app_handle.manage(db_client);

                // バックグラウンドスケジューラーを初期化
                // データベース準備完了後に起動
                scheduler::init(app_handle.clone());
                
                // 起動ログを出力（ログファイル生成のため）
                log::info!("Application initialized successfully");
            });

            Ok(())
        })
        // アプリケーションを起動
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use tauri::{AppHandle, menu::{Menu, MenuItem, Submenu, PredefinedMenuItem}};
use std::collections::HashMap;

pub fn create_app_menu(handle: &AppHandle, labels: &HashMap<String, String>) -> tauri::Result<Menu<tauri::Wry>> {
    let get_label = |key: &str, default: &str| -> String {
        labels.get(key).cloned().unwrap_or_else(|| default.to_string())
    };

    // 1. アプリケーションメニュー (ProjectLens)
    // タイトルはmacOSではアプリ名になるが、サブメニュー作成時は指定が必要
    let app_menu = Submenu::new(
        handle,
        "ProjectLens",
        true,
    )?;
    
    // About
    // Custom About menu item to show our own window with icon and link
    app_menu.append(&MenuItem::with_id(
        handle,
        "about",
        &get_label("menu.app.about", "About ProjectLens"),
        true,
        None::<&str>,
    )?)?;
    app_menu.append(&PredefinedMenuItem::separator(handle)?)?;
    app_menu.append(&PredefinedMenuItem::services(
        handle, 
        Some(get_label("menu.app.services", "Services").as_str())
    )?)?;
    app_menu.append(&PredefinedMenuItem::separator(handle)?)?;
    app_menu.append(&PredefinedMenuItem::hide(
        handle, 
        Some(get_label("menu.app.hide", "Hide ProjectLens").as_str())
    )?)?;
    app_menu.append(&PredefinedMenuItem::hide_others(
        handle, 
        Some(get_label("menu.app.hideOthers", "Hide Others").as_str())
    )?)?;
    app_menu.append(&PredefinedMenuItem::show_all(
        handle, 
        Some(get_label("menu.app.showAll", "Show All").as_str())
    )?)?;
    app_menu.append(&PredefinedMenuItem::separator(handle)?)?;
    app_menu.append(&PredefinedMenuItem::quit(
        handle, 
        Some(get_label("menu.app.quit", "Quit ProjectLens").as_str())
    )?)?;

    // 2. 編集メニュー (Edit)
    let edit_menu = Submenu::new(
        handle,
        get_label("menu.edit.label", "Edit"),
        true,
    )?;
    edit_menu.append(&PredefinedMenuItem::undo(
        handle, 
        Some(get_label("menu.edit.undo", "Undo").as_str())
    )?)?;
    edit_menu.append(&PredefinedMenuItem::redo(
        handle, 
        Some(get_label("menu.edit.redo", "Redo").as_str())
    )?)?;
    edit_menu.append(&PredefinedMenuItem::separator(handle)?)?;
    edit_menu.append(&PredefinedMenuItem::cut(
        handle, 
        Some(get_label("menu.edit.cut", "Cut").as_str())
    )?)?;
    edit_menu.append(&PredefinedMenuItem::copy(
        handle, 
        Some(get_label("menu.edit.copy", "Copy").as_str())
    )?)?;
    edit_menu.append(&PredefinedMenuItem::paste(
        handle, 
        Some(get_label("menu.edit.paste", "Paste").as_str())
    )?)?;
    edit_menu.append(&PredefinedMenuItem::select_all(
        handle, 
        Some(get_label("menu.edit.selectAll", "Select All").as_str())
    )?)?;

    // 3. ウィンドウメニュー (Window)
    let window_menu = Submenu::new(
        handle,
        get_label("menu.window.label", "Window"),
        true,
    )?;
    window_menu.append(&PredefinedMenuItem::minimize(
        handle, 
        Some(get_label("menu.window.minimize", "Minimize").as_str())
    )?)?;
    window_menu.append(&PredefinedMenuItem::separator(handle)?)?;
    window_menu.append(&PredefinedMenuItem::close_window(
        handle, 
        Some(get_label("menu.window.close", "Close Window").as_str())
    )?)?;

    // 4. ヘルプメニュー (Help)
    let help_menu = Submenu::new(
        handle,
        get_label("menu.help.label", "Help"),
        true,
    )?;
    help_menu.append(&MenuItem::with_id(
        handle,
        "open_lp_menu",
        &get_label("menu.help.openWebsite", "Open Website"),
        true,
        None::<&str>,
    )?)?;

    Menu::with_items(handle, &[&app_menu, &edit_menu, &window_menu, &help_menu])
}

pub fn create_tray_menu(handle: &AppHandle, labels: &HashMap<String, String>) -> tauri::Result<Menu<tauri::Wry>> {
    let get_label = |key: &str, default: &str| -> String {
        labels.get(key).cloned().unwrap_or_else(|| default.to_string())
    };

    let version = &handle.package_info().version;
    let info_text = format!("ProjectLens v{}", version);

    // Note: info_text is dynamic so probably doesn't need translation currently, 
    // but if we wanted "Version x.x.x" we would need it.

    Menu::with_items(
        handle,
        &[
            &MenuItem::with_id(handle, "app_info", &info_text, false, None::<&str>)?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(
                handle, 
                "open_lp", 
                &get_label("menu.tray.openWebsite", "Open Website"), 
                true, 
                None::<&str>
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(
                handle, 
                "quit", 
                &get_label("menu.tray.quit", "Quit"), 
                true, 
                None::<&str>
            )?,
        ],
    )
}
