use tauri::{AppHandle, Manager};
use crate::db::DbClient;
use crate::backlog::BacklogClient;
use crate::scoring::ScoringService;
use tauri_plugin_notification::NotificationExt;
use std::time::Duration;

/// バックグラウンドスケジューラーを初期化
/// 
/// アプリケーション起動時に呼び出され、バックグラウンドで定期的に
/// Backlogから課題を同期し、高スコアの課題があれば通知を送る。
/// 
/// 実行タイミング：
/// - 初回: アプリ起動10秒後
/// - 以降: 5分ごと
/// 
/// # 引数
/// * `app` - Tauriアプリケーションハンドル
pub fn init(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        println!("Scheduler started");
        
        loop {
            // 初回は30秒待機（データベース初期化とアプリ起動を待つ）
            tokio::time::sleep(Duration::from_secs(30)).await;
            
            println!("Scheduler: Starting sync...");
            if let Err(e) = sync_and_notify(&app).await {
                eprintln!("Scheduler error: {}", e);
            }
            
            // 次回は5分後（300秒）
            tokio::time::sleep(Duration::from_secs(300)).await;
        }
    });
}

/// 同期と通知を実行
/// 
/// 以下の処理を順に実行する：
/// 1. データベースから設定を取得
/// 2. Backlog APIから課題を取得
/// 3. 現在のユーザー情報を取得
/// 4. 各課題のスコアを計算
/// 5. 高スコア（80点以上）の課題を抽出
/// 6. 課題をデータベースに保存
/// 7. 高スコア課題があれば通知を表示
/// 
/// # 引数
/// * `app` - Tauriアプリケーションハンドル
/// 
/// # 戻り値
/// 成功時は`Ok(())`、失敗時はエラーメッセージ
async fn sync_and_notify(app: &AppHandle) -> Result<(), String> {
    // データベースクライアントを取得
    let db = app.state::<DbClient>();
    
    // 1. 設定を取得
    let domain = db.get_setting("domain").await.map_err(|e| e.to_string())?
        .ok_or("Domain not set")?;
    let api_key = db.get_setting("api_key").await.map_err(|e| e.to_string())?
        .ok_or("API Key not set")?;
    let project_key = db.get_setting("project_key").await.map_err(|e| e.to_string())?
        .ok_or("Project Key not set")?;

    // 2. Backlog APIから課題を取得してスコアリング
    let client = BacklogClient::new(&domain, &api_key);
    let mut issues = client.get_issues(&project_key).await.map_err(|e| e.to_string())?;
    let me = client.get_myself().await.map_err(|e| e.to_string())?;
    
    // 高スコア課題のリスト（通知用）
    let mut high_score_issues = Vec::new();

    // 各課題のスコアを計算
    for issue in &mut issues {
        let score = ScoringService::calculate_score(issue, &me);
        issue.relevance_score = score;
        
        // スコアが80点以上の課題を記録
        if score >= 80 {
            high_score_issues.push(format!("{} ({})", issue.summary, score));
        }
    }
    
    // 3. データベースに保存
    db.save_issues(&issues).await.map_err(|e| e.to_string())?;
    
    // 4. 高スコア課題があれば通知
    if !high_score_issues.is_empty() {
        let body = if high_score_issues.len() == 1 {
            // 1件の場合は課題名とスコアを表示
            format!("High priority issue: {}", high_score_issues[0])
        } else {
            // 複数件の場合は件数のみ表示
            format!("{} high priority issues found.", high_score_issues.len())
        };

        // システム通知を表示
        let _ = app.notification()
            .builder()
            .title("ProjectLens Alert")
            .body(body)
            .show();
    }
    
    println!("Scheduler: Sync complete. {} issues processed.", issues.len());

    Ok(())
}
