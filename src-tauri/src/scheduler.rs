use tauri::{AppHandle, Manager, Emitter};
use log::{info, error, debug};
use crate::db::DbClient;
use crate::backlog::BacklogClient;
use crate::scoring::ScoringService;
use anyhow::Result;
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
        let mut interval = tokio::time::interval(Duration::from_secs(60 * 5)); // 5分ごとに実行

        loop {
            interval.tick().await;
            info!("Scheduler: Starting sync...");
            
            if let Err(e) = sync_and_notify(&app).await {
                error!("Scheduler: Sync failed: {}", e);
            }
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
async fn sync_and_notify(app: &AppHandle) -> Result<()> {
    // データベースクライアントを取得
    let db = app.state::<DbClient>();
    
    // 1. 設定を取得
    let domain = db.get_setting("domain").await?.ok_or(anyhow::anyhow!("Domain not set"))?;
    let api_key = db.get_setting("api_key").await?.ok_or(anyhow::anyhow!("API Key not set"))?;
    let project_key = db.get_setting("project_key").await?.ok_or(anyhow::anyhow!("Project Key not set"))?;

    // 2. Backlog APIから課題を取得してスコアリング
    let client = BacklogClient::new(&domain, &api_key);
    
    // 取得対象のステータスID（未対応:1, 処理中:2, 処理済み:3）
    // 完了(4)は除外する
    let target_status_ids = vec![1, 2, 3];
    
    // プロジェクトキー（カンマ区切り）を分割して処理
    let project_keys: Vec<&str> = project_key.split(',').map(|k| k.trim()).filter(|k| !k.is_empty()).collect();
    let mut issues = Vec::new();

    for key in project_keys {
        // 各プロジェクトの課題を取得
        match client.get_issues(key, &target_status_ids).await {
            Ok(mut project_issues) => issues.append(&mut project_issues),
            Err(e) => error!("Failed to fetch issues for project {}: {}", key, e),
        }
    }
    let me = client.get_myself().await.map_err(|e| anyhow::anyhow!("{}", e))?;
    
    // 既存の課題IDとスコアを取得（通知判定用）
    let existing_issues = db.get_issues().await?;
    let mut existing_issue_map = std::collections::HashMap::new();
    for issue in existing_issues {
        existing_issue_map.insert(issue.id, issue.relevance_score);
    }

    // 高スコア課題のリスト（通知用）
    let mut new_high_score_issues = Vec::new();

    // 各課題のスコアを計算
    for issue in &mut issues {
        let score = ScoringService::calculate_score(issue, &me);
        issue.relevance_score = score;
        
        // デバッグログ: スコア計算結果
        debug!("Issue {} ({}): Score {}", issue.issue_key, issue.summary, score);
        
        // スコアが80点以上の課題をチェック
        if score >= 80 {
            let should_notify = match existing_issue_map.get(&issue.id) {
                Some(&old_score) => {
                    // 既存の課題: 以前は80点未満だった場合のみ通知
                    old_score < 80
                },
                None => {
                    // 新規の課題: 無条件で通知
                    true
                }
            };

            if should_notify {
                info!("-> Notification target: {}", issue.issue_key);
                new_high_score_issues.push(format!("{} ({})", issue.summary, score));
            }
        }
    }
    
    // 3. データベースに保存
    db.save_issues(&issues).await?;
    
    // 4. 新しい高スコア課題があれば通知
    if !new_high_score_issues.is_empty() {
        let body = if new_high_score_issues.len() == 1 {
            // 1件の場合は課題名とスコアを表示
            format!("New high priority issue: {}", new_high_score_issues[0])
        } else {
            // 複数件の場合は件数のみ表示
            format!("{} new high priority issues found.", new_high_score_issues.len())
        };

        info!("Sending notification: {}", body);

        // macOSのシステムサウンドを再生
        #[cfg(target_os = "macos")]
        {
            let _ = std::process::Command::new("afplay")
                .arg("/System/Library/Sounds/Glass.aiff")
                .spawn();
        }

        // システム通知を表示
        match app.notification()
            .builder()
            .title("ProjectLens Alert")
            .body(&body)
            .show() {
            Ok(_) => info!("Notification sent successfully"),
            Err(e) => error!("Failed to send notification: {}", e),
        }
    }
    
    // フロントエンドに更新通知を送る（現在時刻を付与）
    let now = chrono::Local::now().format("%H:%M").to_string();
    let _ = app.emit("refresh-issues", now);
    
    info!("Scheduler: Sync complete. {} issues processed.", issues.len());

    Ok(())
}
