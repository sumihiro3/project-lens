use crate::backlog::Issue;
use anyhow::Result;
use sqlx::{Pool, Sqlite, SqlitePool};
use tauri_plugin_sql::{Migration, MigrationKind};

/// データベースマイグレーション定義を取得
///
/// アプリケーション起動時に実行されるSQLiteのマイグレーションを定義する。
/// テーブル構造の初期化を行う。
///
/// # 戻り値
/// マイグレーション定義のベクタ
pub fn get_migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create_initial_tables",
        kind: MigrationKind::Up,
        sql: r#"
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sync_state (
                project_id TEXT PRIMARY KEY,
                last_synced_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS issues (
                id INTEGER PRIMARY KEY,
                issue_key TEXT UNIQUE NOT NULL,
                summary TEXT NOT NULL,
                description TEXT,
                priority TEXT,
                status TEXT,
                assignee TEXT,
                due_date TEXT,
                updated_at TEXT,
                relevance_score INTEGER DEFAULT 0,
                ai_summary TEXT,
                raw_data TEXT
            );
        "#,
    }]
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

        // マイグレーションを実行（テーブルが存在しない場合に作成）
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sync_state (
                project_id TEXT PRIMARY KEY,
                last_synced_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS issues (
                id INTEGER PRIMARY KEY,
                issue_key TEXT UNIQUE NOT NULL,
                summary TEXT NOT NULL,
                description TEXT,
                priority TEXT,
                status TEXT,
                assignee TEXT,
                due_date TEXT,
                updated_at TEXT,
                relevance_score INTEGER DEFAULT 0,
                ai_summary TEXT,
                raw_data TEXT
            );
            "#,
        )
        .execute(&pool)
        .await?;

        Ok(Self { pool })
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
                (id, issue_key, summary, description, priority, status, assignee, due_date, updated_at, raw_data, relevance_score)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                "#
            )
            .bind(issue.id)
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
        // 空の場合は "0" を入れて構文エラーを防ぐ（ID 0は通常存在しない）
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
            // issue_keyは "PROJECT-123" の形式なので、前方一致でプロジェクトを判定
            let sql = format!(
                "DELETE FROM issues WHERE issue_key LIKE ? || '-%' AND id NOT IN ({})",
                id_list
            );

            sqlx::query(&sql)
                .bind(project_key)
                .execute(&mut *transaction)
                .await?;
        }

        // 3. 設定に含まれていないプロジェクトの課題を削除
        if !all_project_keys.is_empty() {
            // 設定されているプロジェクト以外の課題を削除
            // issue_key NOT LIKE 'PRJ1-%' AND issue_key NOT LIKE 'PRJ2-%' ...
            let mut conditions = Vec::new();
            for _ in all_project_keys {
                conditions.push("issue_key NOT LIKE ? || '-%'");
            }
            let sql = format!("DELETE FROM issues WHERE {}", conditions.join(" AND "));

            let mut query = sqlx::query(&sql);
            for key in all_project_keys {
                query = query.bind(key);
            }
            query.execute(&mut *transaction).await?;
        } else {
            // プロジェクトが一つも設定されていない場合は全削除
            sqlx::query("DELETE FROM issues")
                .execute(&mut *transaction)
                .await?;
        }

        transaction.commit().await?;
        Ok(())
    }

    /// 課題一覧を取得
    ///
    /// データベースに保存されている課題を関連度スコアの降順で取得する。
    /// スコアが高い（重要度が高い）課題が先頭に来る。
    ///
    /// # 戻り値
    /// 課題のベクタ（スコア降順）、またはエラー
    pub async fn get_issues(&self) -> Result<Vec<Issue>> {
        // raw_dataとスコアを取得し、スコア降順でソート
        let rows: Vec<(String, i32)> = sqlx::query_as(
            "SELECT raw_data, relevance_score FROM issues ORDER BY relevance_score DESC",
        )
        .fetch_all(&self.pool)
        .await?;

        // JSONをデシリアライズしてスコアを設定
        let issues = rows
            .into_iter()
            .filter_map(|(json, score)| {
                let mut issue: Issue = serde_json::from_str(&json).ok()?;
                issue.relevance_score = score;
                Some(issue)
            })
            .collect();

        Ok(issues)
    }
}
