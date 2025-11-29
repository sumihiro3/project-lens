// モジュール宣言
mod backlog; // Backlog APIクライアント
mod commands; // Tauriコマンド（フロントエンドから呼び出される関数）
mod db; // データベースクライアント
mod scheduler; // バックグラウンドスケジューラー
mod scoring; // スコアリングサービス

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
            commands::delete_workspace // ワークスペースを削除
        ])
        // アプリケーション起動時のセットアップ処理
        .setup(|app| {
            use tauri::Manager;
            use tauri::menu::{Menu, MenuItem, Submenu, PredefinedMenuItem};
            use tauri::tray::TrayIconBuilder;

            let app_handle = app.handle();

            // --- メニューの構築 ---
            // 1. アプリケーションメニュー (ProjectLens)
            let app_menu = Submenu::new(
                app_handle,
                "ProjectLens",
                true,
            )?;
            // 標準的な項目を追加（About, Services, Hide, Quitなど）
            // Note: PredefinedMenuItemを使うとOS標準の挙動が得られる
            app_menu.append(&PredefinedMenuItem::about(app_handle, None, None)?)?;
            app_menu.append(&PredefinedMenuItem::separator(app_handle)?)?;
            app_menu.append(&PredefinedMenuItem::services(app_handle, None)?)?;
            app_menu.append(&PredefinedMenuItem::separator(app_handle)?)?;
            app_menu.append(&PredefinedMenuItem::hide(app_handle, None)?)?;
            app_menu.append(&PredefinedMenuItem::hide_others(app_handle, None)?)?;
            app_menu.append(&PredefinedMenuItem::show_all(app_handle, None)?)?;
            app_menu.append(&PredefinedMenuItem::separator(app_handle)?)?;
            app_menu.append(&PredefinedMenuItem::quit(app_handle, None)?)?;

            // 2. 編集メニュー (Edit) - コピー＆ペースト用
            let edit_menu = Submenu::with_items(
                app_handle,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app_handle, None)?,
                    &PredefinedMenuItem::redo(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::cut(app_handle, None)?,
                    &PredefinedMenuItem::copy(app_handle, None)?,
                    &PredefinedMenuItem::paste(app_handle, None)?,
                    &PredefinedMenuItem::select_all(app_handle, None)?,
                ],
            )?;

            // 3. ウィンドウメニュー (Window)
            let window_menu = Submenu::with_items(
                app_handle,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::close_window(app_handle, None)?,
                ],
            )?;

            // メニューバーを作成してセット
            let menu = Menu::with_items(app_handle, &[&app_menu, &edit_menu, &window_menu])?;
            app.set_menu(menu)?;

            // --- システムトレイの構築 ---
            let version = &app.package_info().version;
            let info_text = format!("ProjectLens v{}", version);

            let tray_menu = Menu::with_items(
                app_handle,
                &[
                    &MenuItem::with_id(app_handle, "app_info", &info_text, false, None::<&str>)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &MenuItem::with_id(app_handle, "open_lp", "Open Website", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &MenuItem::with_id(app_handle, "quit", "Quit", true, None::<&str>)?,
                ],
            )?;

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
            });

            Ok(())
        })
        // アプリケーションを起動
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
