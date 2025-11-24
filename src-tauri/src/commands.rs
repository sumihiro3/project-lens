use tauri::State;
use crate::db::DbClient;
use crate::backlog::BacklogClient;

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
pub async fn save_settings(key: String, value: String, db: State<'_, DbClient>) -> Result<(), String> {
    db.save_setting(&key, &value).await.map_err(|e| e.to_string())
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
pub async fn fetch_issues(db: State<'_, DbClient>) -> Result<usize, String> {
    // 設定を取得
    let domain = db.get_setting("domain").await.map_err(|e| e.to_string())?
        .ok_or("Domain not set")?;
    let api_key = db.get_setting("api_key").await.map_err(|e| e.to_string())?
        .ok_or("API Key not set")?;
    let project_key = db.get_setting("project_key").await.map_err(|e| e.to_string())?
        .ok_or("Project Key not set")?;

    // Backlog APIクライアントを作成
    let client = BacklogClient::new(&domain, &api_key);
    
    // 取得対象のステータスID（未対応:1, 処理中:2, 処理済み:3）
    // 完了(4)は除外する
    let target_status_ids = vec![1, 2, 3];

    // 課題を取得
    let mut issues = client.get_issues(&project_key, &target_status_ids).await.map_err(|e| e.to_string())?;
    
    // 現在のユーザー情報を取得
    let me = client.get_myself().await.map_err(|e| e.to_string())?;
    
    // 各課題のスコアを計算
    for issue in &mut issues {
        issue.relevance_score = crate::scoring::ScoringService::calculate_score(issue, &me);
    }
    
    // データベースに保存
    let count = issues.len();
    db.save_issues(&issues).await.map_err(|e| e.to_string())?;

    Ok(count)
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
