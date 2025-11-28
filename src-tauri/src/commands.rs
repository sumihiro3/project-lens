use crate::backlog::BacklogClient;
use crate::db::DbClient;
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
    format!("Hello, {}! You've been greeted from Rust!", name)
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
                    format!("ProjectLens: 重要なチケットが {} 件あります", high_priority_count)
                } else {
                    format!("ProjectLens: {} important tickets", high_priority_count)
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

#[tauri::command]
pub async fn save_workspace(
    db: State<'_, DbClient>,
    domain: String,
    api_key: String,
    project_keys: Vec<String>,
) -> Result<(), String> {
    let keys_str = project_keys.join(",");
    db.save_workspace(&domain, &api_key, &keys_str)
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
pub async fn fetch_issues(
    app: tauri::AppHandle,
    db: State<'_, DbClient>,
) -> Result<usize, String> {
    let workspaces = db.get_workspaces().await.map_err(|e| e.to_string())?;
    let mut total_count = 0;
    let mut all_issues_for_tooltip = Vec::new();

    for workspace in workspaces {
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
            // 各プロジェクトの課題を取得
            match client.get_issues(key, &target_status_ids).await {
                Ok(mut issues) => {
                    workspace_issues.append(&mut issues);
                    synced_projects.push(key);
                }
                Err(e) => eprintln!("Failed to fetch issues for project {}: {}", key, e),
            }
        }

        // 現在のユーザー情報を取得
        let me = match client.get_myself().await {
            Ok(me) => me,
            Err(e) => {
                eprintln!("Failed to get myself for {}: {}", domain, e);
                continue;
            }
        };

        // 各課題のスコアを計算
        for issue in &mut workspace_issues {
            issue.relevance_score = crate::scoring::ScoringService::calculate_score(issue, &me);
            issue.workspace_id = workspace.id;
        }

        // データベースに保存
        db.save_issues(workspace.id, &workspace_issues, &synced_projects, &project_keys)
            .await
            .map_err(|e| e.to_string())?;
            
        total_count += workspace_issues.len();
        all_issues_for_tooltip.append(&mut workspace_issues);
    }

    // トレイのツールチップを更新
    let high_priority_count = all_issues_for_tooltip
        .iter()
        .filter(|i| i.relevance_score >= 80)
        .count();
    
    // 言語設定を取得（デフォルトは日本語）
    let lang = db.get_setting("language").await.unwrap_or(Some("ja".to_string())).unwrap_or("ja".to_string());

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
