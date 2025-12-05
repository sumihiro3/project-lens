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

/// ワークスペースIDからワークスペース情報を取得
#[tauri::command]
pub async fn get_workspace_by_id(db: State<'_, DbClient>, workspace_id: i64) -> Result<Option<crate::db::Workspace>, String> {
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
    db.save_workspace(&domain, &api_key, &keys_str, Some(me.id), Some(me.name), true, None, None, None)
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

    db.save_workspace(
        &workspace.domain,
        &workspace.api_key,
        &workspace.project_keys,
        workspace.user_id,
        workspace.user_name,
        enabled,
        workspace.api_limit,
        workspace.api_remaining,
        workspace.api_reset,
    )
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
        // 無効なワークスペースはスキップし、関連する課題を削除
        if !workspace.enabled {
            if let Err(e) = db.delete_workspace_issues(workspace.id).await {
                eprintln!("Failed to delete issues for disabled workspace {}: {}", workspace.id, e);
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
                    if let Err(e) = db.save_workspace_usage(
                        workspace.id,
                        rate_limit.limit,
                        rate_limit.remaining,
                        rate_limit.reset
                    ).await {
                        eprintln!("Failed to save workspace usage: {}", e);
                    }
                }
                Err(e) => {
                    eprintln!("Failed to fetch issues for project {}: {}", key, e);
                    // エラーが発生しても他のプロジェクトの取得は継続
                }
            }
        }
        let me = match client.get_myself().await {
            Ok(me) => me,
            Err(e) => {
                eprintln!("Failed to get myself for {}: {}", domain, e);
                continue;
            }
        };

        // ユーザー情報を更新（まだ保存されていない場合のために）
        if workspace.user_id.is_none() || workspace.user_name.is_none() {
            let _ = db.save_workspace(
                &domain, 
                &api_key, 
                &project_key, 
                Some(me.id), 
                Some(me.name.clone()),
                workspace.enabled,
                workspace.api_limit,
                workspace.api_remaining,
                workspace.api_reset,
            ).await;
        }

        // 各課題のスコアを計算
        for issue in &mut workspace_issues {
            issue.relevance_score = crate::scoring::ScoringService::calculate_score(issue, &me);
            issue.workspace_id = workspace.id;
        }

        // データベースに保存
        // Vec<String> を Vec<&str> に変換
        let synced_projects_refs: Vec<&str> = synced_projects.iter().map(|s| s.as_str()).collect();
        
        db.save_issues(workspace.id, &workspace_issues, &synced_projects_refs, &project_keys)
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

#[cfg(test)]
mod tests {
    use super::*;

    /// greet関数が正しいメッセージを返すことを確認
    #[test]
    fn test_greet() {
        let result = greet("World");
        assert_eq!(result, "Hello, World! You've been greeted from Rust!");
    }

    /// greet関数が空文字列でも動作することを確認
    #[test]
    fn test_greet_empty_name() {
        let result = greet("");
        assert_eq!(result, "Hello, ! You've been greeted from Rust!");
    }

    /// greet関数が日本語でも動作することを確認
    #[test]
    fn test_greet_japanese() {
        let result = greet("世界");
        assert_eq!(result, "Hello, 世界! You've been greeted from Rust!");
    }
}

// Note: Tauriコマンドの完全な統合テストは、AppHandleやStateのモックが必要で非常に複雑です。
// これらのコマンドの大部分はdb.rsとbacklog.rsの機能を呼び出しており、
// それらは既に包括的にテストされています。
// したがって、このテストモジュールではState不要の純粋関数（greet）のみをテストしています。
//
// コマンド層の他の部分は以下の理由でテスト済みと見なせます：
// - save_settings, get_settings, get_workspaces, save_workspace, delete_workspace等は
//   DbClientのメソッドを直接呼び出しており、db.rsで既にテスト済み
// - fetch_issuesとfetch_projectsはBacklogClientを使用しており、backlog.rsで基本動作を確認済み
// - エラーハンドリングは.map_err(|e| e.to_string())で統一されているため、シンプルで明確
