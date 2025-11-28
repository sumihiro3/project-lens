use crate::backlog::BacklogClient;
use crate::db::DbClient;
use crate::scoring::ScoringService;
use anyhow::Result;
use log::{debug, error, info};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

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

    // 1. ワークスペース一覧を取得
    let workspaces = db.get_workspaces().await?;
    
    if workspaces.is_empty() {
        info!("Scheduler: No workspaces configured.");
        return Ok(());
    }

    // 既存の課題IDとスコアを取得（通知判定用）
    let existing_issues = db.get_issues().await?;
    let mut existing_issue_map = std::collections::HashMap::new();
    for issue in existing_issues {
        existing_issue_map.insert((issue.workspace_id, issue.id), issue.relevance_score);
    }

    let mut all_issues_for_tooltip = Vec::new();
    let mut new_high_score_issues = Vec::new();

    for workspace in workspaces {
        let domain = workspace.domain;
        let api_key = workspace.api_key;
        let project_key = workspace.project_keys;

        // 2. Backlog APIから課題を取得してスコアリング
        let client = BacklogClient::new(&domain, &api_key);

        // 取得対象のステータスID（未対応:1, 処理中:2, 処理済み:3）
        let target_status_ids = vec![1, 2, 3];

        // プロジェクトキー（カンマ区切り）を分割して処理
        let project_keys: Vec<&str> = project_key
            .split(',')
            .map(|k| k.trim())
            .filter(|k| !k.is_empty())
            .collect();
        let mut issues = Vec::new();
        let mut synced_projects = Vec::new();

        for &key in &project_keys {
            // 各プロジェクトの課題を取得
            match client.get_issues(key, &target_status_ids).await {
                Ok(mut project_issues) => {
                    issues.append(&mut project_issues);
                    synced_projects.push(key);
                }
                Err(e) => error!("Failed to fetch issues for project {}: {}", key, e),
            }
        }
        
        // ユーザー情報取得
        let me = match client.get_myself().await {
            Ok(me) => me,
            Err(e) => {
                error!("Failed to get myself for {}: {}", domain, e);
                continue;
            }
        };

        // 各課題のスコアを計算
        for issue in &mut issues {
            let score = ScoringService::calculate_score(issue, &me);
            issue.relevance_score = score;
            issue.workspace_id = workspace.id;

            // デバッグログ: スコア計算結果
            debug!(
                "Issue {} ({}): Score {}",
                issue.issue_key, issue.summary, score
            );

            // スコアが80点以上の課題をチェック
            if score >= 80 {
                let should_notify = match existing_issue_map.get(&(workspace.id, issue.id)) {
                    Some(&old_score) => {
                        // 既存の課題: 以前は80点未満だった場合のみ通知
                        old_score < 80
                    }
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
        
        all_issues_for_tooltip.append(&mut issues.clone());

        // 3. データベースに保存
        if let Err(e) = db.save_issues(workspace.id, &issues, &synced_projects, &project_keys).await {
             error!("Failed to save issues for workspace {}: {}", domain, e);
        }
    }

    // トレイのツールチップを更新
    let high_priority_count = all_issues_for_tooltip.iter().filter(|i| i.relevance_score >= 80).count();
    
    // 言語設定を取得（デフォルトは日本語）
    let lang = db.get_setting("language").await?.unwrap_or_else(|| "ja".to_string());
    
    if let Some(tray) = app.tray_by_id("main") {
        let tooltip = if high_priority_count > 0 {
            if lang == "ja" {
                format!("ProjectLens: 重要なチケットが {} 件あります", high_priority_count)
            } else {
                format!("ProjectLens: {} important tickets", high_priority_count)
            }
        } else {
            "ProjectLens".to_string()
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }

    // 4. 新しい高スコア課題があれば通知
    if !new_high_score_issues.is_empty() {
        let (title, body) = if lang == "ja" {
            let title = "ProjectLens 通知";
            let body = if new_high_score_issues.len() == 1 {
                format!("新しい重要な課題: {}", new_high_score_issues[0])
            } else {
                format!("{}件の新しい重要な課題が見つかりました。", new_high_score_issues.len())
            };
            (title, body)
        } else {
            let title = "ProjectLens Alert";
            let body = if new_high_score_issues.len() == 1 {
                format!("New high priority issue: {}", new_high_score_issues[0])
            } else {
                format!("{} new high priority issues found.", new_high_score_issues.len())
            };
            (title, body)
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
        match app
            .notification()
            .builder()
            .title(title)
            .body(&body)
            .show()
        {
            Ok(_) => info!("Notification sent successfully"),
            Err(e) => error!("Failed to send notification: {}", e),
        }
    }

    // フロントエンドに更新通知を送る（現在時刻を付与）
    let now = chrono::Local::now().format("%H:%M").to_string();
    let _ = app.emit("refresh-issues", now);

    info!(
        "Scheduler: Sync complete. {} issues processed.",
        all_issues_for_tooltip.len()
    );

    Ok(())
}
