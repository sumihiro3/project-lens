use crate::backlog::BacklogClient;
use crate::db::{DbClient, WorkspaceInput};
use tauri::State;

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

        for &key in &project_keys {
            // プロジェクトごとに課題を取得
            match client.get_issues(key, &target_status_ids).await {
                Ok((issues, rate_limit)) => {
                    workspace_issues.extend(issues);
                    synced_projects.push(key.to_string());

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
