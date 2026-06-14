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

/// 課題背景・経緯の要約（FR-V045-004）で context 化するコメント本文の最大文字数。
///
/// 1 課題分のコメント全文を結合した文字列を、FoundationModels の context 上限に収めるため
/// この文字数へ切り詰める（`get_comments_text` の切り詰めに渡す）。解決策要約は複数課題を
/// 結合するため 1 課題あたり 400 字（[`SUMMARIZE_COMMENTS_MAX_CHARS`]）に抑えるが、本要約は
/// 単一課題のコメントのみを扱うため、経緯・決定事項を取りこぼさないよう広めに確保する。
/// 切り詰めは現状「先頭優先」（`get_comments_text` は `comment_id` 昇順＝時系列順）であり、
/// 末尾優先（直近の決定を残す）への変更は未解決事項として保留する。
const BACKGROUND_SUMMARY_COMMENTS_MAX_CHARS: i64 = 2000;

// ── v0.4.5 レポート/サマリー生成（FR-V045-002 / FR-V045-003）の定数群 ─────────────

/// レポート narrative の context に含める「注目上位」課題の最大件数（FR-V045-002 / 未解決事項）。
///
/// 横断サマリ・週次/月次レポートの narrative は全課題ではなく、期限超過・高リスク・停滞で
/// 重み付けした上位 N 件のみから生成する（NFR-V045-002 の context 最小化）。N が大きいほど
/// 網羅性は上がるが [`REPORT_CONTEXT_MAX_CHARS`] を圧迫するため、目安 5〜10 件のうち
/// 中庸の値を暫定既定とする。実データでの見え方に応じて調整する。
const REPORT_HIGHLIGHT_MAX_ISSUES: usize = 8;

/// レポートの停滞判定に用いる未更新日数のしきい値（FR-V045-002 / FR-V045-003 / 未解決事項）。
///
/// 最終更新がこの日数以上前の課題を「停滞」とみなす。停滞は注目上位選定の **従** の重みとして
/// 用い（主は期限超過日数とリスク）、[`get_cross_summary_stats`](crate::db::DbClient::get_cross_summary_stats)
/// の停滞集計と日数定義を揃える。目安 14 日を暫定既定とする。
const REPORT_STALE_THRESHOLD_DAYS: i64 = 14;

/// レポート narrative の compact context 全体の上限文字数。
///
/// 注目上位 N 件（[`REPORT_HIGHLIGHT_MAX_ISSUES`]）の 1 行要約・リスク・プロジェクトキー・遅延日数だけを
/// 連結した context を、安全側でこの上限へ切り詰める。解決策要約の
/// [`SUMMARIZE_CONTEXT_MAX_CHARS`]（≈3000）と同水準とし、FoundationModels の context 上限に収める。
const REPORT_CONTEXT_MAX_CHARS: usize = SUMMARIZE_CONTEXT_MAX_CHARS;

/// 横断サマリ（`cross_summary`）をバックグラウンド再生成する最小間隔（時間。FR-V045-005）。
///
/// スケジューラは「前回生成からの経過時間」がこの値以上のときだけ横断サマリを再生成する
/// （1日1回相当。20 時間にすることで実行時刻が固定化せず、毎日確実に1回は回る余地を持たせる）。
/// 手動再生成（`/reports` の再生成導線）はこの間隔に関係なく即時実行する。
/// スケジューラ（[`crate::scheduler`]）の横断サマリ再生成判定から参照する。
pub(crate) const CROSS_SUMMARY_REGEN_HOURS: i64 = 20;

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
pub(crate) fn project_key_from_issue_key(issue_key: &str) -> String {
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

/// 課題の背景・経緯・決定事項の要点をコメントから要約する（source_hash キャッシュ付き。FR-V045-004）
///
/// 対象課題のコメント本文（[`crate::db::DbClient::get_comments_text`]）を context 化し、
/// [`summarize_solutions`] と同じく **既存 `analyze` 経路を流用**して「経緯・決定事項の要点」を生成する。
/// 新規 per-issue LLM 経路や sidecar 改修は一切行わない（v0.4.5 の基本思想）。出力言語は引数 `lang`。
///
/// # キャッシュ（source_hash。NFR-V045-002）
/// コメント本文の [`source_hash`](crate::ai::embed_worker::compute_source_hash)（埋め込みと同一の
/// SipHash 方式）をキーに [`crate::db::DbClient::get_background_summary`] / [`save_background_summary`]
/// で `issue_background_summary`（PK = `(workspace_id, issue_id, lang)`）へ保存する。保存済みハッシュが
/// 今回算出したハッシュと一致すれば **LLM・sidecar を起こさず** `summary_text` を即返す。コメントが
/// 不変・同一言語のあいだは再生成不要なため、繰り返し開いても 2 回目以降はキャッシュ即返しになる。
///
/// # コメントなし課題
/// コメントが空の場合は LLM を呼ばず **空文字**を返す（呼び出し側 UI が「コメントなし」を表示する）。
/// 切り詰めは現状「先頭優先」（コメントは `comment_id` 昇順＝時系列順）で、末尾優先化は未解決事項。
///
/// # 非阻害（degrade。NFR-V045-003）
/// AI 非対応・生成失敗のいずれでも `Err` にはせず**空文字**へ degrade し、要約欄のみ空にして
/// 課題詳細ダイアログ本体は壊さない。DB アクセス失敗のみ `Err` を返す。
///
/// # 引数
/// * `app` - sidecar 起動に用いる Tauri アプリケーションハンドル（自動注入）
/// * `workspace_id` - 対象課題のワークスペースID
/// * `issue_id` - 対象課題ID
/// * `lang` - 出力言語（`ja` / `en`。UI 言語に追従。キャッシュキーの一部）
/// * `db` - データベースクライアント（自動注入）
///
/// # 戻り値
/// 経緯・決定事項の要点の文字列。コメントなし・生成不能・非対応時は空文字（degrade）。DB エラーのみ `Err`。
#[tauri::command]
pub async fn get_background_summary(
    app: tauri::AppHandle,
    workspace_id: i64,
    issue_id: i64,
    lang: String,
    db: State<'_, DbClient>,
) -> Result<String, String> {
    // 1. コメント本文を取得（comment_id 昇順＝時系列順で結合し、上限文字数で先頭優先に切り詰め）。
    //    コメントが空なら LLM を起こさず空文字を返す（UI 側で「コメントなし」を表示）。
    let comments = db
        .get_comments_text(
            workspace_id,
            issue_id,
            BACKGROUND_SUMMARY_COMMENTS_MAX_CHARS,
        )
        .await
        .map_err(|e| e.to_string())?;
    if comments.trim().is_empty() {
        return Ok(String::new());
    }

    // 2. コメント本文の source_hash を算出する（埋め込みと同一の SipHash 方式を再利用）。
    let source_hash = crate::ai::embed_worker::compute_source_hash(&comments);

    // 3. 保存済みキャッシュの source_hash が一致すれば、LLM・sidecar を起こさず即返す。
    if let Some((summary_text, cached_hash, _generated_at)) = db
        .get_background_summary(workspace_id, issue_id, &lang)
        .await
        .map_err(|e| e.to_string())?
    {
        if cached_hash == source_hash {
            log::debug!(
                "get_background_summary: cache hit (workspace_id={workspace_id}, issue_id={issue_id}, lang={lang})"
            );
            return Ok(summary_text);
        }
    }

    // 4. キャッシュ未生成 or コメント変化 → analyze 経路を流用して要点を生成する（sidecar 改修なし）。
    //    生成不能（AI 非対応環境等）でもダイアログを壊さないよう空文字へ degrade する。
    let backend = match crate::ai::create_backend(app, crate::ai::BackendKind::FoundationModels) {
        Ok(b) => b,
        Err(e) => {
            log::warn!("get_background_summary: backend unavailable: {e}");
            return Ok(String::new());
        }
    };

    // コメント本文を description_head に載せ、経緯・決定事項の要点を引き出す指示を summary に与える。
    // issue_key は analyze プロンプト内の参照用ラベルにすぎないため合成ラベルを与える。
    let instruction = if lang == "en" {
        "Summarize the background, progress, and key decisions from the comments below."
    } else {
        "以下のコメントから、経緯・決定事項の要点をまとめてください。"
    };
    let input = crate::ai::AiAnalysisInput {
        issue_key: "ISSUE-BACKGROUND".to_string(),
        summary: instruction.to_string(),
        description_head: comments,
        status: String::new(),
        due_date: None,
        lang: lang.clone(),
    };

    // 5. 推論。生成失敗は degrade（空文字）。summary（補足の1行）+ suggestion（要点）を結合する。
    let summary_text = match crate::ai::LlmInference::infer(&backend, input).await {
        Ok(output) => {
            let suggestion = output.suggestion.trim();
            let summary = output.summary.trim();
            if summary.is_empty() {
                suggestion.to_string()
            } else if suggestion.is_empty() {
                summary.to_string()
            } else {
                format!("{summary}\n\n{suggestion}")
            }
        }
        Err(e) => {
            log::warn!("get_background_summary: generation failed: {e}");
            return Ok(String::new());
        }
    };

    // 6. 生成結果をキャッシュ保存して返す。空生成（degrade 相当）はキャッシュせず空文字を返す
    //    （次回開いたときに再試行できるようにし、空要約を固定化しない）。
    if summary_text.trim().is_empty() {
        return Ok(String::new());
    }
    db.save_background_summary(workspace_id, issue_id, &lang, &summary_text, &source_hash)
        .await
        .map_err(|e| e.to_string())?;
    Ok(summary_text)
}

// ── v0.4.5 レポート/サマリー生成コア（FR-V045-002 / FR-V045-003） ──────────────

/// レポート narrative の種別。
///
/// `report_summaries.report_type` カラム（`'cross_summary'` / `'weekly'` / `'monthly'`）と一致する。
/// [`generate_report_narrative`] に渡し、生成指示文（見出し・ハイライトの言い回し）を切り替える。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReportType {
    /// 複数プロジェクト横断サマリ（最新のみ上書き。FR-V045-002）。
    CrossSummary,
    /// 週次アクティビティレポート（ISO 週。FR-V045-003）。
    Weekly,
    /// 月次アクティビティレポート（FR-V045-003）。
    Monthly,
}

/// 注目上位選定の入力となる課題1件分のメタ情報（[`select_report_highlights`] の入力要素）。
///
/// DB から決定的に取得した値（期限超過日数・リスク・停滞・プロジェクトキー・1行要約）だけを持ち、
/// 純粋関数で重み付けスコア化できるよう DB / LLM 依存を含まない。`compact context` 構築
/// （[`build_report_context`]）にもそのまま流用する。
#[derive(Debug, Clone)]
pub struct ReportHighlightInput {
    /// 課題キー（例: "PROJ-123"。context の参照ラベル用）。
    pub issue_key: String,
    /// プロジェクトキー（例: "PROJ"。`issue_key` から導出済み）。
    pub project_key: String,
    /// `ai_results.summary`（1行要約）。未生成なら空文字（context では省略される）。
    pub ai_summary: String,
    /// `ai_results.risk_level`（`high` / `medium` / `low`）。未生成なら `None`。
    pub risk_level: Option<crate::ai::RiskLevel>,
    /// 遅延日数（SQL 算出。正=期限超過・負=猶予・期限なしは `None`）。
    pub delay_days: Option<i64>,
    /// 停滞（最終更新が [`REPORT_STALE_THRESHOLD_DAYS`] 日以上前）なら `true`。
    pub is_stale: bool,
}

/// 注目上位選定の重み付けスコアを算出する（純粋関数）。
///
/// 期限超過日数とリスクを **主**、停滞を **従** とする（FR-V045-002 / 未解決事項）。
/// 各課題は以下の合算でスコア化し、降順上位を「注目」とみなす。
///
/// | 要素                       | 寄与                                                        |
/// | -------------------------- | ----------------------------------------------------------- |
/// | 期限超過日数（主）         | `delay_days` が正のときその日数（上限 60 でクランプ）       |
/// | リスク（主）               | high=+50 / medium=+25 / low=+5 / 未生成=0                    |
/// | 停滞（従）                 | `is_stale` なら +10                                          |
///
/// 期限超過日数を素点に近い形で寄与させることで「より深く超過した課題」を優先しつつ、上限
/// クランプで極端な外れ値（古い期限）が常に最上位を独占しないようにする。リスクは離散的な
/// 大きめの加点で、超過していなくても high リスクが上位へ入る余地を残す。停滞は小さな従の加点。
///
/// # 引数
/// * `item` - スコア対象の課題メタ。
///
/// # 戻り値
/// 重み付けスコア（大きいほど注目度が高い）。
fn report_highlight_score(item: &ReportHighlightInput) -> i64 {
    // 期限超過日数（主）。正の超過のみ寄与させ、外れ値を上限 60 日でクランプする。
    let overdue_score = match item.delay_days {
        Some(d) if d > 0 => d.min(60),
        _ => 0,
    };
    // リスク（主）。未生成（None）は加点なし。
    let risk_score = match item.risk_level {
        Some(crate::ai::RiskLevel::High) => 50,
        Some(crate::ai::RiskLevel::Medium) => 25,
        Some(crate::ai::RiskLevel::Low) => 5,
        None => 0,
    };
    // 停滞（従）。
    let stale_score = if item.is_stale { 10 } else { 0 };
    overdue_score + risk_score + stale_score
}

/// 注目上位 N 件を重み付けスコアの降順で選定する（純粋関数）。
///
/// [`report_highlight_score`]（期限超過日数・リスクを主、停滞を従）で各課題を採点し、降順に
/// 並べて先頭 [`REPORT_HIGHLIGHT_MAX_ISSUES`] 件を返す。同点は安定ソートで入力順を保つ
/// （呼び出し側はリスク順や更新降順など意味のある順序で渡す想定）。DB / LLM 依存を持たないため
/// 重み付け・クランプ・上限の単体テストが実機なしで行える。
///
/// # 引数
/// * `items` - 候補課題群（ワークスペース内の対象課題）。
///
/// # 戻り値
/// スコア降順・上限 N 件に切り詰めた注目課題群。
fn select_report_highlights(items: Vec<ReportHighlightInput>) -> Vec<ReportHighlightInput> {
    let mut scored: Vec<(i64, ReportHighlightInput)> = items
        .into_iter()
        .map(|item| (report_highlight_score(&item), item))
        .collect();
    // スコア降順。sort_by_key は安定ソートのため、同点は元の順序を保つ。
    scored.sort_by_key(|(score, _)| std::cmp::Reverse(*score));
    scored.truncate(REPORT_HIGHLIGHT_MAX_ISSUES);
    scored.into_iter().map(|(_, item)| item).collect()
}

/// 注目上位群を 1 本の compact context テキストへ連結する（純粋関数）。
///
/// 1 課題につき「プロジェクトキー・課題キー・遅延日数・リスク・1行要約」だけを 1〜2 行に詰めて
/// 連結し、全体を [`REPORT_CONTEXT_MAX_CHARS`] 文字へ切り詰める。**新規の per-issue LLM 呼び出しは
/// 一切行わず**、既存 `ai_results` の 1 行要約（[`ReportHighlightInput::ai_summary`]）を再利用する
/// （NFR-V045-002 / 基本思想）。`build_solution_context` の連結・切り詰め方針に倣う。
///
/// # 引数
/// * `items` - [`select_report_highlights`] で選定済みの注目課題群（スコア降順）。
///
/// # 戻り値
/// 連結・切り詰め済みの context テキスト。注目課題が無ければ空文字。
fn build_report_context(items: &[ReportHighlightInput]) -> String {
    let mut sections: Vec<String> = Vec::new();
    for item in items {
        // 1 行目: メタ（プロジェクト・課題キー・遅延・リスク）。遅延・リスクは無い場合は省く。
        let mut header = format!("[{}] {}", item.project_key, item.issue_key);
        if let Some(d) = item.delay_days {
            if d > 0 {
                header.push_str(&format!(" / overdue {d}d"));
            }
        }
        if let Some(risk) = item.risk_level {
            header.push_str(&format!(" / risk {}", risk.as_storage_str()));
        }
        if item.is_stale {
            header.push_str(" / stale");
        }
        // 2 行目: 既存 ai_results の 1 行要約（あれば）。
        let summary = item.ai_summary.trim();
        let section = if summary.is_empty() {
            header
        } else {
            format!("{header}\n{summary}")
        };
        sections.push(section);
    }
    let joined = sections.join("\n\n");
    joined.chars().take(REPORT_CONTEXT_MAX_CHARS).collect()
}

/// レポート narrative（見出し1行 + 注目点）を analyze 経路の流用で生成する（FR-V045-002 / FR-V045-003）。
///
/// [`build_report_context`] が組んだ compact context を v0.3 の FoundationModels バックエンド
/// （[`crate::ai::create_backend`]）へ `analyze` 入力として渡し、`output.summary` を **headline
/// （見出し1行）**、`output.suggestion` を **narrative（注目点・ハイライト）** にマップして返す。
/// [`summarize_solutions`] と同じく sidecar 改修ゼロで、既存の構造化出力スキーマに narrative を載せる。
///
/// # 非阻害（degrade。NFR-V045-003）
/// context が空・AI 非対応・生成失敗のいずれでも `Err` にはせず、`(String::new(), String::new())`
/// （空タプル）へ degrade する。呼び出し側は narrative 欄のみ空にし、SQL 集計テーブルは表示し続ける。
///
/// # 引数
/// * `app` - sidecar 起動に用いる Tauri アプリケーションハンドル。
/// * `context` - [`build_report_context`] が組んだ compact context（空なら即 degrade）。
/// * `lang` - 出力言語（`ja` / `en`。UI 言語に追従）。
/// * `report_type` - レポート種別（生成指示文の言い回しを切り替える）。
///
/// # 戻り値
/// `(headline, narrative)`。生成不能・非対応時は両方空文字（degrade）。
async fn generate_report_narrative(
    app: tauri::AppHandle,
    context: String,
    lang: String,
    report_type: ReportType,
) -> (String, String) {
    if context.trim().is_empty() {
        return (String::new(), String::new());
    }

    // v0.3 の FoundationModels バックエンドを再利用（create_backend 経由）。
    // 非対応環境ではここで空タプルへ degrade し、レポート画面の統計表示は壊さない。
    let backend = match crate::ai::create_backend(app, crate::ai::BackendKind::FoundationModels) {
        Ok(b) => b,
        Err(e) => {
            log::warn!("generate_report_narrative: backend unavailable: {e}");
            return (String::new(), String::new());
        }
    };

    // report_type ごとに analyze へ渡す指示文を切り替える（見出し=summary / 注目点=suggestion）。
    let instruction = match (report_type, lang.as_str()) {
        (ReportType::CrossSummary, "en") => {
            "From the highlighted issues below, write a one-line headline and the key points to watch across projects."
        }
        (ReportType::CrossSummary, _) => {
            "以下の注目課題から、プロジェクト横断の見出し1行と、注目すべき点をまとめてください。"
        }
        (ReportType::Weekly, "en") => {
            "From the highlighted issues below, write a one-line headline and this week's key activity highlights."
        }
        (ReportType::Weekly, _) => {
            "以下の注目課題から、今週の見出し1行と、注目すべきアクティビティのハイライトをまとめてください。"
        }
        (ReportType::Monthly, "en") => {
            "From the highlighted issues below, write a one-line headline and this month's key activity highlights."
        }
        (ReportType::Monthly, _) => {
            "以下の注目課題から、今月の見出し1行と、注目すべきアクティビティのハイライトをまとめてください。"
        }
    };

    // analyze 経路を流用する（sidecar 改修なし）。issue_key は参照用ラベルにすぎないため合成ラベル。
    let input = crate::ai::AiAnalysisInput {
        issue_key: "REPORT-NARRATIVE".to_string(),
        summary: instruction.to_string(),
        description_head: context,
        status: String::new(),
        due_date: None,
        lang,
    };

    match crate::ai::LlmInference::infer(&backend, input).await {
        Ok(output) => {
            // summary=見出し1行 / suggestion=注目点（ハイライト）。前後空白は整える。
            (
                output.summary.trim().to_string(),
                output.suggestion.trim().to_string(),
            )
        }
        Err(e) => {
            log::warn!("generate_report_narrative: generation failed: {e}");
            (String::new(), String::new())
        }
    }
}

// ── v0.4.5 レポート期間キー・期間境界の算出（FR-V045-003） ─────────────────────

/// 指定日が属する ISO 週の期間キー（`YYYY-Www`）を返す（純粋関数。FR-V045-003）。
///
/// SQLite の `strftime('%W')` は ISO 週ではない（日曜起点・年境界の扱いが異なる）ため、chrono の
/// [`chrono::Datelike::iso_week`] を用いて ISO 8601 週番号（月曜起点）を確実に得る。週番号は
/// ゼロ詰め2桁で `W01`〜`W53`、年は ISO 週基準年（年初の数日が前年の最終週に属する場合があるため
/// 暦年ではなく `iso_week().year()` を用いる）。
///
/// # 引数
/// * `date` - 対象日（UTC ローカル日付）。
///
/// # 戻り値
/// `YYYY-Www` 形式の期間キー（例: "2026-W24"）。
pub(crate) fn iso_week_key(date: chrono::NaiveDate) -> String {
    use chrono::Datelike;
    let iso = date.iso_week();
    format!("{:04}-W{:02}", iso.year(), iso.week())
}

/// 指定日が属する ISO 週の半開区間 `[月曜00:00, 翌週月曜00:00)` を ISO8601(UTC) で返す（純粋関数）。
///
/// [`crate::db::DbClient::get_period_activity_stats`] は ISO8601 文字列の辞書順比較で期間内判定を
/// 行うため、週境界（月曜起点）を UTC の `YYYY-MM-DDT00:00:00Z` 形式で渡す。
///
/// # 引数
/// * `date` - 対象日。
///
/// # 戻り値
/// `(period_start, period_end)`。いずれも `YYYY-MM-DDT00:00:00Z`（半開区間。end は含まない）。
fn iso_week_bounds(date: chrono::NaiveDate) -> (String, String) {
    use chrono::Datelike;
    // 月曜起点へ巻き戻す（ISO では月曜が週初。weekday().num_days_from_monday() が経過日数）。
    let monday = date - chrono::Duration::days(date.weekday().num_days_from_monday() as i64);
    let next_monday = monday + chrono::Duration::days(7);
    (
        date_to_utc_midnight(monday),
        date_to_utc_midnight(next_monday),
    )
}

/// 指定日が属する月の期間キー（`YYYY-MM`）を返す（純粋関数。FR-V045-003）。
pub(crate) fn month_key(date: chrono::NaiveDate) -> String {
    use chrono::Datelike;
    format!("{:04}-{:02}", date.year(), date.month())
}

/// 指定日が属する月の半開区間 `[当月1日00:00, 翌月1日00:00)` を ISO8601(UTC) で返す（純粋関数）。
fn month_bounds(date: chrono::NaiveDate) -> (String, String) {
    use chrono::Datelike;
    let first = chrono::NaiveDate::from_ymd_opt(date.year(), date.month(), 1).unwrap_or(date);
    // 翌月1日: 12月のみ年を繰り上げる。
    let (ny, nm) = if date.month() == 12 {
        (date.year() + 1, 1)
    } else {
        (date.year(), date.month() + 1)
    };
    let next_first = chrono::NaiveDate::from_ymd_opt(ny, nm, 1).unwrap_or(first);
    (
        date_to_utc_midnight(first),
        date_to_utc_midnight(next_first),
    )
}

/// `NaiveDate` を `YYYY-MM-DDT00:00:00Z`（UTC 真夜中の ISO8601）へ整形する（純粋関数）。
fn date_to_utc_midnight(date: chrono::NaiveDate) -> String {
    format!("{}T00:00:00Z", date.format("%Y-%m-%d"))
}

// ── v0.4.5 レポート生成コマンド（FR-V045-002 / FR-V045-003 / FR-V045-006） ───────

/// 注目上位選定の入力群を DB から組み立てる（[`generate_reports`] の内部ヘルパー）。
///
/// 通常課題のメタ（課題キー・1行要約・リスク・遅延日数・停滞）を [`crate::db::DbClient::get_report_highlight_inputs`]
/// で一括取得し、各行を [`ReportHighlightInput`] へ変換する。プロジェクトキーは課題キーから導出する。
/// **新規 LLM 呼び出しは行わない**（既存 `ai_results` の再利用）。
///
/// # 引数
/// * `db` - データベースクライアント。
/// * `workspace_id` - 対象ワークスペースID。
///
/// # 戻り値
/// 注目候補の [`ReportHighlightInput`] ベクタ、または DB エラー。
async fn collect_report_highlight_inputs(
    db: &DbClient,
    workspace_id: i64,
) -> Result<Vec<ReportHighlightInput>, String> {
    let rows = db
        .get_report_highlight_inputs(workspace_id, REPORT_STALE_THRESHOLD_DAYS)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(
            |(issue_key, ai_summary, risk_level, delay_days, is_stale)| ReportHighlightInput {
                project_key: project_key_from_issue_key(&issue_key),
                risk_level: risk_level
                    .as_deref()
                    .and_then(crate::ai::RiskLevel::from_storage_str),
                issue_key,
                ai_summary,
                delay_days,
                is_stale,
            },
        )
        .collect())
}

/// レポート/サマリーを生成して保存し、保存した行を返す（FR-V045-002 / FR-V045-003 / FR-V045-006）
///
/// `report_type` に応じて統計を **SQL で決定的に集計**し（数値は LLM を使わない）、注目上位 N 件から
/// narrative（見出し・注目点）を **既存 `ai_results` の再利用 + `analyze` 経路流用**で生成して
/// [`crate::db::DbClient::save_report_summary`] で UPSERT する。横断サマリは `period_key='latest'`
/// で最新のみ上書き、週次/月次は「現在の期間キー」（ISO 週 `YYYY-Www` / 月次 `YYYY-MM`）で履歴保持する。
///
/// 期間キーは [`iso_week_key`]（chrono の ISO 週番号を使用。`strftime` は使わない）/ [`month_key`] で
/// 算出し、集計の期間境界は半開区間で [`crate::db::DbClient::get_period_activity_stats`] に渡す。
///
/// # 非阻害（degrade。NFR-V045-003）
/// AI 非対応・narrative 生成失敗のいずれでも `Err` にはせず、**統計のみ保存**して
/// narrative / headline は空（`None`）で degrade する（[`summarize_solutions`] の degrade 規約を踏襲）。
/// DB アクセス失敗のみ `Err` を返す。
///
/// # 引数
/// * `app` - sidecar 起動に用いる Tauri アプリケーションハンドル（自動注入）
/// * `workspace_id` - 対象ワークスペースID（横断は同一ワークスペース内のプロジェクト横断のみ）
/// * `report_type` - レポート種別（`'cross_summary'` / `'weekly'` / `'monthly'`）
/// * `lang` - 出力言語（`ja` / `en`。UI 言語に追従）
/// * `db` - データベースクライアント（自動注入）
///
/// # 戻り値
/// 保存した [`crate::db::ReportSummary`]。未知の `report_type` のみ `Err`。
#[tauri::command]
pub async fn generate_reports(
    app: tauri::AppHandle,
    workspace_id: i64,
    report_type: String,
    lang: String,
    db: State<'_, DbClient>,
) -> Result<crate::db::ReportSummary, String> {
    generate_report(&app, &db, workspace_id, &report_type, &lang).await
}

/// レポート/サマリーを生成・保存するコアロジック（コマンドとスケジューラの共通ヘルパー。FR-V045-005）
///
/// [`generate_reports`] コマンドの実体であり、スケジューラの1日1回バックグラウンド生成
/// （[`crate::scheduler`]）からも同じ生成経路を共有するために `pub(crate)` で切り出す。
/// `State<DbClient>` ではなく `&DbClient` / `&AppHandle` を受けることで、Tauri コマンド境界の
/// 外（スケジューラのバックグラウンドタスク）からも呼べるようにしている。
///
/// `report_type` に応じて統計を **SQL で決定的に集計**し（数値は LLM を使わない）、注目上位 N 件から
/// narrative（見出し・注目点）を **既存 `ai_results` の再利用 + `analyze` 経路流用**で生成して
/// [`crate::db::DbClient::save_report_summary`] で UPSERT する。横断サマリは `period_key='latest'`
/// で最新のみ上書き、週次/月次は「現在の期間キー」（ISO 週 `YYYY-Www` / 月次 `YYYY-MM`）で履歴保持する。
///
/// # 非阻害（degrade。NFR-V045-003）
/// AI 非対応・narrative 生成失敗のいずれでも `Err` にはせず、**統計のみ保存**して
/// narrative / headline は空（`None`）で degrade する。DB アクセス失敗・未知種別のみ `Err` を返す。
///
/// # 引数
/// * `app` - sidecar 起動に用いる Tauri アプリケーションハンドル。
/// * `db` - データベースクライアント。
/// * `workspace_id` - 対象ワークスペースID（横断は同一ワークスペース内のプロジェクト横断のみ）。
/// * `report_type` - レポート種別（`'cross_summary'` / `'weekly'` / `'monthly'`）。
/// * `lang` - 出力言語（`ja` / `en`。UI 言語に追従）。
///
/// # 戻り値
/// 保存した [`crate::db::ReportSummary`]。未知の `report_type`・DB エラーのみ `Err`。
pub(crate) async fn generate_report(
    app: &tauri::AppHandle,
    db: &DbClient,
    workspace_id: i64,
    report_type: &str,
    lang: &str,
) -> Result<crate::db::ReportSummary, String> {
    // report_type 文字列を内部 enum・期間キーへ解決する。未知種別のみ Err（degrade 対象外）。
    let (kind, period_key) = match report_type {
        "cross_summary" => (ReportType::CrossSummary, "latest".to_string()),
        "weekly" => (
            ReportType::Weekly,
            iso_week_key(chrono::Utc::now().date_naive()),
        ),
        "monthly" => (
            ReportType::Monthly,
            month_key(chrono::Utc::now().date_naive()),
        ),
        other => return Err(format!("unknown report_type: {other}")),
    };

    // 1. 統計を SQL で決定的に集計し、stats_json へシリアライズする（数値は LLM を使わない）。
    //    横断は CrossSummaryStat 配列、週次/月次は PeriodActivityStat 配列。
    let stats_json = match kind {
        ReportType::CrossSummary => {
            // 自分担当の要対応判定に用いる Backlog ユーザーIDをワークスペースから引く（無ければ None）。
            let me_user_id = db
                .get_workspaces()
                .await
                .map_err(|e| e.to_string())?
                .into_iter()
                .find(|w| w.id == workspace_id)
                .and_then(|w| w.user_id);
            let stats = db
                .get_cross_summary_stats(workspace_id, me_user_id, REPORT_STALE_THRESHOLD_DAYS)
                .await
                .map_err(|e| e.to_string())?;
            serde_json::to_string(&stats).map_err(|e| e.to_string())?
        }
        ReportType::Weekly | ReportType::Monthly => {
            let now = chrono::Utc::now().date_naive();
            let (period_start, period_end) = if kind == ReportType::Weekly {
                iso_week_bounds(now)
            } else {
                month_bounds(now)
            };
            let stats = db
                .get_period_activity_stats(workspace_id, &period_start, &period_end)
                .await
                .map_err(|e| e.to_string())?;
            serde_json::to_string(&stats).map_err(|e| e.to_string())?
        }
    };

    // 2. 注目上位 N 件 → compact context → narrative（見出し・注目点）。
    //    AI 非対応・生成失敗は空タプルへ degrade する（generate_report_narrative 内で処理）。
    let highlights = collect_report_highlight_inputs(db, workspace_id).await?;
    let context = build_report_context(&select_report_highlights(highlights));
    let (headline, narrative) =
        generate_report_narrative(app.clone(), context, lang.to_string(), kind).await;

    // 3. UPSERT 保存。空文字 narrative/headline は None（degrade）として保存する。
    let headline_opt = (!headline.trim().is_empty()).then_some(headline.as_str());
    let narrative_opt = (!narrative.trim().is_empty()).then_some(narrative.as_str());
    db.save_report_summary(
        workspace_id,
        report_type,
        &period_key,
        lang,
        Some(stats_json.as_str()),
        headline_opt,
        narrative_opt,
    )
    .await
    .map_err(|e| e.to_string())?;

    // 4. 保存した行を読み戻して返す（generated_at 等を確定値で返すため）。
    db.get_report_summary(workspace_id, report_type, &period_key, lang)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "report_summary not found after save".to_string())
}

/// 保存済みレポート/サマリーを1件取得する（FR-V045-006）
///
/// PK = (workspace_id, report_type, period_key, lang) に一致する行を返す
/// [`crate::db::DbClient::get_report_summary`] の薄いラッパー。横断サマリは `period_key='latest'`、
/// 週次/月次は期間キーで過去レポートも参照できる。未生成の場合は `None`（呼び出し側で degrade 表示）。
///
/// # 引数
/// * `workspace_id` - ワークスペースID
/// * `report_type` - レポート種別（`'cross_summary'` / `'weekly'` / `'monthly'`）
/// * `period_key` - 期間キー（横断は `'latest'`、週次は `'YYYY-Www'`、月次は `'YYYY-MM'`）
/// * `lang` - 出力言語（`ja` / `en`）
/// * `db` - データベースクライアント（自動注入）
///
/// # 戻り値
/// 該当する [`crate::db::ReportSummary`]（未生成なら `None`）。DB エラーのみ `Err`。
#[tauri::command]
pub async fn get_reports(
    workspace_id: i64,
    report_type: String,
    period_key: String,
    lang: String,
    db: State<'_, DbClient>,
) -> Result<Option<crate::db::ReportSummary>, String> {
    db.get_report_summary(workspace_id, &report_type, &period_key, &lang)
        .await
        .map_err(|e| e.to_string())
}

/// レポートの期間キー一覧を取得する（期間セレクタ用。FR-V045-003 / FR-V045-006）
///
/// 指定ワークスペース・レポート種別に保存されている `period_key` を、最終生成日時の降順
/// （最新が先頭）で返す [`crate::db::DbClient::list_report_periods`] の薄いラッパー。
/// 主に週次/月次レポートの期間セレクタで過去レポートを切り替えるために用いる。
///
/// # 引数
/// * `workspace_id` - ワークスペースID
/// * `report_type` - レポート種別（`'weekly'` / `'monthly'` など）
/// * `db` - データベースクライアント（自動注入）
///
/// # 戻り値
/// 期間キーのベクタ（生成日時降順）。DB エラーのみ `Err`。
#[tauri::command]
pub async fn list_report_periods(
    workspace_id: i64,
    report_type: String,
    db: State<'_, DbClient>,
) -> Result<Vec<String>, String> {
    db.list_report_periods(workspace_id, &report_type)
        .await
        .map_err(|e| e.to_string())
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

    // ── v0.4.5 レポート生成コアのテスト ──────────────────────────────────────

    /// 指定パラメータの注目候補を作る（テスト用ヘルパー）。
    fn hl(
        key: &str,
        risk: Option<crate::ai::RiskLevel>,
        delay: Option<i64>,
        stale: bool,
    ) -> ReportHighlightInput {
        ReportHighlightInput {
            issue_key: key.to_string(),
            project_key: project_key_from_issue_key(key),
            ai_summary: format!("summary of {key}"),
            risk_level: risk,
            delay_days: delay,
            is_stale: stale,
        }
    }

    #[test]
    fn highlight_prioritizes_overdue() {
        // 期限超過（主）が、超過なし・低リスクより上位に来る。
        use crate::ai::RiskLevel;
        let items = vec![
            hl("A-1", Some(RiskLevel::Low), Some(-5), false), // 猶予あり・低リスク → 低スコア
            hl("B-2", Some(RiskLevel::Low), Some(30), false), // 30日超過 → 高スコア
        ];
        let ranked = select_report_highlights(items);
        assert_eq!(ranked[0].issue_key, "B-2", "期限超過が優先される");
    }

    #[test]
    fn highlight_risk_outranks_stale() {
        // リスク（主）が停滞（従）より重い。high リスク（超過なし）が、停滞のみの課題より上位。
        use crate::ai::RiskLevel;
        let items = vec![
            hl("S-1", None, None, true),                   // 停滞のみ（+10）
            hl("H-2", Some(RiskLevel::High), None, false), // high リスク（+50）
        ];
        let ranked = select_report_highlights(items);
        assert_eq!(ranked[0].issue_key, "H-2", "高リスクが停滞より優先される");
    }

    #[test]
    fn highlight_clamps_to_max_issues() {
        // 候補が REPORT_HIGHLIGHT_MAX_ISSUES を超えても上位 N 件に切り詰められる。
        use crate::ai::RiskLevel;
        let items: Vec<ReportHighlightInput> = (0..(REPORT_HIGHLIGHT_MAX_ISSUES + 5))
            .map(|i| {
                hl(
                    &format!("P-{i}"),
                    Some(RiskLevel::Medium),
                    Some(i as i64),
                    false,
                )
            })
            .collect();
        let ranked = select_report_highlights(items);
        assert_eq!(
            ranked.len(),
            REPORT_HIGHLIGHT_MAX_ISSUES,
            "上位 N 件にクランプ"
        );
        // スコア降順: 先頭は最も超過日数が大きい（P-{max}）。
        for w in ranked.windows(2) {
            assert!(
                report_highlight_score(&w[0]) >= report_highlight_score(&w[1]),
                "スコア降順に並ぶ"
            );
        }
    }

    #[test]
    fn highlight_overdue_clamp_60() {
        // 極端な超過日数は 60 日でクランプされ、単独で順位を独占しない（リスク等と比較可能になる）。
        use crate::ai::RiskLevel;
        let extreme = hl("X-1", None, Some(10_000), false); // 超過は 60 にクランプ
        let high_risk = hl("Y-2", Some(RiskLevel::High), Some(20), false); // 20 + 50 = 70 > 60
        assert!(
            report_highlight_score(&high_risk) > report_highlight_score(&extreme),
            "クランプにより high リスク + 中程度超過が外れ値超過を上回りうる"
        );
    }

    #[test]
    fn report_context_compacts_meta_and_summary() {
        // context にプロジェクトキー・遅延・リスク・1行要約が含まれる（本文・コメントは含めない）。
        use crate::ai::RiskLevel;
        let items = vec![hl("PROJ-1", Some(RiskLevel::High), Some(7), true)];
        let ctx = build_report_context(&items);
        assert!(ctx.contains("[PROJ]"), "プロジェクトキー");
        assert!(ctx.contains("PROJ-1"), "課題キー");
        assert!(ctx.contains("overdue 7d"), "遅延日数");
        assert!(ctx.contains("risk high"), "リスク");
        assert!(ctx.contains("stale"), "停滞ラベル");
        assert!(
            ctx.contains("summary of PROJ-1"),
            "既存 ai_results の1行要約を再利用"
        );
    }

    #[test]
    fn report_context_caps_total_chars() {
        // 連結後の全体が REPORT_CONTEXT_MAX_CHARS を超えない。
        let items: Vec<ReportHighlightInput> = (0..REPORT_HIGHLIGHT_MAX_ISSUES)
            .map(|i| {
                let mut item = hl(&format!("P-{i}"), None, Some(1), false);
                item.ai_summary = "あ".repeat(2000);
                item
            })
            .collect();
        let ctx = build_report_context(&items);
        assert!(ctx.chars().count() <= REPORT_CONTEXT_MAX_CHARS);
    }

    #[test]
    fn report_context_empty_for_no_items() {
        assert!(build_report_context(&[]).is_empty());
    }

    // ── v0.4.5 期間キー・期間境界のテスト ────────────────────────────────────

    fn ymd(y: i32, m: u32, d: u32) -> chrono::NaiveDate {
        chrono::NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    #[test]
    fn iso_week_key_uses_iso_week_number() {
        // 2026-06-13(土)は ISO 第24週。strftime('%W')とは異なる ISO 週番号を使う。
        assert_eq!(iso_week_key(ymd(2026, 6, 13)), "2026-W24");
        // 週番号は2桁ゼロ詰め。
        assert_eq!(iso_week_key(ymd(2026, 1, 5)), "2026-W02");
    }

    #[test]
    fn iso_week_key_handles_year_boundary() {
        // 2027-01-01(金)は ISO 週基準では 2026 年の第53週に属する（暦年ではなく ISO 基準年を使う）。
        assert_eq!(iso_week_key(ymd(2027, 1, 1)), "2026-W53");
    }

    #[test]
    fn iso_week_bounds_is_monday_to_next_monday() {
        // 2026-06-13(土) を含む週は 2026-06-08(月) 〜 2026-06-15(月) の半開区間。
        let (start, end) = iso_week_bounds(ymd(2026, 6, 13));
        assert_eq!(start, "2026-06-08T00:00:00Z");
        assert_eq!(end, "2026-06-15T00:00:00Z");
        // 月曜当日でも同じ週境界（巻き戻し0日）。
        let (s2, e2) = iso_week_bounds(ymd(2026, 6, 8));
        assert_eq!(s2, "2026-06-08T00:00:00Z");
        assert_eq!(e2, "2026-06-15T00:00:00Z");
    }

    #[test]
    fn month_key_and_bounds_are_calendar_month() {
        assert_eq!(month_key(ymd(2026, 6, 13)), "2026-06");
        let (start, end) = month_bounds(ymd(2026, 6, 13));
        assert_eq!(start, "2026-06-01T00:00:00Z");
        assert_eq!(end, "2026-07-01T00:00:00Z");
    }

    #[test]
    fn month_bounds_rolls_over_year_in_december() {
        // 12月の翌月境界は翌年1月1日（年繰り上げ）。
        assert_eq!(month_key(ymd(2026, 12, 31)), "2026-12");
        let (start, end) = month_bounds(ymd(2026, 12, 31));
        assert_eq!(start, "2026-12-01T00:00:00Z");
        assert_eq!(end, "2027-01-01T00:00:00Z");
    }
}
