use crate::backlog::BacklogClient;
use crate::db::{DbClient, WorkspaceInput};
use serde::Serialize;
use tauri::State;

/// 類似検索で返す上位件数の既定値（FR-V04-005 / 未解決事項#4）。
///
/// 課題起点の類似検索 UI で1回に表示する上位N件の既定上限。フロントから `limit` を
/// 指定可能だが、未指定（`None`）時はこの値を用いる。未解決事項#4（上位N・しきい値・
/// 重み付けの調整）の暫定既定であり、実運用での見え方に応じて調整する。
const DEFAULT_SIMILAR_LIMIT: usize = 10;

/// 類似とみなすコサイン類似度の下限しきい値（FR-V04-005 / 未解決事項#4）。
///
/// このしきい値未満の課題は「類似」とみなさず結果から除外する。v0.4 既定の `NLContextualEmbedding`
/// は無関係な文どうしでも 0.65〜0.71 前後の高めの値が出やすい（実測）一方、類似文は 0.81〜0.85 に
/// 寄るため、両者を分離する 0.80 を暫定既定とする。主たる絞り込みは [`DEFAULT_SIMILAR_LIMIT`] の
/// top-N ランキングであり、本しきい値はその下限フロア。未解決事項#4（しきい値の調整）として実データで調整する。
const SIMILARITY_THRESHOLD: f32 = 0.80;

/// 解決策要約（FR-V04-005）で context として渡す類似課題の最大件数。
///
/// `summarize_solutions` は類似上位群を入力にするが、FoundationModels のコンテキスト上限に
/// 収めるため、上位からこの件数までに絞る。完了課題（解決済み）を優先的に含めるため、
/// 入力前に完了課題を前方へ並べ替えてから先頭 N 件を採用する（下記コマンド参照）。
const SUMMARIZE_MAX_ISSUES: usize = 5;

/// 解決策要約の context に含める「1課題あたり」の本文先頭文字数。
///
/// 複数課題を結合するため、課題1件の analyze（[`crate::ai::CONTEXT_BODY_MAX_CHARS`]）より
/// 短く取り、全体がコンテキスト上限を超えないようにする。`get_issue_analysis_fields` の
/// SQL 側 substr に渡す。
const SUMMARIZE_BODY_MAX_CHARS: i64 = 400;

/// 解決策要約の context に含める「1課題あたり」のコメント先頭文字数。
///
/// 解決の経緯はコメントに現れやすいため本文と同程度に確保するが、全体のコンテキスト上限を
/// 守るため控えめにする。`get_comments_text` の切り詰めに渡す。
const SUMMARIZE_COMMENTS_MAX_CHARS: i64 = 400;

/// 結合後 context 全体の上限文字数（FoundationModels のコンテキスト上限対策）。
///
/// 1課題あたりの本文（[`SUMMARIZE_BODY_MAX_CHARS`]）・コメント（[`SUMMARIZE_COMMENTS_MAX_CHARS`]）・
/// 見出しを [`SUMMARIZE_MAX_ISSUES`] 件分結合した文字列を、安全側でこの上限へ切り詰める。
/// 未解決事項（要件 4・コンテキスト上限の実測）に応じて調整する暫定既定。
const SUMMARIZE_CONTEXT_MAX_CHARS: usize = 3000;

/// テスト用の挨拶コマンド
///
/// # 引数
/// * `name` - 挨拶する相手の名前
///
/// # 戻り値
/// 挨拶メッセージ
#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {name}! You've been greeted from Rust!")
}

/// 設定を保存
///
/// キーと値のペアでアプリケーション設定をデータベースに保存する。
/// 既存のキーがある場合は上書きされる。
///
/// # 引数
/// * `key` - 設定のキー（例: "domain", "api_key"）
/// * `value` - 設定の値
/// * `db` - データベースクライアント（Tauriの状態管理から自動注入）
///
/// # 戻り値
/// 成功時は`Ok(())`、失敗時はエラーメッセージ
#[tauri::command]
pub async fn save_settings(
    app: tauri::AppHandle,
    key: String,
    value: String,
    db: State<'_, DbClient>,
) -> Result<(), String> {
    db.save_setting(&key, &value)
        .await
        .map_err(|e| e.to_string())?;

    if key == "language" {
        let issues = db.get_issues().await.map_err(|e| e.to_string())?;
        let high_priority_count = issues.iter().filter(|i| i.relevance_score >= 80).count();

        // 言語設定を取得（デフォルトは日本語）
        let lang = value;

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
    }

    Ok(())
}

#[tauri::command]
pub async fn get_workspaces(db: State<'_, DbClient>) -> Result<Vec<crate::db::Workspace>, String> {
    db.get_workspaces().await.map_err(|e| e.to_string())
}

/// ワークスペースIDからワークスペース情報を取得
#[tauri::command]
pub async fn get_workspace_by_id(
    db: State<'_, DbClient>,
    workspace_id: i64,
) -> Result<Option<crate::db::Workspace>, String> {
    let workspaces = db.get_workspaces().await.map_err(|e| e.to_string())?;
    Ok(workspaces.into_iter().find(|w| w.id == workspace_id))
}

#[tauri::command]
pub async fn save_workspace(
    db: State<'_, DbClient>,
    domain: String,
    api_key: String,
    project_keys: Vec<String>,
) -> Result<(), String> {
    // Backlog APIクライアントを作成してユーザー情報を取得
    let client = BacklogClient::new(&domain, &api_key);
    let me = client.get_myself().await.map_err(|e| e.to_string())?;

    let keys_str = project_keys.join(",");
    // 新規ワークスペースはデフォルトで有効
    db.save_workspace(WorkspaceInput {
        domain,
        api_key,
        project_keys: keys_str,
        user_id: Some(me.id),
        user_name: Some(me.name),
        enabled: true,
        api_limit: None,
        api_remaining: None,
        api_reset: None,
    })
    .await
    .map_err(|e| e.to_string())
}

/// ワークスペースの有効・無効を切り替え
#[tauri::command]
pub async fn toggle_workspace_enabled(
    db: State<'_, DbClient>,
    workspace_id: i64,
    enabled: bool,
) -> Result<(), String> {
    let workspaces = db.get_workspaces().await.map_err(|e| e.to_string())?;
    let workspace = workspaces
        .into_iter()
        .find(|w| w.id == workspace_id)
        .ok_or_else(|| "Workspace not found".to_string())?;

    db.save_workspace(WorkspaceInput {
        domain: workspace.domain,
        api_key: workspace.api_key,
        project_keys: workspace.project_keys,
        user_id: workspace.user_id,
        user_name: workspace.user_name,
        enabled,
        api_limit: workspace.api_limit,
        api_remaining: workspace.api_remaining,
        api_reset: workspace.api_reset,
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_workspace(db: State<'_, DbClient>, id: i64) -> Result<(), String> {
    db.delete_workspace(id).await.map_err(|e| e.to_string())
}

/// 設定を取得
///
/// 指定されたキーの設定値をデータベースから取得する。
///
/// # 引数
/// * `key` - 設定のキー
/// * `db` - データベースクライアント（Tauriの状態管理から自動注入）
///
/// # 戻り値
/// 設定値（存在しない場合は`None`）、またはエラーメッセージ
#[tauri::command]
pub async fn get_settings(key: String, db: State<'_, DbClient>) -> Result<Option<String>, String> {
    db.get_setting(&key).await.map_err(|e| e.to_string())
}

/// Backlogから課題を取得してスコアリング
///
/// 以下の処理を実行する：
/// 1. データベースから設定（ドメイン、APIキー、プロジェクトキー）を取得
/// 2. Backlog APIから課題一覧を取得
/// 3. 現在のユーザー情報を取得
/// 4. 各課題の関連度スコアを計算
/// 5. 課題をデータベースに保存
///
/// # 引数
/// * `db` - データベースクライアント（Tauriの状態管理から自動注入）
///
/// # 戻り値
/// 取得した課題の件数、またはエラーメッセージ
#[tauri::command]
pub async fn fetch_issues(app: tauri::AppHandle, db: State<'_, DbClient>) -> Result<usize, String> {
    let workspaces = db.get_workspaces().await.map_err(|e| e.to_string())?;
    let mut total_count = 0;
    let mut all_issues_for_tooltip = Vec::new();

    // 同期前のDBスナップショット（最終更新日時）を取得し、AIジョブ投入の差分検出に流用する。
    // 差分検出に必要なのは更新日時だけなので、JSON デシリアライズ・ai_results JOIN を伴う
    // get_issues ではなく軽量な get_issue_updated_map を使う（課題が多くても同期を遅くしない）。
    let existing_updated_map = db
        .get_issue_updated_map()
        .await
        .map_err(|e| e.to_string())?;

    for workspace in workspaces {
        // 無効なワークスペースはスキップし、関連する課題を削除
        if !workspace.enabled {
            if let Err(e) = db.delete_workspace_issues(workspace.id).await {
                eprintln!(
                    "Failed to delete issues for disabled workspace {}: {}",
                    workspace.id, e
                );
            }
            continue;
        }

        let domain = workspace.domain;
        let api_key = workspace.api_key;
        let project_key = workspace.project_keys;

        // Backlog APIクライアントを作成
        let client = BacklogClient::new(&domain, &api_key);

        // 取得対象のステータスID（未対応:1, 処理中:2, 処理済み:3）
        let target_status_ids = vec![1, 2, 3];

        // プロジェクトキー（カンマ区切り）を分割して処理
        let project_keys: Vec<&str> = project_key
            .split(',')
            .map(|k| k.trim())
            .filter(|k| !k.is_empty())
            .collect();
        let mut workspace_issues = Vec::new();
        let mut synced_projects = Vec::new();
        // 直近のレート残量（コーパス・コメント取得のバックオフ判定に流用。v0.4 / FR-V04-002）。
        let mut last_remaining: Option<i64> = None;

        for &key in &project_keys {
            // プロジェクトごとに課題を取得
            match client.get_issues(key, &target_status_ids).await {
                Ok((issues, rate_limit)) => {
                    workspace_issues.extend(issues);
                    synced_projects.push(key.to_string());
                    if rate_limit.remaining.is_some() {
                        last_remaining = rate_limit.remaining;
                    }

                    // API使用状況を保存
                    // 複数のプロジェクトを取得する場合、最後のレスポンスの情報で更新する
                    if let Err(e) = db
                        .save_workspace_usage(
                            workspace.id,
                            rate_limit.limit,
                            rate_limit.remaining,
                            rate_limit.reset,
                        )
                        .await
                    {
                        eprintln!("Failed to save workspace usage: {e}");
                    }
                }
                Err(e) => {
                    eprintln!("Failed to fetch issues for project {key}: {e}");
                    // エラーが発生しても他のプロジェクトの取得は継続
                }
            }
        }
        let me = match client.get_myself().await {
            Ok(me) => me,
            Err(e) => {
                eprintln!("Failed to get myself for {domain}: {e}");
                continue;
            }
        };

        // ユーザー情報を更新（まだ保存されていない場合のために）
        if workspace.user_id.is_none() || workspace.user_name.is_none() {
            let _ = db
                .save_workspace(WorkspaceInput {
                    domain: domain.clone(),
                    api_key: api_key.clone(),
                    project_keys: project_key.clone(),
                    user_id: Some(me.id),
                    user_name: Some(me.name.clone()),
                    enabled: workspace.enabled,
                    api_limit: workspace.api_limit,
                    api_remaining: workspace.api_remaining,
                    api_reset: workspace.api_reset.clone(),
                })
                .await;
        }

        // 各課題のスコアを計算
        for issue in &mut workspace_issues {
            issue.relevance_score = crate::scoring::ScoringService::calculate_score(issue, &me);
            issue.workspace_id = workspace.id;
        }

        // データベースに保存
        // Vec<String> を Vec<&str> に変換
        let synced_projects_refs: Vec<&str> = synced_projects.iter().map(|s| s.as_str()).collect();

        db.save_issues(
            workspace.id,
            &workspace_issues,
            &synced_projects_refs,
            &project_keys,
        )
        .await
        .map_err(|e| e.to_string())?;

        // 保存成功後、新規・更新チケットをAIジョブとしてキュー投入する（FR-V03-004 / 手動sync経路）。
        // 無効ワークスペースはループ冒頭で continue 済みのため、ここに来る時点で enabled が確定している。
        // 差分検出ロジックは scheduler 経路と共通化している。
        crate::scheduler::enqueue_changed_issues(
            &db,
            workspace.id,
            &workspace_issues,
            &existing_updated_map,
        )
        .await;

        // v0.4: 完了課題コーパス取り込み・コメント差分取得・埋め込みジョブ投入（手動sync経路）。
        // これらは API 直列取得（コーパス最大 MAX_CORPUS_PAGES × プロジェクト + コメント最大 N 件）を
        // 含み、初回ビルド時は重い。通常 sync・スコアリング・保存はこの時点で完了済みのため、
        // この重い部分は**バックグラウンドタスクへ逃がして** fetch_issues を即返す
        // （NFR-V04-002 / NFR-V04-005: sync・UI を阻害しない）。必要データを owned へクローンして move する。
        {
            let db_bg = db.inner().clone();
            let client_bg = client.clone();
            let ws_id = workspace.id;
            let project_keys_bg: Vec<String> = project_keys.iter().map(|s| s.to_string()).collect();
            let issues_bg = workspace_issues.clone();
            let updated_map_bg = existing_updated_map.clone();
            let rate_remaining = last_remaining;
            tauri::async_runtime::spawn(async move {
                let pk_refs: Vec<&str> = project_keys_bg.iter().map(|s| s.as_str()).collect();
                crate::scheduler::sync_corpus_and_embeddings(
                    &db_bg,
                    &client_bg,
                    ws_id,
                    &pk_refs,
                    &issues_bg,
                    &updated_map_bg,
                    rate_remaining,
                )
                .await;
            });
        }

        total_count += workspace_issues.len();
        all_issues_for_tooltip.append(&mut workspace_issues);
    }

    // トレイのツールチップを更新
    let high_priority_count = all_issues_for_tooltip
        .iter()
        .filter(|i| i.relevance_score >= 80)
        .count();

    // 言語設定を取得（デフォルトは日本語）
    let lang = db
        .get_setting("language")
        .await
        .unwrap_or(Some("ja".to_string()))
        .unwrap_or("ja".to_string());

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

    Ok(total_count)
}

/// プロジェクト一覧を取得するコマンド
///
/// Backlog APIから自分がアクセス可能なプロジェクト一覧を取得する。
/// 設定画面でプロジェクトを選択する際に使用。
///
/// # 戻り値
/// プロジェクト情報のベクタ（プロジェクトキーと名前）
#[tauri::command]
pub async fn fetch_projects(
    domain: String,
    api_key: String,
) -> Result<Vec<(String, String)>, String> {
    // Backlog APIクライアントを作成
    let client = BacklogClient::new(&domain, &api_key);

    // プロジェクト一覧を取得
    let projects = client.get_projects().await.map_err(|e| e.to_string())?;

    // (project_key, name) のタプルに変換
    let result: Vec<(String, String)> = projects
        .iter()
        .map(|p| (p.project_key.clone(), p.name.clone()))
        .collect();

    Ok(result)
}

/// 保存された課題一覧を取得
///
/// データベースに保存されている課題を関連度スコアの降順で取得する。
///
/// # 引数
/// * `db` - データベースクライアント（Tauriの状態管理から自動注入）
///
/// # 戻り値
/// 課題のリスト（スコア順）、またはエラーメッセージ
#[tauri::command]
pub async fn get_issues(db: State<'_, DbClient>) -> Result<Vec<crate::backlog::Issue>, String> {
    db.get_issues().await.map_err(|e| e.to_string())
}

/// AI 機能の可用性を取得（FR-V03-002）
///
/// macOS バージョン要件と FoundationModels の availability を統合し、理由別の可用性状態を返す。
/// 判定のため一時的に FoundationModels バックエンドを生成して問い合わせる。
/// いかなる失敗でも `Err` にはせず、`Unavailable` 系の値を返すため、AI 非対応環境でも
/// フロントは結果を受け取って理由別メッセージ・導線を出し分けられる（NFR-V03-002 / NFR-V03-004）。
///
/// # 引数
/// * `app` - sidecar 起動に用いる Tauri アプリケーションハンドル（自動注入）
///
/// # 戻り値
/// 理由別の可用性状態 [`crate::ai::availability::AiAvailability`]
#[tauri::command]
pub async fn get_ai_availability(
    app: tauri::AppHandle,
) -> Result<crate::ai::availability::AiAvailability, String> {
    // 可用性問い合わせ用に FoundationModels バックエンドを生成する。
    // sidecar の実起動は availability 要求時まで遅延し、判定後はバックエンドが drop されて停止する
    // （アイドル時 sidecar 非消費。NFR-V03-003）。
    let backend = crate::ai::foundation_models::FoundationModelsBackend::new(app);
    Ok(crate::ai::availability::check_availability(&backend).await)
}

/// AI 機能の有効・無効設定を取得（FR-V03-003）
///
/// `settings` テーブルの `'ai_enabled'` キーを参照し、AI 機能のオン/オフを返す。
/// 値が `"true"` のときのみ有効とみなす。未設定・それ以外は無効（既定 OFF）。
///
/// # 引数
/// * `db` - データベースクライアント（自動注入）
///
/// # 戻り値
/// AI 機能が有効なら `true`、無効・未設定なら `false`、またはエラーメッセージ
#[tauri::command]
pub async fn get_ai_settings(db: State<'_, DbClient>) -> Result<bool, String> {
    let value = db
        .get_setting(crate::ai::worker::SETTING_AI_ENABLED)
        .await
        .map_err(|e| e.to_string())?;
    Ok(value.as_deref() == Some("true"))
}

/// AI 機能の有効・無効を保存（FR-V03-003）
///
/// `settings` テーブルの `'ai_enabled'` キーへオン/オフトグルの状態を保存する。
/// 既存の `save_setting` を流用し、`true` / `false` の文字列で保存する。
///
/// # 引数
/// * `enabled` - AI 機能を有効にするなら `true`
/// * `db` - データベースクライアント（自動注入）
///
/// # 戻り値
/// 成功時は`Ok(())`、失敗時はエラーメッセージ
#[tauri::command]
pub async fn save_ai_setting(enabled: bool, db: State<'_, DbClient>) -> Result<(), String> {
    let value = if enabled { "true" } else { "false" };
    db.save_setting(crate::ai::worker::SETTING_AI_ENABLED, value)
        .await
        .map_err(|e| e.to_string())
}

/// AI キューの処理状況を取得（FR-V03-003 / FR-V03-004）
///
/// 設定画面でバックグラウンド処理状況を表示するため、`job_queue` の残件数（`pending`）と
/// 処理中件数（`processing`）を返す。
///
/// # 引数
/// * `db` - データベースクライアント（自動注入）
///
/// # 戻り値
/// `(pending, processing)`（残件数・処理中件数）のタプル、またはエラーメッセージ
#[tauri::command]
pub async fn get_ai_queue_status(db: State<'_, DbClient>) -> Result<(i64, i64), String> {
    let pending = db.count_pending_jobs().await.map_err(|e| e.to_string())?;
    let processing = db
        .count_processing_jobs()
        .await
        .map_err(|e| e.to_string())?;
    Ok((pending, processing))
}

/// 課題を手動で再分析キューに投入（FR-V03-004 / 手動「再分析」トリガー）
///
/// 指定した課題1件を `job_queue` に `pending` で投入し、バックグラウンドワーカーに再分析させる。
/// 重複した `pending` ジョブは `enqueue_jobs` 側で抑止されるため、連打しても多重投入されない。
/// AI 機能が OFF の場合はワーカーが処理しないが、投入自体は受け付ける（ON 後に処理される）。
///
/// # 引数
/// * `workspace_id` - 対象課題のワークスペースID
/// * `issue_id` - 対象課題ID
/// * `db` - データベースクライアント（自動注入）
///
/// # 戻り値
/// 新規に投入したジョブ件数（既に pending があれば 0）、またはエラーメッセージ
#[tauri::command]
pub async fn reanalyze_issue(
    workspace_id: i64,
    issue_id: i64,
    db: State<'_, DbClient>,
) -> Result<u64, String> {
    db.enqueue_jobs(
        workspace_id,
        &[issue_id],
        crate::ai::worker::JOB_TYPE_SUMMARIZE,
    )
    .await
    .map_err(|e| e.to_string())
}

/// 類似課題検索の結果1件（FR-V04-005）
///
/// `search_similar_issues` が返す1件分の表示用データ。フロント（`useSimilarSearch` /
/// `IssueSimilarResults`）はこのまま受け取ってカード表示・解決策要約に用いる。
/// `camelCase` でシリアライズしてフロントの命名規則に合わせる。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarIssue {
    /// 課題ID。
    pub issue_id: i64,
    /// ワークスペースID（フロントの `:key` 一意化・ブラウザ起動時の workspace 解決に用いる）。
    pub workspace_id: i64,
    /// 課題キー（例: "PROJ-123"）。
    pub issue_key: String,
    /// 課題タイトル。
    pub summary: String,
    /// ステータス名（未設定なら `None`）。
    pub status: Option<String>,
    /// 担当者名（未設定なら `None`）。
    pub assignee: Option<String>,
    /// プロジェクトキー（`issue_key` のプレフィックスから導出。例: "PROJ"）。
    pub project_key: String,
    /// クエリ課題とのコサイン類似度（おおむね 0.0..=1.0）。
    pub similarity: f32,
    /// コーパス専用（完了課題）由来なら `true`（FR-V04-003 / FR-V04-005）。
    pub is_corpus_only: bool,
}

/// 課題キーからプロジェクトキーを導出する（例: "PROJ-123" -> "PROJ"）。
///
/// 課題には専用の `project_key` カラムが無いため、`issue_key` の最後の `'-'` より前を
/// プロジェクトキーとみなす。`'-'` を含まない異常値はキー全体をそのまま返す。
fn project_key_from_issue_key(issue_key: &str) -> String {
    match issue_key.rfind('-') {
        Some(pos) => issue_key[..pos].to_string(),
        None => issue_key.to_string(),
    }
}

/// 全埋め込みから類似上位N件の `(issue_id, similarity)` を求める（純粋関数。FR-V04-004）。
///
/// クエリベクトルと各課題ベクトルの総当たりコサイン類似度を計算し、クエリ課題自身（`query_id`）を
/// 除外、[`SIMILARITY_THRESHOLD`] 以上のみ残し、類似度降順に並べて上位 `limit` 件へ切り詰める。
/// DB アクセス・メタ取得を含まないため、[`search_similar_issues`] の中核ロジックを実機なしで
/// 単体テストできる。
///
/// # 引数
/// * `query_vec` - クエリ課題の埋め込みベクトル。
/// * `all` - ワークスペース内の `(issue_id, ベクトル)` 全件（コーパス含む）。
/// * `query_id` - クエリ課題ID（結果から除外する）。
/// * `limit` - 返す上位件数。
///
/// # 戻り値
/// 類似度降順の `(issue_id, similarity)` 上位 `limit` 件。
fn rank_similar(
    query_vec: &[f32],
    all: &[(i64, Vec<f32>)],
    query_id: i64,
    limit: usize,
) -> Vec<(i64, f32)> {
    let mut scored: Vec<(i64, f32)> = all
        .iter()
        .filter(|(id, _)| *id != query_id)
        .map(|(id, vec)| (*id, crate::ai::cosine::cosine_similarity(query_vec, vec)))
        .filter(|(_, sim)| *sim >= SIMILARITY_THRESHOLD)
        .collect();

    // 類似度降順。NaN は cosine 側で排除済み（0.0 を返す）だが念のため total_cmp で安定比較する。
    scored.sort_by(|a, b| b.1.total_cmp(&a.1));
    scored.truncate(limit);
    scored
}

/// 課題起点の横断類似検索（FR-V04-004 / FR-V04-005）
///
/// クエリ課題の埋め込みを取得し、同一ワークスペースの全埋め込み（コーパス完了課題を含む。
/// [`crate::db::DbClient::get_all_embeddings`]）との総当たりでコサイン類似度を計算する。
/// クエリ課題自身は結果から除外し、[`SIMILARITY_THRESHOLD`] 以上の課題を類似度降順に並べて
/// 上位 `limit`（未指定時 [`DEFAULT_SIMILAR_LIMIT`]）件を表示用メタ情報付きで返す。
///
/// 性能（NFR-V04-002 / 数千件 100ms 目安）のため、ベクトルのロードは
/// [`crate::db::DbClient::get_all_embeddings`] で1回だけ行い、以降は f32 演算で完結させる。
/// 類似度しきい値・上位N件は未解決事項#4 の暫定既定（定数）であり、実運用に応じて調整する。
///
/// # 引数
/// * `workspace_id` - クエリ課題のワークスペースID
/// * `issue_id` - クエリ課題ID
/// * `limit` - 返す上位件数（`None` で [`DEFAULT_SIMILAR_LIMIT`]）
/// * `db` - データベースクライアント（自動注入）
///
/// # 戻り値
/// 類似度降順の類似課題リスト [`SimilarIssue`]（クエリ自身は除外）、またはエラーメッセージ。
/// クエリ課題の埋め込みが未構築の場合は空リストを返す（エラーにはしない）。
#[tauri::command]
pub async fn search_similar_issues(
    workspace_id: i64,
    issue_id: i64,
    limit: Option<usize>,
    db: State<'_, DbClient>,
) -> Result<Vec<SimilarIssue>, String> {
    let limit = limit.unwrap_or(DEFAULT_SIMILAR_LIMIT);

    // 1. クエリ課題の埋め込みを取得。未構築なら検索不能なので空リストを返す（degrade）。
    let Some(query_vec) = db
        .get_embedding(workspace_id, issue_id)
        .await
        .map_err(|e| e.to_string())?
    else {
        return Ok(Vec::new());
    };

    // 2. ワークスペース内の全埋め込み（コーパス含む）を1回だけロードする（NFR-V04-002）。
    let all = db
        .get_all_embeddings(workspace_id)
        .await
        .map_err(|e| e.to_string())?;

    // 3-4. 総当たり類似度計算→自身除外→しきい値→降順→上位N件（純粋関数へ委譲。テスト容易性）。
    let scored = rank_similar(&query_vec, &all, issue_id, limit);

    if scored.is_empty() {
        return Ok(Vec::new());
    }

    // 5. 上位N件の表示用メタ情報をまとめて取得し、SimilarIssue へ組み立てる。
    let ids: Vec<i64> = scored.iter().map(|(id, _)| *id).collect();
    let meta = db
        .get_issue_search_meta(workspace_id, &ids)
        .await
        .map_err(|e| e.to_string())?;

    let results = scored
        .into_iter()
        .filter_map(|(id, similarity)| {
            // メタが取れない課題（削除済み等）は結果から落とす。
            let m = meta.get(&id)?;
            Some(SimilarIssue {
                issue_id: id,
                workspace_id,
                project_key: project_key_from_issue_key(&m.issue_key),
                issue_key: m.issue_key.clone(),
                summary: m.summary.clone(),
                status: m.status.clone(),
                assignee: m.assignee.clone(),
                similarity,
                is_corpus_only: m.is_corpus_only,
            })
        })
        .collect();

    Ok(results)
}

/// 埋め込み構築の進捗を取得（FR-V04-005）
///
/// 設定画面・一覧の「構築待ち」表示用に、指定ワークスペースの埋め込み対象件数（全課題数）と
/// 構築済み件数（`issue_embeddings` 行数）の組を返す。
///
/// # 引数
/// * `workspace_id` - ワークスペースID
/// * `db` - データベースクライアント（自動注入）
///
/// # 戻り値
/// `(target, built)` = (対象件数, 構築済み件数)、またはエラーメッセージ
#[tauri::command]
pub async fn get_embedding_status(
    workspace_id: i64,
    db: State<'_, DbClient>,
) -> Result<(i64, i64), String> {
    db.get_embedding_status(workspace_id)
        .await
        .map_err(|e| e.to_string())
}

/// コーパス（完了課題）件数を取得（FR-V04-003 / FR-V04-005）
///
/// 設定画面でコーパスの規模を表示するため、指定ワークスペースの `is_corpus_only = 1` の
/// 課題件数を返す。
///
/// # 引数
/// * `workspace_id` - ワークスペースID
/// * `db` - データベースクライアント（自動注入）
///
/// # 戻り値
/// コーパス専用課題件数、またはエラーメッセージ
#[tauri::command]
pub async fn get_closed_issues_corpus_count(
    workspace_id: i64,
    db: State<'_, DbClient>,
) -> Result<i64, String> {
    db.count_corpus_issues(workspace_id)
        .await
        .map_err(|e| e.to_string())
}

/// 過去事例（類似上位群）の本文・コメントを1本の context テキストへ結合する（純粋関数）。
///
/// 取得済みの `(issue_key, summary, body_head, comments, is_corpus_only)` 群を受け取り、
/// 完了課題（コーパス専用 = 解決済み）を前方に並べ替えてから先頭 [`SUMMARIZE_MAX_ISSUES`] 件を採り、
/// 課題ごとに見出し付きで連結したうえで全体を [`SUMMARIZE_CONTEXT_MAX_CHARS`] 文字に切り詰める。
/// DB アクセスや LLM 呼び出しを含まないため、結合・並べ替え・切り詰めロジックを実機なしで
/// 単体テストできる（[`summarize_solutions`] の中核を分離）。
///
/// # 引数
/// * `items` - 類似上位群（`search_similar_issues` の順 = 類似度降順）の事例データ。
///
/// # 戻り値
/// 結合・切り詰め済みの context テキスト。事例が無ければ空文字。
fn build_solution_context(items: Vec<SolutionContextItem>) -> String {
    // 完了課題（is_corpus_only = 解決済み）を前方へ。安定ソートで、同条件内は元の類似度順を保つ。
    // FR-V04-005「過去の対応・解決策」は解決済み課題に情報が多いため優先的に context へ含める。
    let mut ordered = items;
    ordered.sort_by_key(|item| std::cmp::Reverse(item.is_corpus_only));
    ordered.truncate(SUMMARIZE_MAX_ISSUES);

    let mut sections: Vec<String> = Vec::new();
    for item in ordered {
        let mut section = format!("[{}] {}", item.issue_key, item.summary);
        if !item.body_head.is_empty() {
            section.push('\n');
            section.push_str(&item.body_head);
        }
        if !item.comments.is_empty() {
            section.push('\n');
            section.push_str(&item.comments);
        }
        sections.push(section);
    }

    let joined = sections.join("\n\n");
    // 全体をコンテキスト上限へ切り詰める（char 単位でマルチバイト安全に）。
    joined.chars().take(SUMMARIZE_CONTEXT_MAX_CHARS).collect()
}

/// 解決策要約 context を組み立てるための1課題分の事例データ（[`build_solution_context`] の入力）。
struct SolutionContextItem {
    /// 課題キー（見出し用）。
    issue_key: String,
    /// 課題タイトル。
    summary: String,
    /// 本文先頭（[`SUMMARIZE_BODY_MAX_CHARS`] で切り詰め済み）。
    body_head: String,
    /// コメント先頭（[`SUMMARIZE_COMMENTS_MAX_CHARS`] で切り詰め済み）。
    comments: String,
    /// 完了課題（コーパス専用 = 解決済み）なら `true`（context の優先順位付けに用いる）。
    is_corpus_only: bool,
}

/// 過去事例の解決策要点を要約する（FR-V04-005）
///
/// 類似検索でヒットした上位群（`issue_ids`）の **タイトル + 本文先頭 + コメント先頭** を結合した
/// context を作り、v0.3 の FoundationModels バックエンド（[`crate::ai::create_backend`]）を**再利用**して
/// 「過去の対応・解決策の要点」を生成する。出力言語は引数 `lang`（UI 言語に追従。`ja` / `en`）。
///
/// # 設計判断（sidecar 経路の選択）
/// 専用の自由文要約経路（`summarize_text`）を sidecar に追加するのではなく、**既存の `analyze` 経路を
/// 流用**する。理由は (1) 新経路は Rust 側の `SidecarRequest` だけでなく Swift sidecar バイナリの
/// 改修・再配布を要し、本コマンド（Rust 実装）のスコープと再配布リスクの両面で重いこと、
/// (2) `analyze` は既に `suggestion`（次に取るべき対応＝対応提案）を返し、これが「解決策の要点」と
/// 意味的に一致すること、による。結合した過去事例 context を `description_head` に載せ、
/// 解決済み事例から取るべき対応を促す `summary` を与えて [`crate::ai::LlmInference::infer`] を呼び、
/// 返ってきた `suggestion`（解決策要点）に `summary`（補足の1行）を添えて文字列で返す。
///
/// # 非阻害（degrade。NFR-V04-005）
/// AI 非対応・生成失敗・対象課題なしのいずれでも `Err` にはせず、**空文字**を返す。これにより
/// 呼び出し元（類似検索 UI）は要約欄のみ空にして検索結果一覧自体は壊さない。
///
/// # 引数
/// * `app` - sidecar 起動に用いる Tauri アプリケーションハンドル（自動注入）
/// * `workspace_id` - 対象課題群のワークスペースID（類似検索は単一ワークスペース内で完結する）
/// * `issue_ids` - 要約対象の課題ID群（`search_similar_issues` の結果。類似度降順）
/// * `lang` - 出力言語（`ja` / `en`。UI 言語に追従）
/// * `db` - データベースクライアント（自動注入）
///
/// # 戻り値
/// 解決策要点の文字列。生成不能・非対応時は空文字（degrade）。DB アクセス失敗のみ `Err`。
#[tauri::command]
pub async fn summarize_solutions(
    app: tauri::AppHandle,
    workspace_id: i64,
    issue_ids: Vec<i64>,
    lang: String,
    db: State<'_, DbClient>,
) -> Result<String, String> {
    if issue_ids.is_empty() {
        return Ok(String::new());
    }

    // 1. 上位群の本文・コメント・コーパス種別を DB から集める（本文・コメントは SQL/関数側で切り詰め）。
    // 上限件数は context 結合時に絞るため、ここでは取りこぼし防止に多めまで取得してよいが、
    // 余計な DB アクセスを避けるため SUMMARIZE_MAX_ISSUES の倍程度に留める。
    // 対象 ID（上位群）のコーパス種別は IN 句で**一括取得**しておく（ループ内1件ずつの N+1 を回避）。
    let target_ids: Vec<i64> = issue_ids
        .iter()
        .take(SUMMARIZE_MAX_ISSUES * 2)
        .copied()
        .collect();
    let meta = db
        .get_issue_search_meta(workspace_id, &target_ids)
        .await
        .map_err(|e| e.to_string())?;

    let mut items: Vec<SolutionContextItem> = Vec::new();
    for &issue_id in &target_ids {
        // タイトル・本文先頭・ステータスを取得（本文は SQL substr で切り詰め）。見つからなければスキップ。
        let Some((issue_key, summary, body_head, _status, _due)) = db
            .get_issue_analysis_fields(workspace_id, issue_id, SUMMARIZE_BODY_MAX_CHARS)
            .await
            .map_err(|e| e.to_string())?
        else {
            continue;
        };

        // コメント先頭を取得（解決の経緯が現れやすい）。失敗・空は空文字で続行（非阻害）。
        let comments = db
            .get_comments_text(workspace_id, issue_id, SUMMARIZE_COMMENTS_MAX_CHARS)
            .await
            .unwrap_or_default();

        // コーパス種別（完了=解決済み）は一括取得済み meta から引く（context の優先順位付け用）。
        let is_corpus_only = meta
            .get(&issue_id)
            .map(|m| m.is_corpus_only)
            .unwrap_or(false);

        items.push(SolutionContextItem {
            issue_key,
            summary,
            body_head,
            comments,
            is_corpus_only,
        });
    }

    // 2. 事例を1本の context へ結合（完了課題優先・上限件数・全体切り詰め）。
    let context = build_solution_context(items);
    if context.is_empty() {
        return Ok(String::new());
    }

    // 3. v0.3 の FoundationModels バックエンドを再利用して生成する（create_backend 経由）。
    // 生成不能（AI 非対応環境等）でも検索一覧を壊さないよう、ここで空文字へ degrade する。
    let backend = match crate::ai::create_backend(app, crate::ai::BackendKind::FoundationModels) {
        Ok(b) => b,
        Err(e) => {
            log::warn!("summarize_solutions: backend unavailable: {e}");
            return Ok(String::new());
        }
    };

    // analyze 経路を流用する（sidecar 改修なし。設計判断は doc コメント参照）。
    // 過去事例の context を description_head に載せ、解決策要点を引き出す指示を summary に与える。
    // issue_key は analyze プロンプト内の参照用ラベルにすぎないため、合成ラベルを与える。
    let instruction = if lang == "en" {
        "Summarize the key past actions and solutions from the related issues below."
    } else {
        "以下の関連課題から、過去の対応・解決策の要点をまとめてください。"
    };
    let input = crate::ai::AiAnalysisInput {
        issue_key: "SIMILAR-SOLUTIONS".to_string(),
        summary: instruction.to_string(),
        description_head: context,
        status: String::new(),
        due_date: None,
        lang,
    };

    // 4. 推論。生成失敗は degrade（空文字）。`suggestion`（対応提案）を解決策要点として採用し、
    // 補足の1行 `summary` があれば前置きして返す。
    match crate::ai::LlmInference::infer(&backend, input).await {
        Ok(output) => {
            let suggestion = output.suggestion.trim();
            let summary = output.summary.trim();
            let combined = if summary.is_empty() {
                suggestion.to_string()
            } else if suggestion.is_empty() {
                summary.to_string()
            } else {
                format!("{summary}\n\n{suggestion}")
            };
            Ok(combined)
        }
        Err(e) => {
            log::warn!("summarize_solutions: generation failed: {e}");
            Ok(String::new())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_key_derivation() {
        assert_eq!(project_key_from_issue_key("PROJ-123"), "PROJ");
        // ハイフンを含むプロジェクトキーは最後のハイフンで分割する。
        assert_eq!(project_key_from_issue_key("MY-PROJ-42"), "MY-PROJ");
        // ハイフン無しはそのまま返す（異常値の安全側）。
        assert_eq!(project_key_from_issue_key("PROJ"), "PROJ");
    }

    /// クエリと向きが同じ（類似度 1.0）なベクトル群を、issue_id だけ変えて作る。
    fn corpus() -> Vec<(i64, Vec<f32>)> {
        vec![
            (1, vec![1.0, 0.0, 0.0]),   // クエリと完全一致（自身）
            (2, vec![0.9, 0.1, 0.0]),   // 高類似
            (3, vec![0.5, 0.5, 0.0]),   // 中類似
            (4, vec![0.0, 1.0, 0.0]),   // 直交（しきい値未満で除外される想定）
            (5, vec![0.95, 0.05, 0.0]), // 高類似
        ]
    }

    #[test]
    fn rank_excludes_query_itself() {
        let query = vec![1.0, 0.0, 0.0];
        let ranked = rank_similar(&query, &corpus(), 1, 10);
        // クエリ自身（id=1）は結果に含まれない。
        assert!(ranked.iter().all(|(id, _)| *id != 1));
    }

    #[test]
    fn rank_sorts_by_similarity_desc_and_applies_threshold() {
        let query = vec![1.0, 0.0, 0.0];
        let ranked = rank_similar(&query, &corpus(), 1, 10);
        // しきい値（0.80）以上のみ。直交ベクトル（id=4, 類似度 0）は除外される。
        assert!(ranked.iter().all(|(_, sim)| *sim >= SIMILARITY_THRESHOLD));
        assert!(!ranked.iter().any(|(id, _)| *id == 4));
        // 類似度降順。先頭は最も類似（id=5: 0.95 方向）。
        for w in ranked.windows(2) {
            assert!(w[0].1 >= w[1].1, "降順ソートされている");
        }
    }

    #[test]
    fn rank_truncates_to_limit() {
        let query = vec![1.0, 0.0, 0.0];
        let ranked = rank_similar(&query, &corpus(), 1, 1);
        assert_eq!(ranked.len(), 1, "上位N件に切り詰められる");
    }

    #[test]
    fn rank_includes_corpus_across_ids() {
        // コーパス由来（高ID）でもしきい値を超えれば横断的に含まれる。
        let query = vec![1.0, 0.0, 0.0];
        let mut all = corpus();
        all.push((999, vec![0.99, 0.01, 0.0])); // コーパス相当の別IDでも拾われる
        let ranked = rank_similar(&query, &all, 1, 10);
        assert!(ranked.iter().any(|(id, _)| *id == 999));
    }

    fn ctx_item(key: &str, corpus_only: bool) -> SolutionContextItem {
        SolutionContextItem {
            issue_key: key.to_string(),
            summary: format!("title {key}"),
            body_head: format!("body {key}"),
            comments: format!("comment {key}"),
            is_corpus_only: corpus_only,
        }
    }

    #[test]
    fn context_prioritizes_corpus_issues() {
        // 完了課題（コーパス）が前方に来る。安定ソートで同条件内は元の順を保つ。
        let items = vec![
            ctx_item("A", false),
            ctx_item("B", true),
            ctx_item("C", false),
            ctx_item("D", true),
        ];
        let ctx = build_solution_context(items);
        let pos_b = ctx.find("[B]").expect("B present");
        let pos_d = ctx.find("[D]").expect("D present");
        let pos_a = ctx.find("[A]").expect("A present");
        // コーパス（B,D）が非コーパス（A,C）より前に置かれる。
        assert!(pos_b < pos_a, "corpus issue should precede non-corpus");
        assert!(pos_d < pos_a, "corpus issue should precede non-corpus");
    }

    #[test]
    fn context_truncates_to_max_issues() {
        // SUMMARIZE_MAX_ISSUES を超える事例は先頭群のみ採用される。
        let items: Vec<SolutionContextItem> = (0..(SUMMARIZE_MAX_ISSUES + 3))
            .map(|i| ctx_item(&format!("K{i}"), false))
            .collect();
        let ctx = build_solution_context(items);
        let count = ctx.matches('[').count();
        assert_eq!(count, SUMMARIZE_MAX_ISSUES, "上限件数に絞られる");
    }

    #[test]
    fn context_includes_key_summary_body_comments() {
        // 見出し（キー）・タイトル・本文・コメントがすべて context に含まれる。
        let ctx = build_solution_context(vec![ctx_item("X", true)]);
        assert!(ctx.contains("[X]"));
        assert!(ctx.contains("title X"));
        assert!(ctx.contains("body X"));
        assert!(ctx.contains("comment X"));
    }

    #[test]
    fn context_caps_total_chars() {
        // 結合後の全体が SUMMARIZE_CONTEXT_MAX_CHARS を超えない（コンテキスト上限対策）。
        let big = "あ".repeat(5000);
        let items = vec![SolutionContextItem {
            issue_key: "BIG".into(),
            summary: "t".into(),
            body_head: big.clone(),
            comments: big,
            is_corpus_only: false,
        }];
        let ctx = build_solution_context(items);
        assert!(ctx.chars().count() <= SUMMARIZE_CONTEXT_MAX_CHARS);
    }

    #[test]
    fn context_empty_for_no_items() {
        assert!(build_solution_context(vec![]).is_empty());
    }
}
