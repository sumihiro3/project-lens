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

/// ワークスペース保存用の入力データ
///
/// `save_workspace` に渡す各カラムの値をまとめた構造体。
/// 引数の数を抑え、呼び出し側の可読性を高めるために用いる。
#[derive(Debug, Clone)]
pub struct WorkspaceInput {
    /// Backlogドメイン
    pub domain: String,
    /// APIキー
    pub api_key: String,
    /// 対象プロジェクトキー（カンマ区切り）
    pub project_keys: String,
    /// BacklogユーザーID
    pub user_id: Option<i64>,
    /// Backlogユーザー名
    pub user_name: Option<String>,
    /// 同期の有効・無効
    pub enabled: bool,
    /// APIレート上限
    pub api_limit: Option<i64>,
    /// API残回数
    pub api_remaining: Option<i64>,
    /// APIレートリセット時刻
    pub api_reset: Option<String>,
}

/// AI分析結果
///
/// 課題1件に対するオンデバイスAI（FoundationModels等）の分析結果。
/// `ai_results` テーブルの1行に対応する。
/// `delay_days` は LLM ではなく SQL で算出した値を保持する。
// 後続の実装項目（ワーカー・Tauriコマンド）で利用するため、現時点では未参照。
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AiResult {
    /// 課題ID（Backlog の issue id）
    pub issue_id: i64,
    /// ワークスペースID
    pub workspace_id: i64,
    /// 1行要約
    pub summary: Option<String>,
    /// リスクレベル（high / medium / low）
    pub risk_level: Option<String>,
    /// 遅延日数（SQL算出。期限超過で正、期限まで猶予があれば負）
    pub delay_days: Option<i64>,
    /// 対応提案
    pub suggestion: Option<String>,
    /// 処理日時（ISO8601文字列）
    pub processed_at: Option<String>,
    /// 推論に使用したモデル名
    pub model_used: Option<String>,
}

/// AIジョブ
///
/// `job_queue` テーブルの1行に対応する。バックグラウンドワーカーが
/// `status` を 'pending' → 'processing' → 'done'/'failed' と遷移させながら処理する。
// 後続の実装項目（ワーカー・Tauriコマンド）で利用するため、現時点では未参照。
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AiJob {
    /// ジョブID（自動採番）
    pub id: i64,
    /// ワークスペースID
    pub workspace_id: i64,
    /// 対象課題ID
    pub issue_id: i64,
    /// ジョブ種別（例: "summarize"）
    pub job_type: Option<String>,
    /// 処理状態（pending / processing / done / failed）
    pub status: Option<String>,
    /// 投入日時（ISO8601文字列）
    pub created_at: Option<String>,
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
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        "#,
        )
        .execute(&self.pool)
        .await?;

        // sync_state table
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS sync_state (
                project_id TEXT PRIMARY KEY,
                last_synced_at TEXT NOT NULL
            );
        "#,
        )
        .execute(&self.pool)
        .await?;

        // workspaces table
        sqlx::query(
            r#"
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
        "#,
        )
        .execute(&self.pool)
        .await?;

        // 既存のworkspacesテーブルに新しいカラムを追加（存在しない場合のみ）
        // SQLiteはALTER TABLE ADD COLUMN IF NOT EXISTSをサポートしていないため、
        // エラーを無視する方法で対応
        let _ = sqlx::query("ALTER TABLE workspaces ADD COLUMN enabled INTEGER DEFAULT 1")
            .execute(&self.pool)
            .await;
        let _ = sqlx::query("ALTER TABLE workspaces ADD COLUMN api_limit INTEGER")
            .execute(&self.pool)
            .await;
        let _ = sqlx::query("ALTER TABLE workspaces ADD COLUMN api_remaining INTEGER")
            .execute(&self.pool)
            .await;
        let _ = sqlx::query("ALTER TABLE workspaces ADD COLUMN api_reset TEXT")
            .execute(&self.pool)
            .await;

        // issues table
        sqlx::query(
            r#"
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
        "#,
        )
        .execute(&self.pool)
        .await?;

        // ai_results table（v0.3 オンデバイスAI基盤）
        //
        // 整合性に関する決定: 課題1件あたりのAI分析結果はこの専用テーブルに保存する。
        // 既存の issues.ai_summary カラムは ai_results 新設に伴い使用しない（不使用方針）。
        // get_issues 側では ai_results を LEFT JOIN してフロントへ渡す前提。
        // delay_days は SQL で確実に算出した値を保存する（LLM の出力には含めない）。
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS ai_results (
                issue_id INTEGER,
                workspace_id INTEGER,
                summary TEXT,
                risk_level TEXT,
                delay_days INTEGER,
                suggestion TEXT,
                processed_at TEXT,
                model_used TEXT,
                PRIMARY KEY (workspace_id, issue_id)
            );
        "#,
        )
        .execute(&self.pool)
        .await?;

        // job_queue table（v0.3 バックグラウンド処理キュー）
        //
        // sync で検出した新規・更新チケットを 'pending' で投入し、
        // バックグラウンドワーカーが同時1件で処理する。
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS job_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id INTEGER,
                issue_id INTEGER,
                job_type TEXT,
                status TEXT,
                created_at TEXT
            );
        "#,
        )
        .execute(&self.pool)
        .await?;

        // job_queue のインデックス。
        // done/failed 行は削除せず残るため行数が単調増加する。status フィルタ（ポーリング・件数集計）と
        // 重複チェック（enqueue_jobs）が全表スキャンにならないよう、用途別に2本張る。
        // - idx_job_queue_status: get_pending_jobs / count_*（status, created_at, id 順）
        // - idx_job_queue_lookup: enqueue_jobs の重複判定（workspace_id, issue_id, job_type, status）
        //   ※ pending→done は同一行を UPDATE するため UNIQUE にはできない（done 重複で衝突する）。
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_job_queue_status ON job_queue(status, created_at, id)",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_job_queue_lookup \
             ON job_queue(workspace_id, issue_id, job_type, status)",
        )
        .execute(&self.pool)
        .await?;

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
             FROM workspaces ORDER BY id",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(workspaces)
    }

    /// ワークスペースを保存（新規作成または更新）
    ///
    /// ドメインをユニークキーとして扱い、同一ドメインが存在すれば更新、
    /// なければ新規作成する。
    ///
    /// # 引数
    /// * `input` - 保存するワークスペースの各カラム値をまとめた入力データ
    ///
    /// # 戻り値
    /// 成功時は`Ok(())`、失敗時はエラー
    pub async fn save_workspace(&self, input: WorkspaceInput) -> Result<()> {
        // ドメインが同じものがあれば更新、なければ新規作成
        // ここではドメインをユニークキーのように扱う
        let existing: Option<(i64,)> = sqlx::query_as("SELECT id FROM workspaces WHERE domain = ?")
            .bind(&input.domain)
            .fetch_optional(&self.pool)
            .await?;

        if let Some((id,)) = existing {
            sqlx::query("UPDATE workspaces SET api_key = ?, project_keys = ?, user_id = ?, user_name = ?, enabled = ?, api_limit = ?, api_remaining = ?, api_reset = ? WHERE id = ?")
                .bind(&input.api_key)
                .bind(&input.project_keys)
                .bind(input.user_id)
                .bind(&input.user_name)
                .bind(input.enabled as i64)
                .bind(input.api_limit)
                .bind(input.api_remaining)
                .bind(&input.api_reset)
                .bind(id)
                .execute(&self.pool)
                .await?;
        } else {
            sqlx::query("INSERT INTO workspaces (domain, api_key, project_keys, user_id, user_name, enabled, api_limit, api_remaining, api_reset) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(&input.domain)
                .bind(&input.api_key)
                .bind(&input.project_keys)
                .bind(input.user_id)
                .bind(&input.user_name)
                .bind(input.enabled as i64)
                .bind(input.api_limit)
                .bind(input.api_remaining)
                .bind(&input.api_reset)
                .execute(&self.pool)
                .await?;
        }
        Ok(())
    }

    /// ワークスペースを削除
    ///
    /// ワークスペース本体に加え、そのワークスペースに紐づく AI 関連データ
    /// （`ai_results` / `job_queue`）も削除する。外部キーの CASCADE は `PRAGMA foreign_keys`
    /// が未設定で機能しないため、明示的に掃除して孤児データの残留を防ぐ。
    pub async fn delete_workspace(&self, id: i64) -> Result<()> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query("DELETE FROM ai_results WHERE workspace_id = ?")
            .bind(id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM job_queue WHERE workspace_id = ?")
            .bind(id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM workspaces WHERE id = ?")
            .bind(id)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
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
            "UPDATE workspaces SET api_limit = ?, api_remaining = ?, api_reset = ? WHERE id = ?",
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
                "DELETE FROM issues WHERE workspace_id = ? AND issue_key LIKE ? || '-%' AND id NOT IN ({id_list})"
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
            // プロジェクトキーごとに同一の除外条件（バインド用プレースホルダ）を並べる
            let conditions = vec!["issue_key NOT LIKE ? || '-%'"; all_project_keys.len()];
            let sql = format!(
                "DELETE FROM issues WHERE workspace_id = ? AND ({})",
                conditions.join(" AND ")
            );

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

        // 4. 上記の課題削除で孤児になった AI 関連データを掃除する。
        // 削除経路（完了課題・プロジェクト選択解除）が複数あるため、削除条件を都度たどるのではなく
        // 「issues に対応行が無い ai_results / job_queue」をまとめて削除する。
        sqlx::query(
            "DELETE FROM ai_results WHERE workspace_id = ? \
             AND issue_id NOT IN (SELECT id FROM issues WHERE workspace_id = ?)",
        )
        .bind(workspace_id)
        .bind(workspace_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "DELETE FROM job_queue WHERE workspace_id = ? \
             AND issue_id NOT IN (SELECT id FROM issues WHERE workspace_id = ?)",
        )
        .bind(workspace_id)
        .bind(workspace_id)
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;
        Ok(())
    }

    /// 指定されたワークスペースの課題をすべて削除
    ///
    /// 課題に加え、そのワークスペースの AI 関連データ（`ai_results` / `job_queue`）も削除し、
    /// 孤児データの残留を防ぐ（無効化ワークスペースの同期時などに呼ばれる）。
    pub async fn delete_workspace_issues(&self, workspace_id: i64) -> Result<()> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query("DELETE FROM issues WHERE workspace_id = ?")
            .bind(workspace_id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM ai_results WHERE workspace_id = ?")
            .bind(workspace_id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM job_queue WHERE workspace_id = ?")
            .bind(workspace_id)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(())
    }

    /// 課題一覧を取得（AI分析結果を結合）
    ///
    /// データベースに保存されている全ての課題を、`ai_results` を LEFT JOIN して取得する。
    /// 関連度スコアの降順で取得し、スコアが高い（重要度が高い）課題が先頭に来る。
    ///
    /// 課題本体は `issues.raw_data`（JSON）から復元し、AI 分析結果（要約・リスクレベル・遅延日数・
    /// 対応提案・処理日時）は JOIN 列から [`Issue`] の `ai_*` フィールドへ設定する（v0.3）。
    /// AI 未生成の課題は JOIN 列が NULL になり、`ai_*` は `None` のままになる（既存機能を阻害しない）。
    /// 遅延日数は LLM ではなく SQL 算出値（`ai_results.delay_days`）を渡す。
    ///
    /// # 戻り値
    /// 課題のベクタ（スコア降順。AI 結果を含む）、またはエラー
    pub async fn get_issues(&self) -> Result<Vec<Issue>> {
        // raw_data・スコア・ワークスペースIDに加え、ai_results を LEFT JOIN して AI 結果列を取得。
        // PK は (workspace_id, issue_id) なので両キーで結合する。スコア降順でソート。
        type Row = (
            String,         // raw_data
            i32,            // relevance_score
            i64,            // workspace_id
            Option<String>, // ai.summary
            Option<String>, // ai.risk_level
            Option<i64>,    // ai.delay_days
            Option<String>, // ai.suggestion
            Option<String>, // ai.processed_at
        );
        let rows: Vec<Row> = sqlx::query_as(
            "SELECT i.raw_data, i.relevance_score, i.workspace_id, \
                    ai.summary, ai.risk_level, ai.delay_days, ai.suggestion, ai.processed_at \
             FROM issues i \
             LEFT JOIN ai_results ai \
               ON ai.workspace_id = i.workspace_id AND ai.issue_id = i.id \
             ORDER BY i.relevance_score DESC",
        )
        .fetch_all(&self.pool)
        .await?;

        // JSONをデシリアライズし、スコア・ワークスペースID・AI結果を設定
        let issues = rows
            .into_iter()
            .filter_map(
                |(
                    json,
                    score,
                    workspace_id,
                    ai_summary,
                    ai_risk_level,
                    ai_delay_days,
                    ai_suggestion,
                    ai_processed_at,
                )| {
                    let mut issue: Issue = serde_json::from_str(&json).ok()?;
                    issue.relevance_score = score;
                    issue.workspace_id = workspace_id;
                    issue.ai_summary = ai_summary;
                    issue.ai_risk_level = ai_risk_level;
                    issue.ai_delay_days = ai_delay_days;
                    issue.ai_suggestion = ai_suggestion;
                    issue.ai_processed_at = ai_processed_at;
                    Some(issue)
                },
            )
            .collect();

        Ok(issues)
    }

    /// 課題の `(workspace_id, id) -> updated_at` マップを軽量に取得する
    ///
    /// AI ジョブ投入の差分検出（同期前スナップショットとの突き合わせ）専用。
    /// [`get_issues`] と異なり raw_data の JSON デシリアライズや `ai_results` の JOIN を行わず、
    /// 必要な3カラムだけを引くため、課題が多くても同期の応答を遅くしない。
    ///
    /// # 戻り値
    /// `(workspace_id, issue_id)` をキー、`updated_at`（未設定は `None`）を値とするマップ。
    pub async fn get_issue_updated_map(
        &self,
    ) -> Result<std::collections::HashMap<(i64, i64), Option<String>>> {
        let rows: Vec<(i64, i64, Option<String>)> =
            sqlx::query_as("SELECT workspace_id, id, updated_at FROM issues")
                .fetch_all(&self.pool)
                .await?;
        Ok(rows
            .into_iter()
            .map(|(workspace_id, id, updated)| ((workspace_id, id), updated))
            .collect())
    }

    /// AIジョブをキューに投入（差分検出した課題を 'pending' で登録）
    ///
    /// sync 直後などに、新規・更新された課題を分析対象としてキューに積む。
    /// 同一課題（同一 workspace_id / issue_id / job_type）の 'pending' ジョブが
    /// 既に存在する場合は重複投入を避けてスキップする。
    /// （'processing' / 'done' / 'failed' は対象外。新たな更新分は再投入できる）
    ///
    /// # 引数
    /// * `workspace_id` - ワークスペースID
    /// * `issue_ids` - キューに投入する課題IDのスライス
    /// * `job_type` - ジョブ種別（例: "summarize"）
    ///
    /// # 戻り値
    /// 実際に新規投入したジョブ件数、またはエラー
    // 後続の実装項目（sync連携・ワーカー）で呼び出されるため、現時点では未参照。
    #[allow(dead_code)]
    pub async fn enqueue_jobs(
        &self,
        workspace_id: i64,
        issue_ids: &[i64],
        job_type: &str,
    ) -> Result<u64> {
        if issue_ids.is_empty() {
            return Ok(0);
        }

        let now = chrono::Utc::now().to_rfc3339();
        let mut transaction = self.pool.begin().await?;
        let mut inserted: u64 = 0;

        for &issue_id in issue_ids {
            // 重複チェックと投入を1文に統合する（SELECT→INSERT の2往復を1往復に）。
            // 同一課題の 'pending' ジョブが既にある場合は WHERE NOT EXISTS で投入しない。
            // 重複判定は idx_job_queue_lookup で索引化される（全表スキャン回避）。
            let result = sqlx::query(
                "INSERT INTO job_queue (workspace_id, issue_id, job_type, status, created_at) \
                 SELECT ?, ?, ?, 'pending', ? \
                 WHERE NOT EXISTS ( \
                   SELECT 1 FROM job_queue \
                   WHERE workspace_id = ? AND issue_id = ? AND job_type = ? AND status = 'pending')",
            )
            .bind(workspace_id)
            .bind(issue_id)
            .bind(job_type)
            .bind(&now)
            .bind(workspace_id)
            .bind(issue_id)
            .bind(job_type)
            .execute(&mut *transaction)
            .await?;
            inserted += result.rows_affected();
        }

        transaction.commit().await?;
        Ok(inserted)
    }

    /// 未処理（'pending'）のAIジョブを取得
    ///
    /// バックグラウンドワーカーが処理対象を取り出すために使う。
    /// 投入順（created_at, id 昇順）で古いものから返す。
    ///
    /// # 引数
    /// * `limit` - 取得する最大件数
    ///
    /// # 戻り値
    /// 未処理ジョブのベクタ（古い順）、またはエラー
    #[allow(dead_code)]
    pub async fn get_pending_jobs(&self, limit: i64) -> Result<Vec<AiJob>> {
        let jobs = sqlx::query_as::<_, AiJob>(
            "SELECT id, workspace_id, issue_id, job_type, status, created_at \
             FROM job_queue WHERE status = 'pending' ORDER BY created_at ASC, id ASC LIMIT ?",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(jobs)
    }

    /// AIジョブの状態を更新
    ///
    /// ワーカーがジョブ処理の進行に合わせて状態を遷移させる
    /// （pending → processing → done / failed など）。
    ///
    /// # 引数
    /// * `job_id` - 対象ジョブのID
    /// * `status` - 新しい状態（例: "processing" / "done" / "failed"）
    ///
    /// # 戻り値
    /// 成功時は`Ok(())`、失敗時はエラー
    #[allow(dead_code)]
    pub async fn update_job_status(&self, job_id: i64, status: &str) -> Result<()> {
        sqlx::query("UPDATE job_queue SET status = ? WHERE id = ?")
            .bind(status)
            .bind(job_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// AI分析結果を保存（課題単位の UPSERT）
    ///
    /// 同一の (workspace_id, issue_id) が既に存在する場合は上書きする。
    /// 再分析時はこのメソッドで結果が更新される。
    ///
    /// # 引数
    /// * `result` - 保存するAI分析結果
    ///
    /// # 戻り値
    /// 成功時は`Ok(())`、失敗時はエラー
    #[allow(dead_code)]
    pub async fn save_ai_result(&self, result: &AiResult) -> Result<()> {
        sqlx::query(
            "INSERT OR REPLACE INTO ai_results \
             (issue_id, workspace_id, summary, risk_level, delay_days, suggestion, processed_at, model_used) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(result.issue_id)
        .bind(result.workspace_id)
        .bind(&result.summary)
        .bind(&result.risk_level)
        .bind(result.delay_days)
        .bind(&result.suggestion)
        .bind(&result.processed_at)
        .bind(&result.model_used)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// 指定課題のAI分析結果を取得
    ///
    /// # 引数
    /// * `workspace_id` - ワークスペースID
    /// * `issue_id` - 課題ID
    ///
    /// # 戻り値
    /// AI分析結果（未生成の場合は`None`）、またはエラー
    #[allow(dead_code)]
    pub async fn get_ai_result(
        &self,
        workspace_id: i64,
        issue_id: i64,
    ) -> Result<Option<AiResult>> {
        let result = sqlx::query_as::<_, AiResult>(
            "SELECT issue_id, workspace_id, summary, risk_level, delay_days, suggestion, processed_at, model_used \
             FROM ai_results WHERE workspace_id = ? AND issue_id = ?",
        )
        .bind(workspace_id)
        .bind(issue_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(result)
    }

    /// 未処理（'pending'）のAIジョブ件数を取得
    ///
    /// 設定画面でキュー残件数を表示するために使う。
    ///
    /// # 戻り値
    /// 'pending' 状態のジョブ件数、またはエラー
    pub async fn count_pending_jobs(&self) -> Result<i64> {
        let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM job_queue WHERE status = 'pending'")
            .fetch_one(&self.pool)
            .await?;
        Ok(row.0)
    }

    /// 処理中（'processing'）のAIジョブ件数を取得
    ///
    /// 設定画面でキュー処理状況（処理中件数）を表示するために使う（FR-V03-003）。
    /// ワーカーは同時1件のため通常は 0 か 1 だが、件数として返す。
    ///
    /// # 戻り値
    /// 'processing' 状態のジョブ件数、またはエラー
    pub async fn count_processing_jobs(&self) -> Result<i64> {
        let row: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM job_queue WHERE status = 'processing'")
                .fetch_one(&self.pool)
                .await?;
        Ok(row.0)
    }

    /// 起動時に取り残された 'processing' ジョブを 'pending' へ戻す（クラッシュ復旧）
    ///
    /// ワーカーはジョブを 'processing' に遷移させてから推論する。'processing' 中にアプリが
    /// 終了・クラッシュすると、そのジョブは 'processing' のまま残り、`get_pending_jobs` に
    /// 拾われず二度と処理されない（処理中件数も張り付く）。起動時にこれを 'pending' へ戻し、
    /// 次回ポーリングで再処理できるようにする。
    ///
    /// # 戻り値
    /// 'pending' へ戻したジョブ件数、またはエラー。
    pub async fn reset_stale_jobs(&self) -> Result<u64> {
        let result =
            sqlx::query("UPDATE job_queue SET status = 'pending' WHERE status = 'processing'")
                .execute(&self.pool)
                .await?;
        Ok(result.rows_affected())
    }

    /// AI分析の入力となる課題フィールドを SQL 側で前処理して取得（FR-V03-005）
    ///
    /// バックグラウンドワーカーが [`crate::ai::AiAnalysisInput`] を組み立てるために用いる。
    /// コンテキスト上限を考慮し、本文（description）は `substr` で `body_max_chars` 文字に
    /// 切り詰めてから返す（前処理を SQL 側で行う方針）。タイトル・ステータス・期限も併せて返す。
    ///
    /// # 引数
    /// * `workspace_id` - ワークスペースID
    /// * `issue_id` - 課題ID
    /// * `body_max_chars` - 本文の切り詰め最大文字数（[`crate::ai::CONTEXT_BODY_MAX_CHARS`]）
    ///
    /// # 戻り値
    /// `(issue_key, summary, description_head, status, due_date)` のタプル。
    /// 対象課題が存在しない場合は`None`、失敗時はエラー。
    /// `description_head` は本文が無ければ空文字、`status` は未設定なら空文字になる。
    #[allow(dead_code)]
    pub async fn get_issue_analysis_fields(
        &self,
        workspace_id: i64,
        issue_id: i64,
        body_max_chars: i64,
    ) -> Result<Option<(String, String, String, String, Option<String>)>> {
        // 本文は SQL の substr で先頭 body_max_chars 文字に切り詰める（コンテキスト上限対策）。
        // status / description は NULL になりうるため COALESCE で空文字へ正規化する。
        let row: Option<(String, String, String, String, Option<String>)> = sqlx::query_as(
            "SELECT issue_key, summary, \
                    substr(COALESCE(description, ''), 1, ?) AS description_head, \
                    COALESCE(status, '') AS status, \
                    due_date \
             FROM issues WHERE workspace_id = ? AND id = ?",
        )
        .bind(body_max_chars)
        .bind(workspace_id)
        .bind(issue_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    /// 課題の遅延日数を SQL で算出
    ///
    /// 期限日（due_date）と現在時刻の差を julianday で計算し、整数の日数で返す。
    /// 正の値は期限超過（遅延）、0 は当日、負の値は期限までの猶予を表す。
    /// 遅延日数・期限切れ判定は LLM ではなく SQL で確実に算出する方針のためのヘルパー。
    ///
    /// due_date は Backlog の保存形式に複数フォーマット（"YYYY-MM-DD" や
    /// "YYYY-MM-DDTHH:MM:SSZ"）が混在しうるため、`scoring.rs` の NaiveDate パースと
    /// 同様に先頭10文字（日付部分）を取り出して julianday に渡す。
    /// 期限が未設定・パース不能な場合は`None`を返す。
    ///
    /// # 引数
    /// * `workspace_id` - ワークスペースID
    /// * `issue_id` - 課題ID
    ///
    /// # 戻り値
    /// 遅延日数（期限なし・算出不能なら`None`）、またはエラー
    #[allow(dead_code)]
    pub async fn get_issue_delay_days(
        &self,
        workspace_id: i64,
        issue_id: i64,
    ) -> Result<Option<i64>> {
        // due_date の先頭10文字（YYYY-MM-DD）を日付として julianday に渡す。
        // どちらのフォーマットでも先頭10文字は ISO の日付部分になる。
        // julianday('now') も日付境界で比較するため 'start of day' に丸める。
        let row: Option<(Option<f64>,)> = sqlx::query_as(
            "SELECT CASE \
               WHEN due_date IS NULL OR due_date = '' THEN NULL \
               ELSE julianday(substr(due_date, 1, 10)) - julianday('now', 'start of day') \
             END \
             FROM issues WHERE workspace_id = ? AND id = ?",
        )
        .bind(workspace_id)
        .bind(issue_id)
        .fetch_optional(&self.pool)
        .await?;

        // julianday の結果: (期限 - 今日)。負なら期限超過なので符号を反転して
        // 「遅延日数（正=遅延）」に変換する。SQLite が日付をパースできない場合 NULL。
        Ok(row
            .and_then(|(diff,)| diff)
            .map(|diff| -(diff.round() as i64)))
    }
}
