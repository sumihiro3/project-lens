use crate::backlog::{Issue, User};
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

/// 課題コメント（v0.4）
///
/// Backlog API `GET /issues/:id/comments` で取得したコメント1件を表す。
/// `issue_comments` テーブルの1行に対応し、埋め込み入力テキストの組み立てや
/// 差分取得（`minId`）の起点管理に用いる。
///
/// この構造体は「API レスポンスのデシリアライズ」と「DB 行（`sqlx::FromRow`）」の
/// 両用途で共有する（DRY）。Backlog API は投稿日時を `created`・投稿者を `createdUser`
/// で返すため、`serde(alias)` で `created_at` / `created_user` に取り込む。
/// `sqlx::FromRow` で `issue_comments` から読むときはカラム名（`created_at`）で一致する。
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Comment {
    /// コメントID（Backlog のコメント id。差分取得の `minId` 起点になる）
    #[serde(rename = "id")]
    pub comment_id: i64,
    /// コメント本文
    pub content: Option<String>,
    /// 投稿日時（ISO8601文字列）。API レスポンスでは `created`、DB では `created_at`。
    #[serde(alias = "created")]
    pub created_at: Option<String>,
    /// 投稿者（任意）。Backlog API の `createdUser`。DB には保存せず、取得時のみ参照する。
    #[serde(
        rename = "createdUser",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    #[sqlx(default)]
    pub created_user: Option<User>,
}

/// 埋め込みで使用する既定モデルの論理識別子（v0.4 = OS 組み込み NLContextualEmbedding / 512 次元）。
///
/// 実運用で `issue_embeddings.model` に保存する値は、ベクトルを生成した
/// [`crate::ai::embedding::EmbeddingBackend::model_name`]（embed_worker が渡す）を単一の真実源とする。
/// 本定数はテスト・参照用の既定値であり、両者の値を一致させておく（モデル更新時の再埋め込み判定。FR-V04-004）。
#[allow(dead_code)]
pub const EMBEDDING_MODEL: &str = "apple-nl-contextual-ja";

/// 埋め込みベクトルの次元数（v0.4 既定 = NLContextualEmbedding は 512）。
#[allow(dead_code)]
pub const EMBEDDING_DIM: usize = 512;

/// f32 スライスをリトルエンディアンのバイト列（BLOB）へ変換する
///
/// `issue_embeddings.vector` へ保存するためのエンコーダ。各要素を
/// 4バイトのリトルエンディアン表現に並べる（プラットフォーム非依存にするため
/// `to_le_bytes` を明示使用）。`bytemuck` 等の依存を増やさず手実装する。
///
/// # 引数
/// * `vector` - 埋め込みベクトル（v0.4 既定 NLContextualEmbedding は 512 要素）
///
/// # 戻り値
/// `vector.len() * 4` バイトの BLOB
#[allow(dead_code)]
pub fn vector_to_blob(vector: &[f32]) -> Vec<u8> {
    let mut blob = Vec::with_capacity(vector.len() * 4);
    for &v in vector {
        blob.extend_from_slice(&v.to_le_bytes());
    }
    blob
}

/// リトルエンディアンのバイト列（BLOB）を f32 ベクトルへ復元する
///
/// [`vector_to_blob`] の逆変換。4バイト境界に満たない端数はデータ破損とみなして
/// 無視する（末尾の余りバイトは切り捨てる）。
///
/// # 引数
/// * `blob` - `issue_embeddings.vector` から取得した BLOB
///
/// # 戻り値
/// 復元した f32 ベクトル
#[allow(dead_code)]
pub fn blob_to_vector(blob: &[u8]) -> Vec<f32> {
    blob.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

/// 類似検索の結果表示に用いる課題メタ情報（v0.4 / FR-V04-005）
///
/// `search_similar_issues` が選んだ課題1件分の、UI 表示に必要な最小限のメタ情報。
/// `issues` テーブルの個別カラム（`save_issues` で展開済み）から取得し、
/// raw_data の JSON デシリアライズを避ける（NFR-V04-002 の応答性）。
#[derive(Debug, Clone)]
pub struct IssueSearchMeta {
    /// 課題キー（例: "PROJ-123"）。
    pub issue_key: String,
    /// 課題タイトル。
    pub summary: String,
    /// ステータス名（未設定なら `None`）。
    pub status: Option<String>,
    /// 担当者名（未設定なら `None`）。
    pub assignee: Option<String>,
    /// コーパス専用課題（完了課題）なら `true`（FR-V04-003）。
    pub is_corpus_only: bool,
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

        // ── v0.4 DBスキーマ拡張 ───────────────────────────────────────────────

        // issue_comments table（v0.4 コメント本文保存）
        //
        // Backlog API で取得したコメント本文を保存する。
        // 差分取得の起点（最終取得 ID）は issue_comment_state で管理し、
        // このテーブルはコメント内容の保管のみを担当する。
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS issue_comments (
                workspace_id INTEGER NOT NULL,
                issue_id     INTEGER NOT NULL,
                comment_id   INTEGER NOT NULL,
                content      TEXT,
                created_at   TEXT,
                PRIMARY KEY (workspace_id, issue_id, comment_id)
            );
        "#,
        )
        .execute(&self.pool)
        .await?;

        // issue_comment_state table（v0.4 コメント差分取得状態）
        //
        // 課題ごとの最終取得コメント ID と取得状態を管理する。
        // バックオフ・リトライ用の retry_count も保持する。
        // status の値: 'idle' / 'fetching' / 'done' / 'failed'
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS issue_comment_state (
                workspace_id    INTEGER NOT NULL,
                issue_id        INTEGER NOT NULL,
                last_comment_id INTEGER,
                status          TEXT    NOT NULL DEFAULT 'idle',
                retry_count     INTEGER NOT NULL DEFAULT 0,
                updated_at      TEXT,
                PRIMARY KEY (workspace_id, issue_id)
            );
        "#,
        )
        .execute(&self.pool)
        .await?;

        // issue_embeddings table（v0.4 ベクトル保存）
        //
        // 埋め込みベクトル（v0.4 既定 NLContextualEmbedding は 512次元）を BLOB として保存する。
        // source_hash はタイトル+本文+コメントの変更検知用ハッシュ（変更時に再埋め込みをトリガー）。
        // 埋め込み戦略: タイトル+本文+コメントダイジェストを連結した単一ベクトル（未解決事項#1の既定値）。
        // 再埋め込みポリシー: source_hash が変化した場合に再生成（未解決事項#5の既定値）。
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS issue_embeddings (
                workspace_id INTEGER NOT NULL,
                issue_id     INTEGER NOT NULL,
                model        TEXT    NOT NULL,
                dim          INTEGER NOT NULL,
                vector       BLOB    NOT NULL,
                source_hash  TEXT,
                updated_at   TEXT,
                PRIMARY KEY (workspace_id, issue_id)
            );
        "#,
        )
        .execute(&self.pool)
        .await?;

        // issues テーブルへ is_corpus_only カラムを追加（v0.4 完了課題コーパス分離用）
        //
        // 完了課題コーパス（FR-V04-003）は通常の課題一覧・ダッシュボード・スコア表示に含めない。
        // is_corpus_only = 1 の行はコーパスとしての類似検索にのみ使用し、get_issues では除外する。
        // SQLite は ALTER TABLE ADD COLUMN IF NOT EXISTS をサポートしないため、
        // エラーを無視する方式（既存パターン踏襲）で冪等に追加する。
        let _ = sqlx::query("ALTER TABLE issues ADD COLUMN is_corpus_only INTEGER DEFAULT 0")
            .execute(&self.pool)
            .await;

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
        // v0.4 新テーブルの掃除
        sqlx::query("DELETE FROM issue_comments WHERE workspace_id = ?")
            .bind(id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM issue_comment_state WHERE workspace_id = ?")
            .bind(id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM issue_embeddings WHERE workspace_id = ?")
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
    /// # コーパスバッチの扱い（v0.4 / FR-V04-003）
    /// `issues` がすべて `is_corpus_only = true` の「完了課題コーパスバッチ」のときは、
    /// 上記のプロジェクト単位の破壊的クリーンアップ（1・2）を**行わない**。理由は2つある：
    /// - 通常 sync（`statusId=[1,2,3]`）とコーパス sync（`statusId=4`）は別バッチで呼ばれるため、
    ///   コーパスバッチの新規IDリストに通常課題は含まれない。クリーンアップを走らせると
    ///   通常の一覧表示課題まで消えてしまう。
    /// - コーパス課題の保持・除去は期間設定に基づく [`Self::cleanup_corpus_out_of_range`] が
    ///   一元的に担う（破壊的削除をコーパス sync の都度に持たせない）。
    ///
    /// 逆に通常バッチのクリーンアップ（1・2）は `is_corpus_only = 1` 行を削除対象から除外し、
    /// 取り込んだ完了課題コーパスを通常 sync で消さないようにする。
    ///
    /// バッチ種別は `issues` 全件の `is_corpus_only` から判定する（空バッチは通常バッチ扱い）。
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

        // コーパスバッチ（完了課題のみ）はプロジェクト単位の破壊的クリーンアップを行わない。
        // 空バッチは通常バッチ扱い（all() は空で true を返すため明示的に除外する）。
        let is_corpus_batch = !issues.is_empty() && issues.iter().all(|i| i.is_corpus_only);

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
                (id, workspace_id, issue_key, summary, description, priority, status, assignee, due_date, updated_at, raw_data, relevance_score, is_corpus_only)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            // 完了課題コーパス（FR-V04-003）取り込み時は is_corpus_only=true で保存し、
            // 通常の一覧・ダッシュボードから除外できるようにする。
            .bind(issue.is_corpus_only as i64)
            .execute(&mut *transaction)
            .await?;
        }

        // コーパスバッチのときはプロジェクト単位の破壊的クリーンアップ（2・3）を丸ごとスキップする。
        // コーパス課題の保持・除去は cleanup_corpus_out_of_range が担うため、ここでは upsert のみ行う。
        if !is_corpus_batch {
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
                // そのプロジェクトに属するが、新しいリストに含まれていない課題を削除。
                // is_corpus_only = 1 の完了課題コーパスは通常 sync では消さない（FR-V04-003）。
                let sql = format!(
                    "DELETE FROM issues WHERE workspace_id = ? AND issue_key LIKE ? || '-%' \
                     AND id NOT IN ({id_list}) AND COALESCE(is_corpus_only, 0) = 0"
                );

                sqlx::query(&sql)
                    .bind(workspace_id)
                    .bind(project_key)
                    .execute(&mut *transaction)
                    .await?;
            }

            // 3. 設定に含まれていないプロジェクトの課題を削除
            if !all_project_keys.is_empty() {
                // 設定されているプロジェクト以外の課題を削除。
                // ここでもコーパス課題（is_corpus_only = 1）は削除対象から除外する。
                // プロジェクトキーごとに同一の除外条件（バインド用プレースホルダ）を並べる
                let conditions = vec!["issue_key NOT LIKE ? || '-%'"; all_project_keys.len()];
                let sql = format!(
                    "DELETE FROM issues WHERE workspace_id = ? AND ({}) \
                     AND COALESCE(is_corpus_only, 0) = 0",
                    conditions.join(" AND ")
                );

                let mut query = sqlx::query(&sql).bind(workspace_id);
                for key in all_project_keys {
                    query = query.bind(key);
                }
                query.execute(&mut *transaction).await?;
            } else {
                // プロジェクトが一つも設定されていない場合は、このワークスペースの（通常）課題を全削除。
                // コーパス課題は cleanup_corpus_out_of_range / delete_workspace_issues に委ねる。
                sqlx::query(
                    "DELETE FROM issues WHERE workspace_id = ? AND COALESCE(is_corpus_only, 0) = 0",
                )
                .bind(workspace_id)
                .execute(&mut *transaction)
                .await?;
            }
        }

        // 4. 上記の課題削除で孤児になった AI 関連データを掃除する。
        // 削除経路（完了課題・プロジェクト選択解除）が複数あるため、削除条件を都度たどるのではなく
        // 「issues に対応行が無い ai_results / job_queue」をまとめて削除する。
        // v0.4 新テーブル（issue_comments / issue_comment_state / issue_embeddings）も同様に掃除する。
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
        // v0.4 新テーブルの孤児掃除
        sqlx::query(
            "DELETE FROM issue_comments WHERE workspace_id = ? \
             AND issue_id NOT IN (SELECT id FROM issues WHERE workspace_id = ?)",
        )
        .bind(workspace_id)
        .bind(workspace_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "DELETE FROM issue_comment_state WHERE workspace_id = ? \
             AND issue_id NOT IN (SELECT id FROM issues WHERE workspace_id = ?)",
        )
        .bind(workspace_id)
        .bind(workspace_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "DELETE FROM issue_embeddings WHERE workspace_id = ? \
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
        // v0.4 新テーブルの掃除
        sqlx::query("DELETE FROM issue_comments WHERE workspace_id = ?")
            .bind(workspace_id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM issue_comment_state WHERE workspace_id = ?")
            .bind(workspace_id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM issue_embeddings WHERE workspace_id = ?")
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
        // さらに issue_embeddings を LEFT JOIN して埋め込み構築済みフラグ（FR-V04-005）も取得する。
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
            i64,            // embedding_ready（issue_embeddings 行の有無を 0/1 で）
        );
        // is_corpus_only = 1 のコーパス専用行はダッシュボード・一覧・スコア表示に含めない（FR-V04-003）。
        // COALESCE でカラム未存在時（旧DB）も 0 として扱い安全に除外する。
        // embedding_ready: emb.issue_id が NULL でない（埋め込みが存在する）なら 1（FR-V04-005）。
        let rows: Vec<Row> = sqlx::query_as(
            "SELECT i.raw_data, i.relevance_score, i.workspace_id, \
                    ai.summary, ai.risk_level, ai.delay_days, ai.suggestion, ai.processed_at, \
                    CASE WHEN emb.issue_id IS NOT NULL THEN 1 ELSE 0 END AS embedding_ready \
             FROM issues i \
             LEFT JOIN ai_results ai \
               ON ai.workspace_id = i.workspace_id AND ai.issue_id = i.id \
             LEFT JOIN issue_embeddings emb \
               ON emb.workspace_id = i.workspace_id AND emb.issue_id = i.id \
             WHERE COALESCE(i.is_corpus_only, 0) = 0 \
             ORDER BY i.relevance_score DESC",
        )
        .fetch_all(&self.pool)
        .await?;

        // JSONをデシリアライズし、スコア・ワークスペースID・AI結果・埋め込み構築状態を設定
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
                    embedding_ready,
                )| {
                    let mut issue: Issue = serde_json::from_str(&json).ok()?;
                    issue.relevance_score = score;
                    issue.workspace_id = workspace_id;
                    issue.ai_summary = ai_summary;
                    issue.ai_risk_level = ai_risk_level;
                    issue.ai_delay_days = ai_delay_days;
                    issue.ai_suggestion = ai_suggestion;
                    issue.ai_processed_at = ai_processed_at;
                    issue.embedding_ready = embedding_ready != 0;
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

    /// 指定した種別の未処理（'pending'）AIジョブを取得
    ///
    /// バックグラウンドワーカーが**自分の担当種別のみ**を取り出すために使う。
    /// summarize ワーカーと embed ワーカーは同一 `job_queue` を共有するため、`job_type` で
    /// 絞らないと一方が他方のジョブを横取りしうる（例: embed ジョブを summarize ワーカーが
    /// 消費して `issue_embeddings` を構築しないまま done にする）。これを防ぐため種別フィルタを必須とする。
    /// 投入順（created_at, id 昇順）で古いものから返す。
    ///
    /// # 引数
    /// * `job_type` - 取得するジョブ種別（[`crate::ai::worker::JOB_TYPE_SUMMARIZE`] / [`crate::ai::worker::JOB_TYPE_EMBED`]）
    /// * `limit` - 取得する最大件数
    ///
    /// # 戻り値
    /// 当該種別の未処理ジョブのベクタ（古い順）、またはエラー
    pub async fn get_pending_jobs(&self, job_type: &str, limit: i64) -> Result<Vec<AiJob>> {
        let jobs = sqlx::query_as::<_, AiJob>(
            "SELECT id, workspace_id, issue_id, job_type, status, created_at \
             FROM job_queue WHERE status = 'pending' AND job_type = ? \
             ORDER BY created_at ASC, id ASC LIMIT ?",
        )
        .bind(job_type)
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

    /// 既保存の AI 結果のスケジュールリスクを LLM 再実行なしで再計算する（FR-V04-006）
    ///
    /// 各 `ai_results` 行について、最新の遅延日数を SQL で算出し直し、
    /// `final_risk = max(保存済み risk_level, schedule_risk(delay_days))` を取り直して保存する。
    /// LLM 推論は一切行わないため、起動時バッチとして安価に1回呼べる
    /// （[`crate::lib`] の `reset_stale_jobs` 付近で呼ぶ想定）。
    ///
    /// # 冪等性
    /// `schedule_risk` は決定的で、`max` は単調（値を下げない）ため、本処理は冪等に近い。
    /// すでに合成済み（worker が `final_risk` を保存済み）の行に再適用しても、同じ遅延日数なら
    /// 結果は変わらない。日付が進んで遅延日数が増えた行だけリスクが昇格する。
    /// スケジュール由来で**下げる**ことはしない（内容リスクは据え置く）。
    ///
    /// # しきい値の一元管理
    /// しきい値は Rust 側の [`crate::ai::schedule_risk`] に集約する。SQL に同じ条件式を複製せず、
    /// 行をメモリへ読み出して Rust で合成し直すことで、しきい値変更時の二重メンテを避ける。
    /// 対象は `ai_results` 行のみ（通常 AI 件数の規模）で、起動時1回のため総当たりでも軽量。
    ///
    /// # 戻り値
    /// `risk_level` または `delay_days` を更新した行数、またはエラー。
    pub async fn recompute_schedule_risk(&self) -> Result<u64> {
        // ai_results に対し、issues.due_date から最新の遅延日数を SQL で算出して同時に取得する。
        // delay 算出式は get_issue_delay_days と同一（先頭10文字を日付として julianday 比較）。
        // ai_results に対応する issues 行が無い孤児は LEFT JOIN で delay=NULL になる（schedule=Low）。
        type Row = (
            i64,            // workspace_id
            i64,            // issue_id
            Option<String>, // 保存済み risk_level
            Option<f64>,    // (due - 今日) の julianday 差（NULL=期限なし/算出不能）
        );
        let rows: Vec<Row> = sqlx::query_as(
            "SELECT ai.workspace_id, ai.issue_id, ai.risk_level, \
                    CASE \
                      WHEN i.due_date IS NULL OR i.due_date = '' THEN NULL \
                      ELSE julianday(substr(i.due_date, 1, 10)) - julianday('now', 'start of day') \
                    END AS due_diff \
             FROM ai_results ai \
             LEFT JOIN issues i \
               ON i.workspace_id = ai.workspace_id AND i.id = ai.issue_id",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut transaction = self.pool.begin().await?;
        let mut updated: u64 = 0;

        for (workspace_id, issue_id, stored_risk, due_diff) in rows {
            // julianday 差（期限 - 今日）を「遅延日数（正=超過）」へ変換する（符号反転）。
            let delay_days = due_diff.map(|diff| -(diff.round() as i64));

            // 保存済み risk_level（LLM 由来 or 既に合成済み）を RiskLevel へ戻す。
            // 未知・未設定は Low 起点とし、スケジュール由来のみで判定する。
            let llm_risk = stored_risk
                .as_deref()
                .and_then(crate::ai::RiskLevel::from_storage_str)
                .unwrap_or(crate::ai::RiskLevel::Low);

            let final_risk = llm_risk.max(crate::ai::schedule_risk(delay_days));
            let new_level = final_risk.as_storage_str();

            // risk_level または delay_days のどちらかが変わる行だけ UPDATE する
            // （無変更行の更新を避け、戻り値の更新件数を意味のある値にする）。
            let result = sqlx::query(
                "UPDATE ai_results SET risk_level = ?, delay_days = ? \
                 WHERE workspace_id = ? AND issue_id = ? \
                   AND (risk_level IS NOT ? OR delay_days IS NOT ?)",
            )
            .bind(new_level)
            .bind(delay_days)
            .bind(workspace_id)
            .bind(issue_id)
            .bind(new_level)
            .bind(delay_days)
            .execute(&mut *transaction)
            .await?;
            updated += result.rows_affected();
        }

        transaction.commit().await?;
        Ok(updated)
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

    // ── v0.4 埋め込み（issue_embeddings）操作 ────────────────────────────────

    /// 課題の埋め込みベクトルを保存（課題単位の UPSERT。FR-V04-004）
    ///
    /// f32 ベクトルをリトルエンディアン BLOB へ変換して `issue_embeddings` に保存する。
    /// 同一の (workspace_id, issue_id) が既に存在する場合は上書きする
    /// （`save_ai_result` と同じ `INSERT OR REPLACE` 方式）。
    /// `source_hash` はタイトル+本文+コメントから算出した変更検知用ハッシュで、
    /// 不変なら再埋め込みをスキップする判定（FR-V04-004）に用いる。
    ///
    /// # 引数
    /// * `workspace_id` - ワークスペースID
    /// * `issue_id` - 課題ID
    /// * `model` - 埋め込みモデル名（[`EMBEDDING_MODEL`]）
    /// * `dim` - ベクトル次元数（v0.4 既定 NLContextualEmbedding なら 512）
    /// * `vector` - 埋め込みベクトル（BLOB へ変換して保存）
    /// * `source_hash` - 入力テキストのハッシュ（再埋め込み判定用）
    ///
    /// # 戻り値
    /// 成功時は`Ok(())`、失敗時はエラー
    #[allow(dead_code)]
    pub async fn save_embedding(
        &self,
        workspace_id: i64,
        issue_id: i64,
        model: &str,
        dim: i64,
        vector: &[f32],
        source_hash: &str,
    ) -> Result<()> {
        let blob = vector_to_blob(vector);
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT OR REPLACE INTO issue_embeddings \
             (workspace_id, issue_id, model, dim, vector, source_hash, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(workspace_id)
        .bind(issue_id)
        .bind(model)
        .bind(dim)
        .bind(blob)
        .bind(source_hash)
        .bind(&now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// 指定課題の埋め込みベクトルを取得
    ///
    /// BLOB を f32 ベクトルへ復元して返す。未生成の場合は`None`。
    ///
    /// # 引数
    /// * `workspace_id` - ワークスペースID
    /// * `issue_id` - 課題ID
    ///
    /// # 戻り値
    /// 埋め込みベクトル（未生成なら`None`）、またはエラー
    #[allow(dead_code)]
    pub async fn get_embedding(
        &self,
        workspace_id: i64,
        issue_id: i64,
    ) -> Result<Option<Vec<f32>>> {
        let row: Option<(Vec<u8>,)> = sqlx::query_as(
            "SELECT vector FROM issue_embeddings WHERE workspace_id = ? AND issue_id = ?",
        )
        .bind(workspace_id)
        .bind(issue_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|(blob,)| blob_to_vector(&blob)))
    }

    /// ワークスペース内の全埋め込みベクトルを取得（類似検索の総当たり用。FR-V04-004）
    ///
    /// コサイン類似度の総当たり計算に用いるため、コーパス専用課題
    /// （`is_corpus_only = 1`）も含めて全件返す。BLOB は f32 ベクトルへ復元する。
    ///
    /// # 引数
    /// * `workspace_id` - ワークスペースID
    ///
    /// # 戻り値
    /// `(issue_id, ベクトル)` のベクタ、またはエラー
    #[allow(dead_code)]
    pub async fn get_all_embeddings(&self, workspace_id: i64) -> Result<Vec<(i64, Vec<f32>)>> {
        let rows: Vec<(i64, Vec<u8>)> =
            sqlx::query_as("SELECT issue_id, vector FROM issue_embeddings WHERE workspace_id = ?")
                .bind(workspace_id)
                .fetch_all(&self.pool)
                .await?;
        Ok(rows
            .into_iter()
            .map(|(issue_id, blob)| (issue_id, blob_to_vector(&blob)))
            .collect())
    }

    /// 指定課題の埋め込み `source_hash` を取得（再埋め込み判定用。FR-V04-004）
    ///
    /// 既存の `source_hash` と最新の入力テキストのハッシュが一致すれば、
    /// 本文・コメントに変更がないとみなして再埋め込みをスキップする。
    /// 埋め込み未生成、または `source_hash` 未設定の場合は`None`を返す。
    ///
    /// # 引数
    /// * `workspace_id` - ワークスペースID
    /// * `issue_id` - 課題ID
    ///
    /// # 戻り値
    /// 保存済み `source_hash`（未設定なら`None`）、またはエラー
    #[allow(dead_code)]
    pub async fn get_embedding_source_hash(
        &self,
        workspace_id: i64,
        issue_id: i64,
    ) -> Result<Option<String>> {
        let row: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT source_hash FROM issue_embeddings WHERE workspace_id = ? AND issue_id = ?",
        )
        .bind(workspace_id)
        .bind(issue_id)
        .fetch_optional(&self.pool)
        .await?;
        // 外側 Option: 行の有無 / 内側 Option: source_hash カラムの NULL 可否
        Ok(row.and_then(|(hash,)| hash))
    }

    /// 埋め込み済み課題の件数を取得（埋め込み進捗の集計用）
    ///
    /// `workspace_id` を省略（`None`）すると全ワークスペース合計を返す。
    /// 設定画面の埋め込み進捗表示や、ワーカーの残件把握に用いる。
    ///
    /// # 引数
    /// * `workspace_id` - 集計対象のワークスペースID（`None` で全体）
    ///
    /// # 戻り値
    /// 埋め込み済み件数、またはエラー
    #[allow(dead_code)]
    pub async fn count_embeddings(&self, workspace_id: Option<i64>) -> Result<i64> {
        let row: (i64,) = match workspace_id {
            Some(ws) => {
                sqlx::query_as("SELECT COUNT(*) FROM issue_embeddings WHERE workspace_id = ?")
                    .bind(ws)
                    .fetch_one(&self.pool)
                    .await?
            }
            None => {
                sqlx::query_as("SELECT COUNT(*) FROM issue_embeddings")
                    .fetch_one(&self.pool)
                    .await?
            }
        };
        Ok(row.0)
    }

    /// ワークスペース内の課題総数を取得（埋め込み対象件数の母数。FR-V04-005）
    ///
    /// コーパス専用課題（`is_corpus_only = 1`）も含めた全課題を数える。埋め込みワーカーは
    /// 通常課題・コーパス課題の双方をベクトル化するため、埋め込み進捗の「対象件数」は
    /// ワークスペース内の全課題数とする。
    ///
    /// # 引数
    /// * `workspace_id` - ワークスペースID
    ///
    /// # 戻り値
    /// 課題総数、またはエラー
    pub async fn count_issues(&self, workspace_id: i64) -> Result<i64> {
        let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM issues WHERE workspace_id = ?")
            .bind(workspace_id)
            .fetch_one(&self.pool)
            .await?;
        Ok(row.0)
    }

    /// 埋め込み構築の進捗（対象件数・構築済み件数）を取得（FR-V04-005）
    ///
    /// 設定画面・一覧の「構築待ち」表示用に、ワークスペース内の埋め込み対象件数（全課題数）と
    /// 構築済み件数（`issue_embeddings` 行数）の組を返す。`built <= target` を満たす想定だが、
    /// 課題削除と埋め込み削除のタイミング差で一時的に逆転しても呼び出し側で破綻しないよう、
    /// 両者をそのまま返す（クランプは UI 側の責務）。
    ///
    /// # 引数
    /// * `workspace_id` - ワークスペースID
    ///
    /// # 戻り値
    /// `(target, built)` = (埋め込み対象件数, 構築済み件数)、またはエラー
    pub async fn get_embedding_status(&self, workspace_id: i64) -> Result<(i64, i64)> {
        let target = self.count_issues(workspace_id).await?;
        let built = self.count_embeddings(Some(workspace_id)).await?;
        Ok((target, built))
    }

    /// 指定課題ID群の類似検索表示用メタ情報を取得（FR-V04-005）
    ///
    /// `search_similar_issues` が総当たりで選んだ上位N件について、表示に必要な
    /// `issue_key` / `summary` / `status` / `assignee` / `is_corpus_only` をまとめて取得する。
    /// `status` / `assignee` は `save_issues` 時に名称（`name`）を個別カラムへ展開済みのため、
    /// raw_data の JSON デシリアライズを伴わずに引ける（NFR-V04-002 の応答性を意識）。
    /// `project_key` は課題に専用カラムが無いため、呼び出し側が `issue_key`（例 `"PROJ-123"`）の
    /// プレフィックスから導出する。
    ///
    /// # 引数
    /// * `workspace_id` - ワークスペースID
    /// * `issue_ids` - メタ情報を取得する課題IDのスライス（空なら空ベクタを返す）
    ///
    /// # 戻り値
    /// `issue_id` をキーとした [`IssueSearchMeta`] のマップ、またはエラー
    pub async fn get_issue_search_meta(
        &self,
        workspace_id: i64,
        issue_ids: &[i64],
    ) -> Result<std::collections::HashMap<i64, IssueSearchMeta>> {
        if issue_ids.is_empty() {
            return Ok(std::collections::HashMap::new());
        }

        // IN 句のプレースホルダを動的に生成する（issue_ids は上位N件で十分小さい）。
        let placeholders = vec!["?"; issue_ids.len()].join(",");
        let sql = format!(
            "SELECT id, issue_key, summary, status, assignee, COALESCE(is_corpus_only, 0) \
             FROM issues WHERE workspace_id = ? AND id IN ({placeholders})"
        );
        let mut query =
            sqlx::query_as::<_, (i64, String, String, Option<String>, Option<String>, i64)>(&sql)
                .bind(workspace_id);
        for &id in issue_ids {
            query = query.bind(id);
        }
        let rows = query.fetch_all(&self.pool).await?;

        Ok(rows
            .into_iter()
            .map(
                |(id, issue_key, summary, status, assignee, is_corpus_only)| {
                    (
                        id,
                        IssueSearchMeta {
                            issue_key,
                            summary,
                            status,
                            assignee,
                            is_corpus_only: is_corpus_only != 0,
                        },
                    )
                },
            )
            .collect())
    }

    // ── v0.4 コメント（issue_comments / issue_comment_state）操作 ─────────────

    /// 課題コメントを保存（コメント単位の UPSERT。FR-V04-002）
    ///
    /// Backlog API で取得したコメント本文を `issue_comments` へ保存する。
    /// 同一の (workspace_id, issue_id, comment_id) が既にある場合は上書きする。
    /// 差分取得（`minId`）の起点 ID は別途 [`Self::set_comment_state`] で管理する。
    ///
    /// # 引数
    /// * `workspace_id` - ワークスペースID
    /// * `issue_id` - 課題ID
    /// * `comments` - 保存するコメントのスライス
    ///
    /// # 戻り値
    /// 成功時は`Ok(())`、失敗時はエラー
    #[allow(dead_code)]
    pub async fn save_comments(
        &self,
        workspace_id: i64,
        issue_id: i64,
        comments: &[Comment],
    ) -> Result<()> {
        if comments.is_empty() {
            return Ok(());
        }
        let mut transaction = self.pool.begin().await?;
        for c in comments {
            sqlx::query(
                "INSERT OR REPLACE INTO issue_comments \
                 (workspace_id, issue_id, comment_id, content, created_at) \
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(workspace_id)
            .bind(issue_id)
            .bind(c.comment_id)
            .bind(&c.content)
            .bind(&c.created_at)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    /// 課題コメントを結合・切り詰めて取得（埋め込み入力用）
    ///
    /// 保存済みコメント本文を投稿順（comment_id 昇順）に改行で連結し、
    /// 先頭 `max_chars` 文字に切り詰めて返す。埋め込み入力テキストの一部や
    /// `source_hash` 計算に用いる。コメントが無ければ空文字を返す。
    ///
    /// # 引数
    /// * `workspace_id` - ワークスペースID
    /// * `issue_id` - 課題ID
    /// * `max_chars` - 連結後テキストの最大文字数（負値・0 は無制限扱い）
    ///
    /// # 戻り値
    /// 連結・切り詰めたコメントテキスト、またはエラー
    #[allow(dead_code)]
    pub async fn get_comments_text(
        &self,
        workspace_id: i64,
        issue_id: i64,
        max_chars: i64,
    ) -> Result<String> {
        let rows: Vec<(Option<String>,)> = sqlx::query_as(
            "SELECT content FROM issue_comments \
             WHERE workspace_id = ? AND issue_id = ? ORDER BY comment_id ASC",
        )
        .bind(workspace_id)
        .bind(issue_id)
        .fetch_all(&self.pool)
        .await?;

        // 空コメント（None）は除外して改行連結する。
        let joined = rows
            .into_iter()
            .filter_map(|(c,)| c)
            .filter(|c| !c.is_empty())
            .collect::<Vec<_>>()
            .join("\n");

        // max_chars が正のときだけ char 単位で切り詰める（マルチバイト安全）。
        if max_chars > 0 {
            Ok(joined.chars().take(max_chars as usize).collect())
        } else {
            Ok(joined)
        }
    }

    /// 課題のコメント差分取得状態を取得（FR-V04-002）
    ///
    /// `(last_comment_id, status, retry_count)` を返す。状態行が未作成の場合は
    /// 初期値 `(None, "idle", 0)` を返す（呼び出し側が分岐せず使えるようにする）。
    ///
    /// # 引数
    /// * `workspace_id` - ワークスペースID
    /// * `issue_id` - 課題ID
    ///
    /// # 戻り値
    /// `(最終取得コメントID, 状態, リトライ回数)`、またはエラー
    #[allow(dead_code)]
    pub async fn get_comment_state(
        &self,
        workspace_id: i64,
        issue_id: i64,
    ) -> Result<(Option<i64>, String, i64)> {
        let row: Option<(Option<i64>, String, i64)> = sqlx::query_as(
            "SELECT last_comment_id, status, retry_count FROM issue_comment_state \
             WHERE workspace_id = ? AND issue_id = ?",
        )
        .bind(workspace_id)
        .bind(issue_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.unwrap_or((None, "idle".to_string(), 0)))
    }

    /// 課題のコメント差分取得状態を保存（UPSERT。FR-V04-002）
    ///
    /// 最終取得コメント ID・状態・リトライ回数を `issue_comment_state` へ保存する。
    /// 次回の差分取得（`minId`）の起点とバックオフ制御に用いる。
    ///
    /// # 引数
    /// * `workspace_id` - ワークスペースID
    /// * `issue_id` - 課題ID
    /// * `last_comment_id` - 最終取得コメントID（未取得なら`None`）
    /// * `status` - 取得状態（idle / fetching / done / failed）
    /// * `retry_count` - リトライ回数（バックオフ制御用）
    ///
    /// # 戻り値
    /// 成功時は`Ok(())`、失敗時はエラー
    #[allow(dead_code)]
    pub async fn set_comment_state(
        &self,
        workspace_id: i64,
        issue_id: i64,
        last_comment_id: Option<i64>,
        status: &str,
        retry_count: i64,
    ) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT OR REPLACE INTO issue_comment_state \
             (workspace_id, issue_id, last_comment_id, status, retry_count, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(workspace_id)
        .bind(issue_id)
        .bind(last_comment_id)
        .bind(status)
        .bind(retry_count)
        .bind(&now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    // ── v0.4 コーパス（完了課題）操作 ────────────────────────────────────────

    /// 埋め込み入力・source_hash 計算用のテキストを組み立てて取得（FR-V04-004）
    ///
    /// タイトル（summary）+ 本文（description）+ コメントを連結したテキストを返す。
    /// 本文は先頭 `body_max` 文字、コメントは結合後 `comment_max` 文字に切り詰める
    /// （`get_issue_analysis_fields` と同様に SQL 側で本文を切り詰め、コメントは
    /// [`Self::get_comments_text`] を再利用する）。このテキストのハッシュが `source_hash`
    /// となり、変化したときだけ再埋め込みする（FR-V04-004 / 未解決事項#5 既定値）。
    ///
    /// # 引数
    /// * `workspace_id` - ワークスペースID
    /// * `issue_id` - 課題ID
    /// * `body_max` - 本文の最大文字数
    /// * `comment_max` - コメント連結後の最大文字数
    ///
    /// # 戻り値
    /// 連結テキスト（対象課題が無ければ`None`）、またはエラー
    #[allow(dead_code)]
    pub async fn get_issue_embed_text(
        &self,
        workspace_id: i64,
        issue_id: i64,
        body_max: i64,
        comment_max: i64,
    ) -> Result<Option<String>> {
        // タイトル+本文を SQL 側で取得（本文は substr で切り詰め）。
        // 課題が存在しなければ None を返す。
        let row: Option<(String, String)> = sqlx::query_as(
            "SELECT summary, substr(COALESCE(description, ''), 1, ?) \
             FROM issues WHERE workspace_id = ? AND id = ?",
        )
        .bind(body_max)
        .bind(workspace_id)
        .bind(issue_id)
        .fetch_optional(&self.pool)
        .await?;

        let Some((summary, body_head)) = row else {
            return Ok(None);
        };

        let comments = self
            .get_comments_text(workspace_id, issue_id, comment_max)
            .await?;

        // タイトル → 本文 → コメントの順に連結。空セクションは含めない。
        let mut parts: Vec<String> = vec![summary];
        if !body_head.is_empty() {
            parts.push(body_head);
        }
        if !comments.is_empty() {
            parts.push(comments);
        }
        Ok(Some(parts.join("\n")))
    }

    /// 期間短縮時に範囲外の完了課題コーパスをクリーンアップ（FR-V04-003）
    ///
    /// コーパス期間（過去 N ヶ月）を短縮したとき、`updated_at` が `oldest_updated`
    /// より古いコーパス専用課題（`is_corpus_only = 1`）と、それに紐づく埋め込み・
    /// コメント・コメント状態をまとめて削除する。コーパス専用行のみが対象で、
    /// 通常の（未完了・一覧表示対象の）課題には影響しない。
    ///
    /// # 引数
    /// * `workspace_id` - ワークスペースID
    /// * `oldest_updated` - 保持する最古の更新日時（ISO8601。これより古い行を削除）
    ///
    /// # 戻り値
    /// 削除したコーパス課題件数、またはエラー
    #[allow(dead_code)]
    pub async fn cleanup_corpus_out_of_range(
        &self,
        workspace_id: i64,
        oldest_updated: &str,
    ) -> Result<u64> {
        let mut transaction = self.pool.begin().await?;

        // 削除対象のコーパス課題 ID を先に確定し、関連データ→課題本体の順に削除する。
        let target_ids: Vec<(i64,)> = sqlx::query_as(
            "SELECT id FROM issues \
             WHERE workspace_id = ? AND COALESCE(is_corpus_only, 0) = 1 \
               AND (updated_at IS NULL OR updated_at < ?)",
        )
        .bind(workspace_id)
        .bind(oldest_updated)
        .fetch_all(&mut *transaction)
        .await?;

        if target_ids.is_empty() {
            transaction.commit().await?;
            return Ok(0);
        }

        let id_list = target_ids
            .iter()
            .map(|(id,)| id.to_string())
            .collect::<Vec<_>>()
            .join(",");

        // 関連データ（埋め込み・コメント・コメント状態）→ 課題本体の順に削除。
        for table in ["issue_embeddings", "issue_comments", "issue_comment_state"] {
            let sql =
                format!("DELETE FROM {table} WHERE workspace_id = ? AND issue_id IN ({id_list})");
            sqlx::query(&sql)
                .bind(workspace_id)
                .execute(&mut *transaction)
                .await?;
        }
        let result = sqlx::query(&format!(
            "DELETE FROM issues WHERE workspace_id = ? AND id IN ({id_list})"
        ))
        .bind(workspace_id)
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;
        Ok(result.rows_affected())
    }

    /// コーパス専用（完了課題）件数を取得（設定画面の件数表示用。FR-V04-003）
    ///
    /// `is_corpus_only = 1` の課題件数を返す。設定画面でコーパスの規模を
    /// 表示するために用いる。
    ///
    /// # 引数
    /// * `workspace_id` - ワークスペースID
    ///
    /// # 戻り値
    /// コーパス専用課題件数、またはエラー
    #[allow(dead_code)]
    pub async fn count_corpus_issues(&self, workspace_id: i64) -> Result<i64> {
        let row: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM issues \
             WHERE workspace_id = ? AND COALESCE(is_corpus_only, 0) = 1",
        )
        .bind(workspace_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.0)
    }

    /// コーパス専用（完了課題）の課題IDを取得（初回コメント全件取得用。FR-V04-002 / FR-V04-003）
    ///
    /// 埋め込み未構築時に、コーパス対象の完了課題へ1回だけコメント全件取得を行うために
    /// 対象の課題IDを列挙する。`is_corpus_only = 1` の行のみを返す。
    ///
    /// # 引数
    /// * `workspace_id` - ワークスペースID
    ///
    /// # 戻り値
    /// コーパス専用課題IDのベクタ、またはエラー
    #[allow(dead_code)]
    pub async fn get_corpus_issue_ids(&self, workspace_id: i64) -> Result<Vec<i64>> {
        let rows: Vec<(i64,)> = sqlx::query_as(
            "SELECT id FROM issues \
             WHERE workspace_id = ? AND COALESCE(is_corpus_only, 0) = 1 ORDER BY id ASC",
        )
        .bind(workspace_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|(id,)| id).collect())
    }

    /// テスト用に最小限の課題を1件挿入する（クレート内テスト共通の seam）
    ///
    /// `issues.workspace_id` は `workspaces` への外部キー制約を持つため、対象ワークスペースを
    /// 先に冪等挿入してから課題を upsert する。`pool` は非公開のため、他モジュール
    /// （例: [`crate::ai::embed_worker`]）の単体テストが課題を仕込めるよう `pub(crate)` で公開する。
    /// 本番コードからは呼ばれないため `#[cfg(test)]` でテストビルドのみに限定する。
    ///
    /// # 引数
    /// * `workspace_id` - ワークスペースID
    /// * `id` - 課題ID
    /// * `summary` - 課題タイトル
    /// * `description` - 課題本文
    #[cfg(test)]
    pub(crate) async fn insert_test_issue(
        &self,
        workspace_id: i64,
        id: i64,
        summary: &str,
        description: &str,
    ) {
        sqlx::query(
            "INSERT OR IGNORE INTO workspaces (id, domain, api_key, project_keys) \
             VALUES (?, ?, ?, ?)",
        )
        .bind(workspace_id)
        .bind(format!("ws{workspace_id}.example.com"))
        .bind("key")
        .bind("TEST")
        .execute(&self.pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT OR REPLACE INTO issues \
             (id, workspace_id, issue_key, summary, description) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(workspace_id)
        .bind(format!("TEST-{id}"))
        .bind(summary)
        .bind(description)
        .execute(&self.pool)
        .await
        .unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqliteConnectOptions;
    use std::str::FromStr;

    /// in-memory SQLite を用いてマイグレーション済みの [`DbClient`] を生成する
    async fn new_test_db() -> DbClient {
        let options = SqliteConnectOptions::from_str("sqlite::memory:").unwrap();
        let db = DbClient::new_with_options(options).await.unwrap();
        db.migrate().await.unwrap();
        db
    }

    /// テスト用の課題を1件挿入する（コーパステスト等で使用）
    ///
    /// `issues.workspace_id` は `workspaces` への外部キー制約を持つため、
    /// 対象ワークスペースを先に冪等挿入してから課題を挿入する。
    async fn insert_issue(
        db: &DbClient,
        workspace_id: i64,
        id: i64,
        summary: &str,
        description: &str,
        updated_at: &str,
        is_corpus_only: i64,
    ) {
        sqlx::query(
            "INSERT OR IGNORE INTO workspaces (id, domain, api_key, project_keys) \
             VALUES (?, ?, ?, ?)",
        )
        .bind(workspace_id)
        .bind(format!("ws{workspace_id}.example.com"))
        .bind("key")
        .bind("TEST")
        .execute(&db.pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO issues \
             (id, workspace_id, issue_key, summary, description, updated_at, is_corpus_only) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(workspace_id)
        .bind(format!("TEST-{id}"))
        .bind(summary)
        .bind(description)
        .bind(updated_at)
        .bind(is_corpus_only)
        .execute(&db.pool)
        .await
        .unwrap();
    }

    #[test]
    fn vector_blob_roundtrip_preserves_values() {
        let v = vec![0.0_f32, 1.0, -1.5, 42.125, f32::MIN_POSITIVE, 1e10];
        let blob = vector_to_blob(&v);
        assert_eq!(blob.len(), v.len() * 4);
        let back = blob_to_vector(&blob);
        assert_eq!(v, back);
    }

    #[test]
    fn blob_to_vector_ignores_trailing_bytes() {
        // 4バイト境界に満たない端数は切り捨てられる。
        let mut blob = vector_to_blob(&[1.0_f32, 2.0]);
        blob.push(0xAB); // 端数バイトを付与
        assert_eq!(blob_to_vector(&blob), vec![1.0_f32, 2.0]);
    }

    #[tokio::test]
    async fn embedding_roundtrip_and_skip_decision() {
        let db = new_test_db().await;
        let vector: Vec<f32> = (0..EMBEDDING_DIM).map(|i| i as f32 * 0.01).collect();

        // 保存 → 取得でベクトルが一致する。
        db.save_embedding(
            1,
            100,
            EMBEDDING_MODEL,
            EMBEDDING_DIM as i64,
            &vector,
            "hash-a",
        )
        .await
        .unwrap();
        let fetched = db.get_embedding(1, 100).await.unwrap();
        assert_eq!(fetched, Some(vector.clone()));

        // source_hash が一致すれば再埋め込みをスキップできる（不変判定）。
        let stored_hash = db.get_embedding_source_hash(1, 100).await.unwrap();
        assert_eq!(stored_hash.as_deref(), Some("hash-a"));

        // UPSERT で上書きされる（次元・ハッシュ更新）。
        let vector2: Vec<f32> = vec![9.0; EMBEDDING_DIM];
        db.save_embedding(
            1,
            100,
            EMBEDDING_MODEL,
            EMBEDDING_DIM as i64,
            &vector2,
            "hash-b",
        )
        .await
        .unwrap();
        assert_eq!(db.get_embedding(1, 100).await.unwrap(), Some(vector2));
        assert_eq!(
            db.get_embedding_source_hash(1, 100)
                .await
                .unwrap()
                .as_deref(),
            Some("hash-b")
        );

        // 未生成課題は None。
        assert_eq!(db.get_embedding(1, 999).await.unwrap(), None);
        assert_eq!(db.get_embedding_source_hash(1, 999).await.unwrap(), None);
    }

    #[tokio::test]
    async fn get_all_embeddings_and_count() {
        let db = new_test_db().await;
        let v = vec![0.5_f32; EMBEDDING_DIM];
        db.save_embedding(1, 10, EMBEDDING_MODEL, EMBEDDING_DIM as i64, &v, "h1")
            .await
            .unwrap();
        db.save_embedding(1, 11, EMBEDDING_MODEL, EMBEDDING_DIM as i64, &v, "h2")
            .await
            .unwrap();
        db.save_embedding(2, 20, EMBEDDING_MODEL, EMBEDDING_DIM as i64, &v, "h3")
            .await
            .unwrap();

        let mut all = db.get_all_embeddings(1).await.unwrap();
        all.sort_by_key(|(id, _)| *id);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].0, 10);
        assert_eq!(all[1].0, 11);
        assert_eq!(all[0].1, v);

        assert_eq!(db.count_embeddings(Some(1)).await.unwrap(), 2);
        assert_eq!(db.count_embeddings(Some(2)).await.unwrap(), 1);
        assert_eq!(db.count_embeddings(None).await.unwrap(), 3);
    }

    #[tokio::test]
    async fn embedding_status_reports_target_and_built() {
        let db = new_test_db().await;
        // 通常課題2件 + コーパス課題1件 = 対象3件。
        insert_issue(&db, 1, 10, "a", "", "2026-06-10T00:00:00Z", 0).await;
        insert_issue(&db, 1, 11, "b", "", "2026-06-10T00:00:00Z", 0).await;
        insert_issue(&db, 1, 12, "c", "", "2026-06-10T00:00:00Z", 1).await;

        // 埋め込みは2件のみ構築済み。
        let v = vec![0.5_f32; EMBEDDING_DIM];
        db.save_embedding(1, 10, EMBEDDING_MODEL, EMBEDDING_DIM as i64, &v, "h1")
            .await
            .unwrap();
        db.save_embedding(1, 12, EMBEDDING_MODEL, EMBEDDING_DIM as i64, &v, "h2")
            .await
            .unwrap();

        let (target, built) = db.get_embedding_status(1).await.unwrap();
        assert_eq!(target, 3, "コーパス含む全課題が対象件数");
        assert_eq!(built, 2, "構築済みは2件");
    }

    #[tokio::test]
    async fn issue_search_meta_returns_only_requested_ids() {
        let db = new_test_db().await;
        // status / assignee 付きで課題を挿入する。
        db.insert_test_issue(1, 100, "タイトルA", "本文").await;
        db.insert_test_issue(1, 101, "タイトルB", "本文").await;
        insert_issue(&db, 1, 102, "コーパス課題", "", "2026-06-10T00:00:00Z", 1).await;

        let meta = db.get_issue_search_meta(1, &[100, 102, 999]).await.unwrap();
        // 要求した既存IDのみ返る（999 は存在しないので含まれない）。
        assert_eq!(meta.len(), 2);
        assert!(meta.contains_key(&100));
        assert!(meta.contains_key(&102));
        assert_eq!(meta[&100].issue_key, "TEST-100");
        assert_eq!(meta[&100].summary, "タイトルA");
        assert!(!meta[&100].is_corpus_only);
        // コーパス課題のフラグが立つ。
        assert!(meta[&102].is_corpus_only);

        // 空入力は空マップ（DB アクセスせずに早期 return）。
        assert!(db.get_issue_search_meta(1, &[]).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn get_issues_sets_embedding_ready_flag() {
        let db = new_test_db().await;
        // ワークスペースを用意（issues の外部キー制約のため）。
        sqlx::query(
            "INSERT OR IGNORE INTO workspaces (id, domain, api_key, project_keys) \
             VALUES (1, 'ws1.example.com', 'key', 'PROJ')",
        )
        .execute(&db.pool)
        .await
        .unwrap();
        // raw_data を持つ通常課題を save_issues 経由で2件保存する。
        let issues = vec![
            make_issue(200, "PROJ", false),
            make_issue(201, "PROJ", false),
        ];
        db.save_issues(1, &issues, &["PROJ"], &["PROJ"])
            .await
            .unwrap();

        // 片方だけ埋め込みを構築する。
        let v = vec![0.5_f32; EMBEDDING_DIM];
        db.save_embedding(1, 200, EMBEDDING_MODEL, EMBEDDING_DIM as i64, &v, "h")
            .await
            .unwrap();

        let listed = db.get_issues().await.unwrap();
        let i200 = listed.iter().find(|i| i.id == 200).unwrap();
        let i201 = listed.iter().find(|i| i.id == 201).unwrap();
        assert!(i200.embedding_ready, "埋め込み済みは embedding_ready=true");
        assert!(!i201.embedding_ready, "未構築は embedding_ready=false");
    }

    #[tokio::test]
    async fn comments_save_and_text_join_truncate() {
        let db = new_test_db().await;
        let comments = vec![
            Comment {
                comment_id: 3,
                content: Some("third".into()),
                created_at: None,
                created_user: None,
            },
            Comment {
                comment_id: 1,
                content: Some("first".into()),
                created_at: None,
                created_user: None,
            },
            Comment {
                comment_id: 2,
                content: None,
                created_at: None,
                created_user: None,
            },
        ];
        db.save_comments(1, 100, &comments).await.unwrap();

        // comment_id 昇順で連結（None は除外）。
        let text = db.get_comments_text(1, 100, 0).await.unwrap();
        assert_eq!(text, "first\nthird");

        // 文字数切り詰め。
        let truncated = db.get_comments_text(1, 100, 3).await.unwrap();
        assert_eq!(truncated, "fir");

        // 空配列保存は no-op。
        db.save_comments(1, 200, &[]).await.unwrap();
        assert_eq!(db.get_comments_text(1, 200, 0).await.unwrap(), "");
    }

    #[tokio::test]
    async fn comment_state_get_set() {
        let db = new_test_db().await;
        // 未作成は初期値。
        assert_eq!(
            db.get_comment_state(1, 100).await.unwrap(),
            (None, "idle".to_string(), 0)
        );

        db.set_comment_state(1, 100, Some(42), "done", 2)
            .await
            .unwrap();
        assert_eq!(
            db.get_comment_state(1, 100).await.unwrap(),
            (Some(42), "done".to_string(), 2)
        );

        // UPSERT で更新。
        db.set_comment_state(1, 100, Some(99), "fetching", 0)
            .await
            .unwrap();
        assert_eq!(
            db.get_comment_state(1, 100).await.unwrap(),
            (Some(99), "fetching".to_string(), 0)
        );
    }

    #[tokio::test]
    async fn embed_text_concatenates_title_body_comments() {
        let db = new_test_db().await;
        insert_issue(
            &db,
            1,
            100,
            "タイトル",
            "本文テキスト",
            "2026-06-01T00:00:00Z",
            0,
        )
        .await;
        db.save_comments(
            1,
            100,
            &[Comment {
                comment_id: 1,
                content: Some("コメント".into()),
                created_at: None,
                created_user: None,
            }],
        )
        .await
        .unwrap();

        let text = db.get_issue_embed_text(1, 100, 1000, 1000).await.unwrap();
        assert_eq!(text.as_deref(), Some("タイトル\n本文テキスト\nコメント"));

        // 本文切り詰め（先頭3文字）。
        let truncated = db.get_issue_embed_text(1, 100, 3, 0).await.unwrap();
        assert_eq!(truncated.as_deref(), Some("タイトル\n本文テ\nコメント"));

        // 存在しない課題は None。
        assert_eq!(
            db.get_issue_embed_text(1, 999, 100, 100).await.unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn corpus_count_and_cleanup_out_of_range() {
        let db = new_test_db().await;
        // 通常課題1件 + コーパス課題2件（うち1件は範囲外の古い更新日時）。
        insert_issue(&db, 1, 1, "normal", "", "2026-06-10T00:00:00Z", 0).await;
        insert_issue(&db, 1, 2, "corpus-new", "", "2026-06-10T00:00:00Z", 1).await;
        insert_issue(&db, 1, 3, "corpus-old", "", "2026-01-01T00:00:00Z", 1).await;

        // コーパス件数はコーパス専用行のみ。
        assert_eq!(db.count_corpus_issues(1).await.unwrap(), 2);

        // 関連データを付けてクリーンアップ対象の連鎖削除を検証。
        let v = vec![1.0_f32; EMBEDDING_DIM];
        db.save_embedding(1, 3, EMBEDDING_MODEL, EMBEDDING_DIM as i64, &v, "h")
            .await
            .unwrap();
        db.save_comments(
            1,
            3,
            &[Comment {
                comment_id: 1,
                content: Some("c".into()),
                created_at: None,
                created_user: None,
            }],
        )
        .await
        .unwrap();
        db.set_comment_state(1, 3, Some(1), "done", 0)
            .await
            .unwrap();

        // 2026-05-01 より古いコーパス課題（id=3）だけ削除される。
        let deleted = db
            .cleanup_corpus_out_of_range(1, "2026-05-01T00:00:00Z")
            .await
            .unwrap();
        assert_eq!(deleted, 1);
        assert_eq!(db.count_corpus_issues(1).await.unwrap(), 1);

        // id=3 の関連データも消えている。
        assert_eq!(db.get_embedding(1, 3).await.unwrap(), None);
        assert_eq!(db.get_comments_text(1, 3, 0).await.unwrap(), "");
        assert_eq!(
            db.get_comment_state(1, 3).await.unwrap(),
            (None, "idle".to_string(), 0)
        );

        // 通常課題（id=1）はコーパス削除の対象外。
        let remaining: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM issues WHERE workspace_id = 1")
                .fetch_one(&db.pool)
                .await
                .unwrap();
        assert_eq!(remaining.0, 2);
    }

    /// `save_issues` 用のダミー課題を作る（保存・クリーンアップ検証に必要なフィールドのみ設定）。
    fn make_issue(id: i64, project: &str, is_corpus_only: bool) -> Issue {
        Issue {
            id,
            issue_key: format!("{project}-{id}"),
            summary: format!("issue {id}"),
            description: None,
            priority: None,
            status: None,
            issue_type: None,
            assignee: None,
            due_date: None,
            updated: Some("2026-06-10T00:00:00Z".to_string()),
            relevance_score: 0,
            workspace_id: 1,
            ai_summary: None,
            ai_risk_level: None,
            ai_suggestion: None,
            ai_delay_days: None,
            ai_processed_at: None,
            is_corpus_only,
            embedding_ready: false,
        }
    }

    #[tokio::test]
    async fn save_issues_keeps_corpus_and_separates_normal_and_corpus_cleanup() {
        let db = new_test_db().await;
        // ワークスペースを用意（issues の外部キー制約のため）。
        sqlx::query(
            "INSERT OR IGNORE INTO workspaces (id, domain, api_key, project_keys) \
             VALUES (1, 'ws1.example.com', 'key', 'PROJ')",
        )
        .execute(&db.pool)
        .await
        .unwrap();

        // 1) 完了課題コーパスバッチを保存（is_corpus_only=true）。クリーンアップは走らない。
        let corpus = vec![make_issue(101, "PROJ", true), make_issue(102, "PROJ", true)];
        db.save_issues(1, &corpus, &[], &[]).await.unwrap();
        assert_eq!(db.count_corpus_issues(1).await.unwrap(), 2);

        // 2) 通常 sync バッチを保存（is_corpus_only=false、コーパスIDは含まない）。
        //    通常バッチのクリーンアップはコーパス行（101/102）を消してはならない（FR-V04-003）。
        let normal = vec![make_issue(1, "PROJ", false), make_issue(2, "PROJ", false)];
        db.save_issues(1, &normal, &["PROJ"], &["PROJ"])
            .await
            .unwrap();

        // コーパス2件は保持されている。
        assert_eq!(db.count_corpus_issues(1).await.unwrap(), 2);
        // 通常一覧（get_issues はコーパス除外）には通常2件のみ出る。
        let listed = db.get_issues().await.unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed.iter().all(|i| !i.is_corpus_only));
        // 全行数は通常2 + コーパス2 = 4。
        let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM issues WHERE workspace_id = 1")
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(total.0, 4);

        // 3) 続けてコーパスバッチを再保存しても、通常課題（1/2）は消えない
        //    （コーパスバッチはプロジェクト単位の破壊的クリーンアップを行わない）。
        let corpus2 = vec![make_issue(103, "PROJ", true)];
        db.save_issues(1, &corpus2, &[], &[]).await.unwrap();
        let listed_after = db.get_issues().await.unwrap();
        assert_eq!(listed_after.len(), 2); // 通常課題は維持
        assert_eq!(db.count_corpus_issues(1).await.unwrap(), 3); // コーパスは増えた
    }

    /// 指定した日付オフセット（今日からの相対日数）の due_date を持つ課題を挿入する。
    ///
    /// `offset_days` が負なら過去（期限超過）、正なら未来（猶予あり）。
    async fn insert_issue_with_due(db: &DbClient, workspace_id: i64, id: i64, offset_days: i64) {
        let due = (chrono::Local::now().date_naive() + chrono::Duration::days(offset_days))
            .format("%Y-%m-%d")
            .to_string();
        sqlx::query(
            "INSERT OR IGNORE INTO workspaces (id, domain, api_key, project_keys) \
             VALUES (?, ?, ?, ?)",
        )
        .bind(workspace_id)
        .bind(format!("ws{workspace_id}.example.com"))
        .bind("key")
        .bind("TEST")
        .execute(&db.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT OR REPLACE INTO issues \
             (id, workspace_id, issue_key, summary, due_date) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(workspace_id)
        .bind(format!("TEST-{id}"))
        .bind("title")
        .bind(due)
        .execute(&db.pool)
        .await
        .unwrap();
    }

    /// `ai_results` 行を直接挿入する（再計算テスト用の seam）。
    async fn insert_ai_result(db: &DbClient, workspace_id: i64, issue_id: i64, risk_level: &str) {
        sqlx::query(
            "INSERT OR REPLACE INTO ai_results \
             (issue_id, workspace_id, summary, risk_level, delay_days, suggestion, processed_at, model_used) \
             VALUES (?, ?, ?, ?, NULL, ?, ?, ?)",
        )
        .bind(issue_id)
        .bind(workspace_id)
        .bind("summary")
        .bind(risk_level)
        .bind("suggestion")
        .bind("2026-06-01T00:00:00Z")
        .bind("mock")
        .execute(&db.pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn recompute_schedule_risk_promotes_overdue_to_high() {
        let db = new_test_db().await;
        // 469日超過した課題に、LLM が low と判定した既存結果を仕込む（v0.3 由来を模す）。
        insert_issue_with_due(&db, 1, 100, -469).await;
        insert_ai_result(&db, 1, 100, "low").await;

        // 期限まで十分に猶予がある課題（30日後）。LLM=low はスケジュールで昇格しない。
        insert_issue_with_due(&db, 1, 101, 30).await;
        insert_ai_result(&db, 1, 101, "low").await;

        // LLM が既に high と判定済みの課題は、猶予があってもスケジュールで下げない。
        insert_issue_with_due(&db, 1, 102, 30).await;
        insert_ai_result(&db, 1, 102, "high").await;

        let updated = db.recompute_schedule_risk().await.unwrap();
        // 100（low→high）と 101・102（delay_days を NULL→具体値へ更新）が変わる。
        assert!(updated >= 1);

        // 469日超過課題は high へ昇格し、遅延日数が正の値で記録される。
        let r100 = db.get_ai_result(1, 100).await.unwrap().unwrap();
        assert_eq!(r100.risk_level.as_deref(), Some("high"));
        assert_eq!(r100.delay_days, Some(469));

        // 猶予のある課題は low のまま（スケジュールで昇格しない）。delay_days は負（猶予）。
        let r101 = db.get_ai_result(1, 101).await.unwrap().unwrap();
        assert_eq!(r101.risk_level.as_deref(), Some("low"));
        assert_eq!(r101.delay_days, Some(-30));

        // high は据え置き（スケジュールで下げない）。
        let r102 = db.get_ai_result(1, 102).await.unwrap().unwrap();
        assert_eq!(r102.risk_level.as_deref(), Some("high"));
    }

    #[tokio::test]
    async fn recompute_schedule_risk_is_idempotent() {
        let db = new_test_db().await;
        insert_issue_with_due(&db, 1, 100, -469).await;
        insert_ai_result(&db, 1, 100, "low").await;

        // 1回目で昇格・更新が起きる。
        let first = db.recompute_schedule_risk().await.unwrap();
        assert!(first >= 1);
        // 2回目は遅延日数・リスクが同じため、更新行は 0（冪等）。
        let second = db.recompute_schedule_risk().await.unwrap();
        assert_eq!(second, 0);
        assert_eq!(
            db.get_ai_result(1, 100)
                .await
                .unwrap()
                .unwrap()
                .risk_level
                .as_deref(),
            Some("high")
        );
    }
}
