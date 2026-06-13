use crate::ai::worker::JOB_TYPE_SUMMARIZE;
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
                error!("Scheduler: Sync failed: {e}");
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
    // あわせて updated_at を保持し、AIジョブ投入の差分検出（新規・更新分のみ）に流用する。
    let existing_issues = db.get_issues().await?;
    let mut existing_issue_map = std::collections::HashMap::new();
    let mut existing_updated_map: std::collections::HashMap<(i64, i64), Option<String>> =
        std::collections::HashMap::new();
    for issue in existing_issues {
        existing_issue_map.insert((issue.workspace_id, issue.id), issue.relevance_score);
        existing_updated_map.insert((issue.workspace_id, issue.id), issue.updated.clone());
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
                Ok((mut project_issues, _rate_limit)) => {
                    issues.append(&mut project_issues);
                    synced_projects.push(key.to_string());
                }
                Err(e) => {
                    log::error!("Failed to fetch issues for project {key}: {e}");
                }
            }
        }

        // ユーザー情報取得
        let me = match client.get_myself().await {
            Ok(me) => me,
            Err(e) => {
                error!("Failed to get myself for {domain}: {e}");
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
        // Vec<String> を Vec<&str> に変換
        let synced_projects_refs: Vec<&str> = synced_projects.iter().map(|s| s.as_str()).collect();

        match db
            .save_issues(workspace.id, &issues, &synced_projects_refs, &project_keys)
            .await
        {
            Ok(()) => {
                // 4. 保存成功後、新規・更新チケットをAIジョブとしてキュー投入する（FR-V03-004）。
                // 無効ワークスペースは投入対象外（scheduler は sync 自体は enabled を見ないため、
                // ここでジョブ投入のみ enabled で絞る）。
                if workspace.enabled {
                    enqueue_changed_issues(&db, workspace.id, &issues, &existing_updated_map).await;
                }
            }
            Err(e) => {
                error!("Failed to save issues for workspace {domain}: {e}");
            }
        }
    }

    // トレイのツールチップを更新
    let high_priority_count = all_issues_for_tooltip
        .iter()
        .filter(|i| i.relevance_score >= 80)
        .count();

    // 言語設定を取得（デフォルトは日本語）
    let lang = db
        .get_setting("language")
        .await?
        .unwrap_or_else(|| "ja".to_string());

    if let Some(tray) = app.tray_by_id("main") {
        let tooltip = if high_priority_count > 0 {
            if lang == "ja" {
                format!("ProjectLens: 重要なチケットが {high_priority_count} 件あります")
            } else {
                format!("ProjectLens: {high_priority_count} important tickets")
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
                format!(
                    "{}件の新しい重要な課題が見つかりました。",
                    new_high_score_issues.len()
                )
            };
            (title, body)
        } else {
            let title = "ProjectLens Alert";
            let body = if new_high_score_issues.len() == 1 {
                format!("New high priority issue: {}", new_high_score_issues[0])
            } else {
                format!(
                    "{} new high priority issues found.",
                    new_high_score_issues.len()
                )
            };
            (title, body)
        };

        info!("Sending notification: {body}");

        // macOSのシステムサウンドを再生
        #[cfg(target_os = "macos")]
        {
            let _ = std::process::Command::new("afplay")
                .arg("/System/Library/Sounds/Glass.aiff")
                .spawn();
        }

        // システム通知を表示
        match app.notification().builder().title(title).body(&body).show() {
            Ok(_) => info!("Notification sent successfully"),
            Err(e) => error!("Failed to send notification: {e}"),
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

/// 同期した課題のうち、新規・更新分をAIジョブとしてキューに投入する（FR-V03-004）。
///
/// 差分検出は同期前のDBスナップショット（`existing_updated_map`）と突き合わせて行う:
/// - スナップショットに無い課題（初回・新規）→ 投入対象
/// - スナップショットにあり `updated`（最終更新日時）が変化した課題 → 投入対象
/// - `updated` が変わっていない課題 → スキップ（再分析しない）
///
/// 初回同期（DBに当該ワークスペースの課題が無い状態）では全件が新規として投入される。
/// 重複した `pending` ジョブの抑止は [`DbClient::enqueue_jobs`] 側で行うため、ここでは
/// 投入候補のIDを集めて一括で渡す。ジョブ種別は 1行要約+リスク+提案の
/// [`JOB_TYPE_SUMMARIZE`] を用いる。
///
/// 投入失敗は本体（同期）を止めず、エラーログに記録するだけにとどめる（非阻害方針）。
/// 呼び出し側で無効ワークスペースを除外している前提のため、本関数は enabled を判定しない。
///
/// # 引数
/// * `db` - データベースクライアント
/// * `workspace_id` - 対象ワークスペースID
/// * `issues` - 同期して保存した課題のスライス（このワークスペース分）
/// * `existing_updated_map` - 同期前のDBスナップショット `(workspace_id, issue_id) -> updated`
pub(crate) async fn enqueue_changed_issues(
    db: &DbClient,
    workspace_id: i64,
    issues: &[crate::backlog::Issue],
    existing_updated_map: &std::collections::HashMap<(i64, i64), Option<String>>,
) {
    // 新規（マップ未登録）または updated が変化した課題のIDを抽出する。
    let changed_ids: Vec<i64> = issues
        .iter()
        .filter(
            |issue| match existing_updated_map.get(&(workspace_id, issue.id)) {
                // 既存課題: 最終更新日時が変わっていれば更新分として対象にする。
                Some(prev_updated) => prev_updated != &issue.updated,
                // 未登録の課題: 初回・新規として無条件に対象にする。
                None => true,
            },
        )
        .map(|issue| issue.id)
        .collect();

    if changed_ids.is_empty() {
        return;
    }

    match db
        .enqueue_jobs(workspace_id, &changed_ids, JOB_TYPE_SUMMARIZE)
        .await
    {
        Ok(count) => {
            if count > 0 {
                info!(
                    "Scheduler: Enqueued {count} AI job(s) for workspace {workspace_id} \
                     ({} changed issue(s) detected).",
                    changed_ids.len()
                );
            }
        }
        Err(e) => error!("Scheduler: Failed to enqueue AI jobs for workspace {workspace_id}: {e}"),
    }
}
