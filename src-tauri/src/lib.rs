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
    let migrations = db::get_migrations();

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        // 通知プラグインを初期化（システムトレイ通知用）
        .plugin(tauri_plugin_notification::init())
        // Shellプラグインを初期化（ブラウザでURLを開く用）
        .plugin(tauri_plugin_shell::init())
        // HTTPプラグインを初期化（Backlog API通信用）
        .plugin(tauri_plugin_http::init())
        // ログプラグインを初期化（デバッグ・エラーログ用）
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        // SQLプラグインを初期化（データベースマイグレーション実行）
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:projectlens.db", migrations)
                .build(),
        )
        // フロントエンドから呼び出せるコマンドを登録
        .invoke_handler(tauri::generate_handler![
            commands::greet,          // テスト用挨拶コマンド
            commands::save_settings,  // 設定保存
            commands::get_settings,   // 設定取得
            commands::fetch_issues,   // Backlogから課題を取得してスコアリング
            commands::fetch_projects, // Backlogからプロジェクト一覧を取得
            commands::get_issues      // 保存済み課題一覧を取得
        ])
        // アプリケーション起動時のセットアップ処理
        .setup(|app| {
            use tauri::Manager;
            let app_handle = app.handle();

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
