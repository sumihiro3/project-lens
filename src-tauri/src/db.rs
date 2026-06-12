use crate::backlog::Issue;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite, SqlitePool};

/// ワークスペース情報
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Workspace {
    pub id: i64,
    pub domain: String,
    pub api_key: String,
    pub project_keys: String,
    pub user_id: Option<i64>,
    pub user_name: Option<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub api_limit: Option<i64>,
    pub api_remaining: Option<i64>,
    pub api_reset: Option<String>,
}

/// デフォルトでenabledはtrue
fn default_enabled() -> bool {
    true
}

/// データベースクライアント
///
/// SQLiteデータベースへのアクセスを提供するクライアント。
/// 設定、課題データの保存・取得を担当する。
#[derive(Clone)]
pub struct DbClient {
    /// SQLiteコネクションプール
    pool: Pool<Sqlite>,
}

impl DbClient {
    /// URLからデータベースクライアントを作成
    ///
    /// # 引数
    /// * `db_url` - データベースURL（例: "sqlite://path/to/db.sqlite"）
    ///
    /// # 戻り値
    /// データベースクライアント、またはエラー
    #[allow(dead_code)]
    pub async fn new(db_url: &str) -> Result<Self> {
        let pool = SqlitePool::connect(db_url).await?;
        Ok(Self { pool })
    }

    /// オプション指定でデータベースクライアントを作成
    ///
    /// データベースファイルが存在しない場合に自動作成するなど、
    /// 詳細なオプションを指定してクライアントを作成する。
    ///
    /// # 引数
    /// * `options` - SQLite接続オプション
    ///
    /// # 戻り値
    /// データベースクライアント、またはエラー
    pub async fn new_with_options(options: sqlx::sqlite::SqliteConnectOptions) -> Result<Self> {
        let pool = SqlitePool::connect_with(options).await?;
        Ok(Self { pool })
    }

    /// データベースのマイグレーションを実行
    ///
    /// テーブルが存在しない場合に作成する。
    /// アプリケーション起動時に呼び出される。
    pub async fn migrate(&self) -> Result<()> {
        // テーブル作成のSQLを順次実行
        
        // settings table
        sqlx::query(r#"
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        "#).execute(&self.pool).await?;

        // sync_state table
        sqlx::query(r#"
            CREATE TABLE IF NOT EXISTS sync_state (
                project_id TEXT PRIMARY KEY,
                last_synced_at TEXT NOT NULL
            );
        "#).execute(&self.pool).await?;

        // workspaces table
        sqlx::query(r#"
            CREATE TABLE IF NOT EXISTS workspaces (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                domain TEXT NOT NULL,
                api_key TEXT NOT NULL,
                project_keys TEXT NOT NULL,
                user_id INTEGER,
                user_name TEXT,
                enabled INTEGER DEFAULT 1,
                api_limit INTEGER,
                api_remaining INTEGER,
                api_reset TEXT
            );
        "#).execute(&self.pool).await?;

        // 既存のworkspacesテーブルに新しいカラムを追加（存在しない場合のみ）
        // SQLiteはALTER TABLE ADD COLUMN IF NOT EXISTSをサポートしていないため、
        // エラーを無視する方法で対応
        let _ = sqlx::query("ALTER TABLE workspaces ADD COLUMN enabled INTEGER DEFAULT 1")
            .execute(&self.pool).await;
        let _ = sqlx::query("ALTER TABLE workspaces ADD COLUMN api_limit INTEGER")
            .execute(&self.pool).await;
        let _ = sqlx::query("ALTER TABLE workspaces ADD COLUMN api_remaining INTEGER")
            .execute(&self.pool).await;
        let _ = sqlx::query("ALTER TABLE workspaces ADD COLUMN api_reset TEXT")
            .execute(&self.pool).await;

        // issues table
        sqlx::query(r#"
            CREATE TABLE IF NOT EXISTS issues (
                id INTEGER NOT NULL,
                workspace_id INTEGER NOT NULL,
                issue_key TEXT NOT NULL,
                summary TEXT NOT NULL,
                description TEXT,
                priority TEXT,
                status TEXT,
                assignee TEXT,
                due_date TEXT,
                updated_at TEXT,
                relevance_score INTEGER DEFAULT 0,
                ai_summary TEXT,
                raw_data TEXT,
                PRIMARY KEY (workspace_id, id),
                FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
            );
        "#).execute(&self.pool).await?;

        Ok(())
    }

    /// 設定を保存
    ///
    /// キーと値のペアで設定を保存する。
    /// 既存のキーがある場合は上書きされる（UPSERT）。
    ///
    /// # 引数
    /// * `key` - 設定のキー
    /// * `value` - 設定の値
    ///
    /// # 戻り値
    /// 成功時は`Ok(())`、失敗時はエラー
    pub async fn save_setting(&self, key: &str, value: &str) -> Result<()> {
        sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
            .bind(key)
            .bind(value)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// 設定を取得
    ///
    /// 指定されたキーの設定値を取得する。
    ///
    /// # 引数
    /// * `key` - 設定のキー
    ///
    /// # 戻り値
    /// 設定値（存在しない場合は`None`）、またはエラー
    pub async fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
            .bind(key)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|r| r.0))
    }

    /// ワークスペース一覧を取得
    pub async fn get_workspaces(&self) -> Result<Vec<Workspace>> {
        let workspaces = sqlx::query_as::<_, Workspace>(
            "SELECT id, domain, api_key, project_keys, user_id, user_name, 
             COALESCE(enabled, 1) as enabled, api_limit, api_remaining, api_reset 
             FROM workspaces ORDER BY id"
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(workspaces)
    }

    /// ワークスペースを保存（新規作成または更新）
    pub async fn save_workspace(
        &self, 
        domain: &str, 
        api_key: &str, 
        project_keys: &str,
        user_id: Option<i64>,
        user_name: Option<String>,
        enabled: bool,
        api_limit: Option<i64>,
        api_remaining: Option<i64>,
        api_reset: Option<String>
    ) -> Result<()> {
        // ドメインが同じものがあれば更新、なければ新規作成
        // ここではドメインをユニークキーのように扱う
        let existing: Option<(i64,)> = sqlx::query_as("SELECT id FROM workspaces WHERE domain = ?")
            .bind(domain)
            .fetch_optional(&self.pool)
            .await?;

        if let Some((id,)) = existing {
            sqlx::query("UPDATE workspaces SET api_key = ?, project_keys = ?, user_id = ?, user_name = ?, enabled = ?, api_limit = ?, api_remaining = ?, api_reset = ? WHERE id = ?")
                .bind(api_key)
                .bind(project_keys)
                .bind(user_id)
                .bind(user_name)
                .bind(enabled as i64)
                .bind(api_limit)
                .bind(api_remaining)
                .bind(api_reset)
                .bind(id)
                .execute(&self.pool)
                .await?;
        } else {
            sqlx::query("INSERT INTO workspaces (domain, api_key, project_keys, user_id, user_name, enabled, api_limit, api_remaining, api_reset) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(domain)
                .bind(api_key)
                .bind(project_keys)
                .bind(user_id)
                .bind(user_name)
                .bind(enabled as i64)
                .bind(api_limit)
                .bind(api_remaining)
                .bind(api_reset)
                .execute(&self.pool)
                .await?;
        }
        Ok(())
    }

    /// ワークスペースを削除
    pub async fn delete_workspace(&self, id: i64) -> Result<()> {
        sqlx::query("DELETE FROM workspaces WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// ワークスペースのAPI使用状況を更新
    pub async fn save_workspace_usage(
        &self,
        workspace_id: i64,
        limit: Option<i64>,
        remaining: Option<i64>,
        reset: Option<String>,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE workspaces SET api_limit = ?, api_remaining = ?, api_reset = ? WHERE id = ?"
        )
        .bind(limit)
        .bind(remaining)
        .bind(reset)
        .bind(workspace_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// 課題を保存
    ///
    /// 課題のリストをデータベースに保存する。
    /// 既存の課題（同じID）がある場合は上書きされる。
    /// また、以下のクリーンアップを行う：
    /// 1. 同期に成功したプロジェクトについて、新しいリストに含まれていない課題（完了など）を削除
    /// 2. 設定に含まれていないプロジェクトの課題を削除（プロジェクト選択解除時など）
    ///
    /// # 引数
    /// * `issues` - 保存する課題のスライス
    /// * `synced_project_keys` - 同期に成功したプロジェクトキーのリスト
    /// * `all_project_keys` - 設定されている全てのプロジェクトキーのリスト
    ///
    /// # 戻り値
    /// 成功時は`Ok(())`、失敗時はエラー
    pub async fn save_issues(
        &self,
        workspace_id: i64,
        issues: &[Issue],
        synced_project_keys: &[&str],
        all_project_keys: &[&str],
    ) -> Result<()> {
        let mut transaction = self.pool.begin().await?;

        // 1. 新しい課題を保存/更新
        for issue in issues {
            // 課題全体をJSONとして保存（raw_data）
            let raw_data = serde_json::to_string(issue)?;

            // 検索・表示用に一部のフィールドを個別カラムに展開
            let priority = issue.priority.as_ref().map(|p| p.name.clone());
            let status = issue.status.as_ref().map(|s| s.name.clone());
            let assignee = issue.assignee.as_ref().map(|u| u.name.clone());

            sqlx::query(
                r#"
                INSERT OR REPLACE INTO issues 
                (id, workspace_id, issue_key, summary, description, priority, status, assignee, due_date, updated_at, raw_data, relevance_score)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                "#
            )
            .bind(issue.id)
            .bind(workspace_id)
            .bind(&issue.issue_key)
            .bind(&issue.summary)
            .bind(&issue.description)
            .bind(priority)
            .bind(status)
            .bind(assignee)
            .bind(&issue.due_date)
            .bind(&issue.updated)
            .bind(raw_data)
            .bind(issue.relevance_score)
            .execute(&mut *transaction)
            .await?;
        }

        // 2. 同期されたプロジェクトの古い課題を削除
        // 新しいリストに含まれる課題IDのリストを作成
        let new_issue_ids: Vec<i64> = issues.iter().map(|i| i.id).collect();

        // IDリストをカンマ区切りの文字列に変換（SQLのIN句用）
        let id_list = if new_issue_ids.is_empty() {
            "0".to_string()
        } else {
            new_issue_ids
                .iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
                .join(",")
        };

        for project_key in synced_project_keys {
            // そのプロジェクトに属するが、新しいリストに含まれていない課題を削除
            let sql = format!(
                "DELETE FROM issues WHERE workspace_id = ? AND issue_key LIKE ? || '-%' AND id NOT IN ({})",
                id_list
            );

            sqlx::query(&sql)
                .bind(workspace_id)
                .bind(project_key)
                .execute(&mut *transaction)
                .await?;
        }

        // 3. 設定に含まれていないプロジェクトの課題を削除
        if !all_project_keys.is_empty() {
            // 設定されているプロジェクト以外の課題を削除
            let mut conditions = Vec::new();
            for _ in all_project_keys {
                conditions.push("issue_key NOT LIKE ? || '-%'");
            }
            let sql = format!("DELETE FROM issues WHERE workspace_id = ? AND ({})", conditions.join(" AND "));

            let mut query = sqlx::query(&sql).bind(workspace_id);
            for key in all_project_keys {
                query = query.bind(key);
            }
            query.execute(&mut *transaction).await?;
        } else {
            // プロジェクトが一つも設定されていない場合は、このワークスペースの課題を全削除
            sqlx::query("DELETE FROM issues WHERE workspace_id = ?")
                .bind(workspace_id)
                .execute(&mut *transaction)
                .await?;
        }

        transaction.commit().await?;
        Ok(())
    }

    /// 指定されたワークスペースの課題をすべて削除
    pub async fn delete_workspace_issues(&self, workspace_id: i64) -> Result<()> {
        sqlx::query("DELETE FROM issues WHERE workspace_id = ?")
            .bind(workspace_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// 課題一覧を取得
    ///
    /// データベースに保存されている全ての課題を取得する。関連度スコアの降順で取得する。
    /// スコアが高い（重要度が高い）課題が先頭に来る。
    ///
    /// # 戻り値
    /// 課題のベクタ（スコア降順）、またはエラー
    pub async fn get_issues(&self) -> Result<Vec<Issue>> {
        // raw_dataとスコアを取得し、スコア降順でソート
        let rows: Vec<(String, i32, i64)> = sqlx::query_as(
            "SELECT raw_data, relevance_score, workspace_id FROM issues ORDER BY relevance_score DESC",
        )
        .fetch_all(&self.pool)
        .await?;

        // JSONをデシリアライズしてスコアとワークスペースIDを設定
        let issues = rows
            .into_iter()
            .filter_map(|(json, score, workspace_id)| {
                let mut issue: Issue = serde_json::from_str(&json).ok()?;
                issue.relevance_score = score;
                issue.workspace_id = workspace_id;
                Some(issue)
            })
            .collect();

        Ok(issues)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqliteConnectOptions;
    use std::str::FromStr;

    /// テスト用のインメモリデータベースクライアントを作成
    async fn create_test_db() -> DbClient {
        // 共有メモリモードを使用してコネクションプール内の全コネクションが同じDBを参照するようにする
        let options = SqliteConnectOptions::from_str("sqlite::memory:?cache=shared")
            .expect("Failed to parse DB options")
            .create_if_missing(true);
        
        let client = DbClient::new_with_options(options).await.expect("Failed to create DB client");
        client.migrate().await.expect("Migration failed");
        client
    }

    /// テスト用のIssueを作成するヘルパー関数
    fn create_test_issue(id: i64, issue_key: &str, summary: &str) -> Issue {
        Issue {
            id,
            issue_key: issue_key.to_string(),
            summary: summary.to_string(),
            description: None,
            priority: None,
            status: None,
            issue_type: None,
            assignee: None,
            due_date: None,
            updated: None,
            relevance_score: 0,
            workspace_id: 0,
        }
    }

    /// マイグレーションが正常に実行され、テーブルが作成されることを確認
    #[tokio::test]
    async fn test_migrate_creates_tables() {
        let db = create_test_db().await;
        
        // 各テーブルが存在することを個別に確認
        let settings_exists: Result<Vec<(i64,)>, _> = sqlx::query_as("SELECT COUNT(*) FROM settings")
            .fetch_all(&db.pool).await;
        assert!(settings_exists.is_ok(), "settings table should exist");
        
        let sync_state_exists: Result<Vec<(i64,)>, _> = sqlx::query_as("SELECT COUNT(*) FROM sync_state")
            .fetch_all(&db.pool).await;
        assert!(sync_state_exists.is_ok(), "sync_state table should exist");
        
        let workspaces_exists: Result<Vec<(i64,)>, _> = sqlx::query_as("SELECT COUNT(*) FROM workspaces")
            .fetch_all(&db.pool).await;
        assert!(workspaces_exists.is_ok(), "workspaces table should exist");
        
        let issues_exists: Result<Vec<(i64,)>, _> = sqlx::query_as("SELECT COUNT(*) FROM issues")
            .fetch_all(&db.pool).await;
        assert!(issues_exists.is_ok(), "issues table should exist");
    }

    /// 設定の保存と取得が正しく動作することを確認
    #[tokio::test]
    async fn test_save_and_get_setting() {
        let db = create_test_db().await;
        
        db.save_setting("test_key", "test_value").await.unwrap();
        let value = db.get_setting("test_key").await.unwrap();
        
        assert_eq!(value, Some("test_value".to_string()));
    }

    /// 存在しない設定キーの取得でNoneが返ることを確認
    #[tokio::test]
    async fn test_get_nonexistent_setting() {
        let db = create_test_db().await;
        
        let value = db.get_setting("nonexistent").await.unwrap();
        
        assert_eq!(value, None);
    }

    /// 既存の設定キーの更新（UPSERT）が正しく動作することを確認
    #[tokio::test]
    async fn test_update_existing_setting() {
        let db = create_test_db().await;
        
        db.save_setting("key", "value1").await.unwrap();
        db.save_setting("key", "value2").await.unwrap();
        let value = db.get_setting("key").await.unwrap();
        
        assert_eq!(value, Some("value2".to_string()));
    }

    /// ワークスペースの保存と取得が正しく動作することを確認
    #[tokio::test]
    async fn test_save_and_get_workspace() {
        let db = create_test_db().await;
        
        db.save_workspace(
            "example.backlog.com",
            "api-key-123",
            "PROJ1,PROJ2",
            Some(1),
            Some("Test User".to_string()),
            true,
            Some(5000),
            Some(4999),
            Some("1234567890".to_string())
        ).await.unwrap();
        
        let workspaces = db.get_workspaces().await.unwrap();
        
        assert_eq!(workspaces.len(), 1);
        assert_eq!(workspaces[0].domain, "example.backlog.com");
        assert_eq!(workspaces[0].api_key, "api-key-123");
        assert_eq!(workspaces[0].project_keys, "PROJ1,PROJ2");
        assert_eq!(workspaces[0].user_id, Some(1));
        assert_eq!(workspaces[0].user_name, Some("Test User".to_string()));
        assert_eq!(workspaces[0].enabled, true);
        assert_eq!(workspaces[0].api_limit, Some(5000));
        assert_eq!(workspaces[0].api_remaining, Some(4999));
        assert_eq!(workspaces[0].api_reset, Some("1234567890".to_string()));
    }

    /// 同じドメインのワークスペースを保存すると更新されることを確認
    #[tokio::test]
    async fn test_update_existing_workspace() {
        let db = create_test_db().await;
        
        db.save_workspace(
            "example.backlog.com",
            "old-key",
            "PROJ1",
            None,
            None,
            true,
            None,
            None,
            None
        ).await.unwrap();
        
        db.save_workspace(
            "example.backlog.com",
            "new-key",
            "PROJ1,PROJ2",
            Some(1),
            Some("User".to_string()),
            false,
            Some(1000),
            Some(999),
            Some("9999".to_string())
        ).await.unwrap();
        
        let workspaces = db.get_workspaces().await.unwrap();
        
        assert_eq!(workspaces.len(), 1, "同じドメインなので1つのみ");
        assert_eq!(workspaces[0].api_key, "new-key", "新しいキーに更新されている");
        assert_eq!(workspaces[0].project_keys, "PROJ1,PROJ2");
        assert_eq!(workspaces[0].enabled, false);
    }

    /// ワークスペースの削除が正しく動作することを確認
    #[tokio::test]
    async fn test_delete_workspace() {
        let db = create_test_db().await;
        
        db.save_workspace(
            "example.backlog.com",
            "api-key",
            "PROJ1",
            None,
            None,
            true,
            None,
            None,
            None
        ).await.unwrap();
        
        let workspaces = db.get_workspaces().await.unwrap();
        let workspace_id = workspaces[0].id;
        
        db.delete_workspace(workspace_id).await.unwrap();
        
        let workspaces = db.get_workspaces().await.unwrap();
        assert_eq!(workspaces.len(), 0);
    }

    /// ワークスペースが空の状態で取得すると空配列が返ることを確認
    #[tokio::test]
    async fn test_get_empty_workspaces() {
        let db = create_test_db().await;
        
        let workspaces = db.get_workspaces().await.unwrap();
        
        assert_eq!(workspaces.len(), 0);
    }

    /// ワークスペースのAPI使用状況更新が正しく動作することを確認
    #[tokio::test]
    async fn test_save_workspace_usage() {
        let db = create_test_db().await;
        
        db.save_workspace(
            "example.backlog.com",
            "api-key",
            "PROJ1",
            None,
            None,
            true,
            None,
            None,
            None
        ).await.unwrap();
        
        let workspaces = db.get_workspaces().await.unwrap();
        let workspace_id = workspaces[0].id;
        
        db.save_workspace_usage(
            workspace_id,
            Some(5000),
            Some(4500),
            Some("1234567890".to_string())
        ).await.unwrap();
        
        let workspaces = db.get_workspaces().await.unwrap();
        assert_eq!(workspaces[0].api_limit, Some(5000));
        assert_eq!(workspaces[0].api_remaining, Some(4500));
        assert_eq!(workspaces[0].api_reset, Some("1234567890".to_string()));
    }

    /// 課題の保存と取得が正しく動作することを確認
    #[tokio::test]
    async fn test_save_and_get_issues() {
        let db = create_test_db().await;
        
        // ワークスペースを作成
        db.save_workspace("example.backlog.com", "key", "PROJ", None, None, true, None, None, None).await.unwrap();
        let workspaces = db.get_workspaces().await.unwrap();
        let workspace_id = workspaces[0].id;
        
        let issues = vec![
            create_test_issue(1, "PROJ-1", "Issue 1"),
            create_test_issue(2, "PROJ-2", "Issue 2"),
        ];
        
        db.save_issues(workspace_id, &issues, &["PROJ"], &["PROJ"]).await.unwrap();
        
        let saved_issues = db.get_issues().await.unwrap();
        
        assert_eq!(saved_issues.len(), 2);
        assert_eq!(saved_issues[0].issue_key, "PROJ-1");
        assert_eq!(saved_issues[1].issue_key, "PROJ-2");
    }

    /// 課題の更新（UPSERT）が正しく動作することを確認
    #[tokio::test]
    async fn test_update_existing_issues() {
        let db = create_test_db().await;
        
        db.save_workspace("example.backlog.com", "key", "PROJ", None, None, true, None, None, None).await.unwrap();
        let workspaces = db.get_workspaces().await.unwrap();
        let workspace_id = workspaces[0].id;
        
        let issues_v1 = vec![create_test_issue(1, "PROJ-1", "Old Summary")];
        db.save_issues(workspace_id, &issues_v1, &["PROJ"], &["PROJ"]).await.unwrap();
        
        let issues_v2 = vec![create_test_issue(1, "PROJ-1", "New Summary")];
        db.save_issues(workspace_id, &issues_v2, &["PROJ"], &["PROJ"]).await.unwrap();
        
        let saved_issues = db.get_issues().await.unwrap();
        
        assert_eq!(saved_issues.len(), 1);
        assert_eq!(saved_issues[0].summary, "New Summary");
    }

    /// 同期されていない古い課題が削除されることを確認
    #[tokio::test]
    async fn test_delete_old_issues_from_synced_projects() {
        let db = create_test_db().await;
        
        db.save_workspace("example.backlog.com", "key", "PROJ", None, None, true, None, None, None).await.unwrap();
        let workspaces = db.get_workspaces().await.unwrap();
        let workspace_id = workspaces[0].id;
        
        // 最初に3つの課題を保存
        let issues_v1 = vec![
            create_test_issue(1, "PROJ-1", "Issue 1"),
            create_test_issue(2, "PROJ-2", "Issue 2"),
            create_test_issue(3, "PROJ-3", "Issue 3"),
        ];
        db.save_issues(workspace_id, &issues_v1, &["PROJ"], &["PROJ"]).await.unwrap();
        
        // 次に2つだけ保存（PROJ-3は削除されるべき）
        let issues_v2 = vec![
            create_test_issue(1, "PROJ-1", "Issue 1"),
            create_test_issue(2, "PROJ-2", "Issue 2"),
        ];
        db.save_issues(workspace_id, &issues_v2, &["PROJ"], &["PROJ"]).await.unwrap();
        
        let saved_issues = db.get_issues().await.unwrap();
        
        assert_eq!(saved_issues.len(), 2);
        assert!(saved_issues.iter().all(|i| i.id != 3));
    }

    /// ワークスペースの課題一括削除が正しく動作することを確認
    #[tokio::test]
    async fn test_delete_workspace_issues() {
        let db = create_test_db().await;
        
        db.save_workspace("example.backlog.com", "key", "PROJ", None, None, true, None, None, None).await.unwrap();
        let workspaces = db.get_workspaces().await.unwrap();
        let workspace_id = workspaces[0].id;
        
        let issues = vec![
            create_test_issue(1, "PROJ-1", "Issue 1"),
            create_test_issue(2, "PROJ-2", "Issue 2"),
        ];
        db.save_issues(workspace_id, &issues, &["PROJ"], &["PROJ"]).await.unwrap();
        
        db.delete_workspace_issues(workspace_id).await.unwrap();
        
        let saved_issues = db.get_issues().await.unwrap();
        assert_eq!(saved_issues.len(), 0);
    }

    /// 課題がスコア降順で取得されることを確認
    #[tokio::test]
    async fn test_get_issues_ordered_by_score() {
        let db = create_test_db().await;
        
        db.save_workspace("example.backlog.com", "key", "PROJ", None, None, true, None, None, None).await.unwrap();
        let workspaces = db.get_workspaces().await.unwrap();
        let workspace_id = workspaces[0].id;
        
        let mut issue1 = create_test_issue(1, "PROJ-1", "Low Priority");
        issue1.relevance_score = 10;
        
        let mut issue2 = create_test_issue(2, "PROJ-2", "High Priority");
        issue2.relevance_score = 100;
        
        let mut issue3 = create_test_issue(3, "PROJ-3", "Medium Priority");
        issue3.relevance_score = 50;
        
        let issues = vec![issue1, issue2, issue3];
        db.save_issues(workspace_id, &issues, &["PROJ"], &["PROJ"]).await.unwrap();
        
        let saved_issues = db.get_issues().await.unwrap();
        
        assert_eq!(saved_issues.len(), 3);
        assert_eq!(saved_issues[0].relevance_score, 100, "最高スコアが最初");
        assert_eq!(saved_issues[1].relevance_score, 50, "中間スコアが2番目");
        assert_eq!(saved_issues[2].relevance_score, 10, "最低スコアが最後");
    }

    /// 空の課題リストで同期すると全削除されることを確認
    #[tokio::test]
    async fn test_save_empty_issues_deletes_all() {
        let db = create_test_db().await;
        
        db.save_workspace("example.backlog.com", "key", "PROJ", None, None, true, None, None, None).await.unwrap();
        let workspaces = db.get_workspaces().await.unwrap();
        let workspace_id = workspaces[0].id;
        
        let issues = vec![create_test_issue(1, "PROJ-1", "Issue 1")];
        db.save_issues(workspace_id, &issues, &["PROJ"], &["PROJ"]).await.unwrap();
        
        // 空のリストで同期
        db.save_issues(workspace_id, &[], &["PROJ"], &["PROJ"]).await.unwrap();
        
        let saved_issues = db.get_issues().await.unwrap();
        assert_eq!(saved_issues.len(), 0);
    }
}
