use crate::ai::worker::{JOB_TYPE_EMBED, JOB_TYPE_SUMMARIZE};
use crate::backlog::BacklogClient;
use crate::db::DbClient;
use crate::scoring::ScoringService;
use anyhow::Result;
use log::{debug, error, info, warn};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

/// 完了課題コーパスの取り込み期間（月数）を保持する設定キー（`settings` テーブル。FR-V04-003）。
///
/// 未設定時は [`DEFAULT_CORPUS_MONTHS`] を用いる。設定UIから 1〜24 の範囲で更新される想定。
pub const SETTING_CORPUS_MONTHS: &str = "corpus_months";

/// 完了課題コーパス取り込み期間の既定値（月数。FR-V04-003 / 未解決事項#3 既定値）。
///
/// 壁打ちの目安「3〜6ヶ月」のうち、解決ノウハウの取りこぼしを避けるため広めの 6 を既定とする。
const DEFAULT_CORPUS_MONTHS: i64 = 6;

/// レート残量がこの値以下のとき、コメント差分取得・コーパス取り込みをバックオフして次サイクルへ
/// 繰り越す閾値（FR-V04-002 / FR-V04-003 / NFR-V04-002）。
///
/// 通常 sync・スコアリングは阻害しないため、追加のバックグラウンド取得（コメント・コーパス）だけを
/// この閾値で抑制する。Backlog のレートヘッダ（`X-RateLimit-Remaining`）が取れない場合は
/// 取得を許可する（保守的にしすぎて永久に進まないのを避ける）。
const RATE_LIMIT_BACKOFF_THRESHOLD: i64 = 50;

/// 完了課題コーパスのページング取得で1サイクルに辿る最大ページ数（暴走・長時間化の安全弁）。
///
/// 1ページ最大100件なので、1ワークスペース・1サイクルあたり最大 `MAX_CORPUS_PAGES * 100` 件を取り込む。
/// 初回・期間拡大時に大量取得になっても sync が長引きすぎないよう上限を設ける（残りは次サイクル）。
const MAX_CORPUS_PAGES: i64 = 20;

/// 1サイクルでコメント差分取得を行う課題数の上限（レート保護・安全弁。FR-V04-002）。
///
/// 変更課題が大量にあるサイクルでも、コメント取得の API 呼び出し回数を抑える。超過分は
/// 次サイクル以降で拾う（差分検出と embed ジョブの重複抑止により取りこぼさない）。
const MAX_COMMENT_FETCH_PER_CYCLE: usize = 100;

/// コメント差分取得のリトライ上限（FR-V04-002）。
///
/// `issue_comment_state.retry_count` がこの回数に達した課題はスキップして記録し、以降の取得を
/// 試みない（失敗の無限リトライを防ぐ）。
const MAX_COMMENT_RETRIES: i64 = 3;

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
        // 直近のレート残量を保持し、追加のバックグラウンド取得（コーパス・コメント）の
        // バックオフ判定に用いる（FR-V04-002 / FR-V04-003）。取得できなければ None。
        let mut last_remaining: Option<i64> = None;

        for &key in &project_keys {
            // 各プロジェクトの課題を取得
            match client.get_issues(key, &target_status_ids).await {
                Ok((mut project_issues, rate_limit)) => {
                    issues.append(&mut project_issues);
                    synced_projects.push(key.to_string());
                    if rate_limit.remaining.is_some() {
                        last_remaining = rate_limit.remaining;
                    }
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

                    // v0.4: 完了課題コーパスの取り込み・コメント差分取得・埋め込みジョブ投入を行う。
                    // すべて sync・UI を阻害しないバックグラウンド処理で、失敗は本体を止めない
                    // （NFR-V04-002 / NFR-V04-005）。レート残量が少ない場合はバックオフして次サイクルへ。
                    sync_corpus_and_embeddings(
                        &db,
                        &client,
                        workspace.id,
                        &project_keys,
                        &issues,
                        &existing_updated_map,
                        last_remaining,
                    )
                    .await;
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
    let changed_ids = changed_issue_ids(workspace_id, issues, existing_updated_map);

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

/// 新規・更新された課題のIDを抽出する（差分検出の共通ロジック）。
///
/// [`enqueue_changed_issues`]（要約ジョブ投入）と v0.4 のコメント差分取得・埋め込みジョブ投入で
/// 同じ差分判定を使うため共通化する。判定は同期前のDBスナップショット
/// （`existing_updated_map`）との突き合わせ:
/// - スナップショットに無い課題（初回・新規）→ 対象
/// - スナップショットにあり `updated`（最終更新日時）が変化した課題 → 対象
/// - `updated` が変わっていない課題 → 非対象（再処理しない）
///
/// # 引数
/// * `workspace_id` - 対象ワークスペースID
/// * `issues` - 同期して保存した課題のスライス
/// * `existing_updated_map` - 同期前のDBスナップショット `(workspace_id, issue_id) -> updated`
///
/// # 戻り値
/// 新規・更新と判定された課題IDのベクタ
fn changed_issue_ids(
    workspace_id: i64,
    issues: &[crate::backlog::Issue],
    existing_updated_map: &std::collections::HashMap<(i64, i64), Option<String>>,
) -> Vec<i64> {
    issues
        .iter()
        .filter(
            |issue| match existing_updated_map.get(&(workspace_id, issue.id)) {
                Some(prev_updated) => prev_updated != &issue.updated,
                None => true,
            },
        )
        .map(|issue| issue.id)
        .collect()
}

/// 設定値から完了課題コーパスの取り込み期間（月数）を解決する（FR-V04-003）。
///
/// `settings.corpus_months` を読み、1〜24 にクランプする。未設定・パース失敗・取得失敗は
/// いずれも [`DEFAULT_CORPUS_MONTHS`] に倒す（バックグラウンド処理を止めないため非阻害）。
///
/// # 引数
/// * `db` - データベースクライアント
///
/// # 戻り値
/// 取り込み期間（月数。1〜24）
async fn resolve_corpus_months(db: &DbClient) -> i64 {
    let raw = db
        .get_setting(SETTING_CORPUS_MONTHS)
        .await
        .ok()
        .flatten()
        .and_then(|v| v.trim().parse::<i64>().ok())
        .unwrap_or(DEFAULT_CORPUS_MONTHS);
    raw.clamp(1, 24)
}

/// 完了課題コーパスの取り込み・コメント差分取得・埋め込みジョブ投入を行う（v0.4 / FR-V04-002・003・004）。
///
/// 通常 sync 直後にバックグラウンドで実行され、sync・UI をブロックしない（NFR-V04-002）。
/// レート残量が [`RATE_LIMIT_BACKOFF_THRESHOLD`] 以下のときは追加取得をバックオフし、次サイクルへ
/// 繰り越す。いずれの失敗も本体（通常 sync）を止めない（NFR-V04-005）。
///
/// 処理順:
/// 1. 完了課題コーパスを `statusId=4 + updatedSince` で期間ぶんページング取得し
///    `is_corpus_only = true` で保存。期間外の旧コーパスは [`DbClient::cleanup_corpus_out_of_range`] で掃除。
/// 2. 埋め込み未構築なら、コーパス全課題に1回だけコメント全件取得 + embed ジョブ投入（初回ビルド）。
/// 3. 変更課題に対しコメント差分取得（`minId`）→ embed ジョブ投入（要約ジョブと並行）。
///
/// # 引数
/// * `db` - データベースクライアント
/// * `client` - 当該ワークスペースの Backlog クライアント
/// * `workspace_id` - 対象ワークスペースID
/// * `project_keys` - 設定されたプロジェクトキー（コーパス取得対象）
/// * `issues` - 通常 sync で保存した課題（変更検出の元）
/// * `existing_updated_map` - 同期前のDBスナップショット（差分検出用）
/// * `rate_remaining` - 直近のレート残量（`None` なら取得不可・バックオフ判定をスキップ）
#[allow(clippy::too_many_arguments)]
pub(crate) async fn sync_corpus_and_embeddings(
    db: &DbClient,
    client: &BacklogClient,
    workspace_id: i64,
    project_keys: &[&str],
    issues: &[crate::backlog::Issue],
    existing_updated_map: &std::collections::HashMap<(i64, i64), Option<String>>,
    rate_remaining: Option<i64>,
) {
    // レート残量が少ない場合はバックオフし、追加の API 取得を次サイクルへ繰り越す。
    // 通常 sync・スコアリングは既に完了しているため、ここで return しても表示は阻害しない。
    if is_rate_backoff(rate_remaining) {
        warn!(
            "Scheduler: rate remaining low ({rate_remaining:?}) for workspace {workspace_id}, \
             deferring corpus/comment fetch to next cycle."
        );
        return;
    }

    // 埋め込みが1件も構築されていなければ「初回ビルド」とみなす。
    let embeddings_built = match db.count_embeddings(Some(workspace_id)).await {
        Ok(count) => count > 0,
        Err(e) => {
            error!("Scheduler: failed to count embeddings for workspace {workspace_id}: {e}");
            false
        }
    };

    // 1. 完了課題コーパスの取り込み（期間指定・ページング）。
    let months = resolve_corpus_months(db).await;
    let updated_since = corpus_updated_since(months);
    fetch_corpus(db, client, workspace_id, project_keys, &updated_since).await;
    // 期間外（updatedSince より古い）コーパスを掃除する。
    if let Err(e) = db
        .cleanup_corpus_out_of_range(workspace_id, &corpus_oldest_updated(months))
        .await
    {
        error!("Scheduler: corpus cleanup failed for workspace {workspace_id}: {e}");
    }

    // 2. 初回（埋め込み未構築）のみ、コーパス全課題に1回だけコメント全件取得 + embed 投入。
    if !embeddings_built {
        let corpus_ids = db
            .get_corpus_issue_ids(workspace_id)
            .await
            .unwrap_or_else(|e| {
                error!("Scheduler: failed to list corpus issues for workspace {workspace_id}: {e}");
                Vec::new()
            });
        if !corpus_ids.is_empty() {
            fetch_comments_and_enqueue_embed(db, client, workspace_id, &corpus_ids).await;
        }
    }

    // 3. 変更課題のコメント差分取得 + embed ジョブ投入（要約ジョブと並行）。
    let changed_ids = changed_issue_ids(workspace_id, issues, existing_updated_map);
    if !changed_ids.is_empty() {
        fetch_comments_and_enqueue_embed(db, client, workspace_id, &changed_ids).await;
    }
}

/// レート残量からバックオフすべきかを判定する（FR-V04-002 / FR-V04-003）。
///
/// 残量が取得できない（`None`）場合は許可（保守的にしすぎて永久に進まないのを避ける）。
/// 残量が [`RATE_LIMIT_BACKOFF_THRESHOLD`] 以下のときだけバックオフする。
///
/// # 引数
/// * `remaining` - 直近のレート残量
///
/// # 戻り値
/// バックオフすべきなら `true`
fn is_rate_backoff(remaining: Option<i64>) -> bool {
    matches!(remaining, Some(r) if r <= RATE_LIMIT_BACKOFF_THRESHOLD)
}

/// コーパス取得の `updatedSince`（`yyyy-MM-dd`）を月数から算出する（FR-V04-003）。
///
/// 現在日時から概算で `months * 30` 日さかのぼった日付を `yyyy-MM-dd` で返す（Backlog の
/// `updatedSince` は日付粒度）。`chrono` の月跨ぎ計算を避け、決定的な日数換算にする。
///
/// # 引数
/// * `months` - 取り込み期間（月数）
///
/// # 戻り値
/// `updatedSince` に渡す日付文字列（`yyyy-MM-dd`）
fn corpus_updated_since(months: i64) -> String {
    let days = months.max(0) * 30;
    let since = chrono::Utc::now() - chrono::Duration::days(days);
    since.format("%Y-%m-%d").to_string()
}

/// 期間短縮時のクリーンアップ基準（保持する最古の `updated_at`。ISO8601）を算出する（FR-V04-003）。
///
/// [`DbClient::cleanup_corpus_out_of_range`] は `updated_at < oldest_updated` の行を消すため、
/// `updatedSince` と同じ起点を ISO8601（RFC3339）で返す（`updated_at` カラムは ISO8601 文字列）。
///
/// # 引数
/// * `months` - 取り込み期間（月数）
///
/// # 戻り値
/// 保持する最古の更新日時（RFC3339 文字列）
fn corpus_oldest_updated(months: i64) -> String {
    let days = months.max(0) * 30;
    let oldest = chrono::Utc::now() - chrono::Duration::days(days);
    oldest.to_rfc3339()
}

/// 完了課題コーパスをページング取得して保存する（FR-V04-003）。
///
/// 各プロジェクトについて `get_closed_issues` を `offset` を 100 ずつ進めて呼び、`is_corpus_only = true`
/// の課題を `save_issues`（コーパスバッチ）で保存する。1サイクルのページ数は [`MAX_CORPUS_PAGES`] を
/// 上限とし（残りは次サイクル）、取得失敗はログに記録して次プロジェクトへ進む（非阻害）。
///
/// コーパスバッチの `save_issues` はプロジェクト単位の破壊的クリーンアップを行わないため、
/// `synced_project_keys` / `all_project_keys` は空スライスで渡してよい（保持・除去は
/// `cleanup_corpus_out_of_range` が担う）。
///
/// # 引数
/// * `db` - データベースクライアント
/// * `client` - Backlog クライアント
/// * `workspace_id` - 対象ワークスペースID
/// * `project_keys` - 取得対象プロジェクトキー
/// * `updated_since` - `updatedSince`（`yyyy-MM-dd`）
async fn fetch_corpus(
    db: &DbClient,
    client: &BacklogClient,
    workspace_id: i64,
    project_keys: &[&str],
    updated_since: &str,
) {
    for &key in project_keys {
        let mut offset = 0i64;
        for _ in 0..MAX_CORPUS_PAGES {
            match client
                .get_closed_issues(key, Some(updated_since), offset)
                .await
            {
                Ok((mut page, _rate)) => {
                    if page.is_empty() {
                        break; // このプロジェクトは取り切った。
                    }
                    let fetched = page.len();
                    for issue in &mut page {
                        issue.workspace_id = workspace_id;
                        // get_closed_issues 側で is_corpus_only=true 済みだが、念のため明示。
                        issue.is_corpus_only = true;
                    }
                    // コーパスバッチは破壊的クリーンアップを行わないため空キーで保存する。
                    if let Err(e) = db.save_issues(workspace_id, &page, &[], &[]).await {
                        error!(
                            "Scheduler: failed to save corpus issues for {key} (ws {workspace_id}): {e}"
                        );
                        break;
                    }
                    if (fetched as i64) < 100 {
                        break; // 最終ページ（100件未満）。
                    }
                    offset += 100;
                }
                Err(e) => {
                    error!(
                        "Scheduler: failed to fetch closed issues for {key} (ws {workspace_id}, \
                         offset {offset}): {e}"
                    );
                    break;
                }
            }
        }
    }
}

/// 指定課題群のコメント差分を取得して保存し、埋め込みジョブを投入する（FR-V04-002 / FR-V04-004）。
///
/// 各課題について:
/// 1. `issue_comment_state` から最終取得コメントID・リトライ回数を読む。
///    リトライ上限（[`MAX_COMMENT_RETRIES`]）に達した課題はスキップして記録する。
/// 2. `get_comments(min_id)` で新規コメントのみ取得し、`save_comments` で保存。
///    最大コメントIDを次回 `minId` 起点として `set_comment_state(status="done")` に記録。
/// 3. 取得失敗時は `retry_count + 1`・`status="failed"` を記録して次課題へ（本体は止めない）。
/// 4. embed ジョブを `enqueue_jobs` で投入（要約ジョブと並行。重複は DB 側で抑止）。
///
/// 1サイクルの処理課題数は [`MAX_COMMENT_FETCH_PER_CYCLE`] を上限とし、超過分は次サイクルへ繰り越す。
///
/// # 引数
/// * `db` - データベースクライアント
/// * `client` - Backlog クライアント
/// * `workspace_id` - 対象ワークスペースID
/// * `issue_ids` - コメント取得・埋め込み対象の課題ID
async fn fetch_comments_and_enqueue_embed(
    db: &DbClient,
    client: &BacklogClient,
    workspace_id: i64,
    issue_ids: &[i64],
) {
    let mut embed_targets: Vec<i64> = Vec::new();

    for &issue_id in issue_ids.iter().take(MAX_COMMENT_FETCH_PER_CYCLE) {
        // 1. 取得状態（最終ID・リトライ回数）を読む。
        let (last_id, _status, retry_count) = match db
            .get_comment_state(workspace_id, issue_id)
            .await
        {
            Ok(state) => state,
            Err(e) => {
                error!("Scheduler: failed to read comment state ({workspace_id},{issue_id}): {e}");
                continue;
            }
        };

        if retry_count >= MAX_COMMENT_RETRIES {
            // リトライ上限到達。コメント取得は諦めるが、埋め込み自体は本文・タイトルで実施できるため
            // embed ジョブの投入対象には残す。
            warn!(
                "Scheduler: comment fetch skipped for issue {issue_id} (ws {workspace_id}) \
                 after {retry_count} retries."
            );
            embed_targets.push(issue_id);
            continue;
        }

        // 2. 差分取得（minId より大きい新規コメントのみ）。
        match client.get_comments(&issue_id.to_string(), last_id).await {
            Ok((comments, _rate)) => {
                // 取得した中の最大コメントIDを次回 minId 起点にする（無ければ従来値を維持）。
                let max_id = comments.iter().map(|c| c.comment_id).max().or(last_id);
                if let Err(e) = db.save_comments(workspace_id, issue_id, &comments).await {
                    error!("Scheduler: failed to save comments ({workspace_id},{issue_id}): {e}");
                }
                if let Err(e) = db
                    .set_comment_state(workspace_id, issue_id, max_id, "done", 0)
                    .await
                {
                    error!(
                        "Scheduler: failed to update comment state ({workspace_id},{issue_id}): {e}"
                    );
                }
            }
            Err(e) => {
                // 取得失敗。retry_count++ で状態を記録し、上限到達ならスキップ扱いになる。
                warn!(
                    "Scheduler: comment fetch failed for issue {issue_id} (ws {workspace_id}): {e}"
                );
                let _ = db
                    .set_comment_state(workspace_id, issue_id, last_id, "failed", retry_count + 1)
                    .await;
            }
        }

        // 4. 埋め込み対象に追加（コメント取得の成否に関わらず embed は試みる）。
        embed_targets.push(issue_id);
    }

    if embed_targets.is_empty() {
        return;
    }

    match db
        .enqueue_jobs(workspace_id, &embed_targets, JOB_TYPE_EMBED)
        .await
    {
        Ok(count) if count > 0 => info!(
            "Scheduler: Enqueued {count} embed job(s) for workspace {workspace_id} \
             ({} target issue(s)).",
            embed_targets.len()
        ),
        Ok(_) => {}
        Err(e) => {
            error!("Scheduler: failed to enqueue embed jobs for workspace {workspace_id}: {e}")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backlog::Issue;
    use std::collections::HashMap;

    /// 差分検出用のダミー課題を作る（差分判定に必要なフィールドのみ設定）。
    fn issue(id: i64, updated: Option<&str>) -> Issue {
        Issue {
            id,
            issue_key: format!("PROJ-{id}"),
            summary: String::new(),
            description: None,
            priority: None,
            status: None,
            issue_type: None,
            assignee: None,
            due_date: None,
            updated: updated.map(|s| s.to_string()),
            relevance_score: 0,
            workspace_id: 1,
            ai_summary: None,
            ai_risk_level: None,
            ai_suggestion: None,
            ai_delay_days: None,
            ai_processed_at: None,
            is_corpus_only: false,
            embedding_ready: false,
        }
    }

    #[test]
    fn rate_backoff_only_when_remaining_at_or_below_threshold() {
        // 残量不明は許可（バックオフしない）。
        assert!(!is_rate_backoff(None));
        // 閾値ちょうど・以下はバックオフ。
        assert!(is_rate_backoff(Some(RATE_LIMIT_BACKOFF_THRESHOLD)));
        assert!(is_rate_backoff(Some(0)));
        // 閾値超はバックオフしない。
        assert!(!is_rate_backoff(Some(RATE_LIMIT_BACKOFF_THRESHOLD + 1)));
    }

    #[test]
    fn changed_ids_detects_new_and_updated_only() {
        let mut snapshot: HashMap<(i64, i64), Option<String>> = HashMap::new();
        // 既存・未更新（同一 updated）→ 対象外
        snapshot.insert((1, 10), Some("2026-06-01".to_string()));
        // 既存・更新あり（updated 変化）→ 対象
        snapshot.insert((1, 11), Some("2026-06-01".to_string()));

        let issues = vec![
            issue(10, Some("2026-06-01")), // 変化なし
            issue(11, Some("2026-06-02")), // 変化あり
            issue(12, Some("2026-06-03")), // 新規（スナップショットに無い）
        ];
        let mut ids = changed_issue_ids(1, &issues, &snapshot);
        ids.sort_unstable();
        assert_eq!(ids, vec![11, 12]);
    }

    #[test]
    fn corpus_updated_since_is_date_format() {
        // yyyy-MM-dd 形式（Backlog updatedSince の粒度）で返る。
        let s = corpus_updated_since(6);
        assert_eq!(s.len(), 10);
        assert_eq!(s.matches('-').count(), 2);
        // 6ヶ月前は現在より過去。
        assert!(s < chrono::Utc::now().format("%Y-%m-%d").to_string());
    }

    #[tokio::test]
    async fn resolve_corpus_months_clamps_and_defaults() {
        use sqlx::sqlite::SqliteConnectOptions;
        use std::str::FromStr;

        let options = SqliteConnectOptions::from_str("sqlite::memory:").unwrap();
        let db = DbClient::new_with_options(options).await.unwrap();
        db.migrate().await.unwrap();

        // 未設定 → 既定値。
        assert_eq!(resolve_corpus_months(&db).await, DEFAULT_CORPUS_MONTHS);

        // 範囲内はそのまま。
        db.save_setting(SETTING_CORPUS_MONTHS, "3").await.unwrap();
        assert_eq!(resolve_corpus_months(&db).await, 3);

        // 上限超はクランプ。
        db.save_setting(SETTING_CORPUS_MONTHS, "100").await.unwrap();
        assert_eq!(resolve_corpus_months(&db).await, 24);

        // 下限未満はクランプ。
        db.save_setting(SETTING_CORPUS_MONTHS, "0").await.unwrap();
        assert_eq!(resolve_corpus_months(&db).await, 1);

        // パース不能は既定値。
        db.save_setting(SETTING_CORPUS_MONTHS, "abc").await.unwrap();
        assert_eq!(resolve_corpus_months(&db).await, DEFAULT_CORPUS_MONTHS);
    }
}
