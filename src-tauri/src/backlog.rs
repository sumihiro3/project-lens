use serde::{Deserialize, Serialize};
use std::error::Error;

/// Backlog APIクライアント
///
/// Backlog APIとの通信を担当するクライアント構造体。
/// APIキーとドメインを使用して認証を行い、課題情報やユーザー情報を取得する。
#[derive(Debug, Clone)]
pub struct BacklogClient {
    /// APIキー
    api_key: String,
    /// APIのベースURL (例: https://example.backlog.com/api/v2)
    base_url: String,
    /// HTTPクライアント
    client: reqwest::Client,
}

/// Backlog課題
///
/// Backlog APIから取得した課題の情報を保持する構造体。
/// JSON形式のレスポンスをデシリアライズして使用する。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Issue {
    /// 課題ID
    pub id: i64,
    /// 課題キー (例: PROJ-123)
    #[serde(rename = "issueKey")]
    pub issue_key: String,
    /// 課題の件名
    pub summary: String,
    /// 課題の説明文
    pub description: Option<String>,
    /// 優先度
    pub priority: Option<Priority>,
    /// ステータス
    pub status: Option<Status>,
    /// 種別
    #[serde(rename = "issueType")]
    pub issue_type: Option<IssueType>,
    /// 担当者
    pub assignee: Option<User>,
    /// 期限日
    #[serde(rename = "dueDate")]
    pub due_date: Option<String>,
    /// 最終更新日時
    pub updated: Option<String>,
    /// 作成日時（Backlog API の `created`）。
    ///
    /// v0.4.5 の週次/月次アクティビティレポート（FR-V045-003）で「期間内の新規作成件数」を
    /// 集計するために取り込む。raw_data に含めて保存し、`issues.created_at` カラムへも展開する。
    #[serde(default)]
    pub created: Option<String>,
    /// 関連度スコア（デシリアライズ時はスキップ、後で計算して設定）
    #[serde(skip_deserializing, default)]
    pub relevance_score: i32,
    /// ワークスペースID（DB保存時に設定）
    #[serde(skip_deserializing, default)]
    pub workspace_id: i64,
    /// AI 1行要約（`ai_results` から取得。未生成の場合は `None`）。
    ///
    /// raw_data には保存されず、`get_issues` の `ai_results` LEFT JOIN 結果から設定する（v0.3）。
    /// `#[serde(default)]` により raw_data デシリアライズ時は欠落しても初期値（`None`）になる。
    #[serde(default)]
    pub ai_summary: Option<String>,
    /// AI リスクレベル（`high` / `medium` / `low`。未生成の場合は `None`。v0.3）。
    #[serde(default)]
    pub ai_risk_level: Option<String>,
    /// AI 対応提案（未生成の場合は `None`。v0.3）。
    #[serde(default)]
    pub ai_suggestion: Option<String>,
    /// 遅延日数（SQL 算出値。正=遅延・0=当日・負=猶予。未算出は `None`。v0.3）。
    #[serde(default)]
    pub ai_delay_days: Option<i64>,
    /// AI 分析の処理日時（ISO8601 文字列。未生成の場合は `None`。v0.3）。
    #[serde(default)]
    pub ai_processed_at: Option<String>,
    /// コーパス専用フラグ（v0.4 / FR-V04-003）。
    ///
    /// 完了課題コーパス取り込み時に `true` を立てる。`true` の課題は類似検索の
    /// コーパスとしてのみ使い、ダッシュボード・一覧・スコア表示には含めない。
    /// API レスポンスには無いフィールドなので `skip_deserializing` で取り込みを抑止し、
    /// `get_closed_issues` 取得後に呼び出し側で `true` を設定して `save_issues` へ渡す。
    /// DB では専用カラム `issues.is_corpus_only` を正とする。
    #[serde(skip_deserializing, default)]
    pub is_corpus_only: bool,
    /// 埋め込み構築済みフラグ（v0.4 / FR-V04-005）。
    ///
    /// `issue_embeddings` に当該課題のベクトルが存在すれば `true`。`get_issues` の
    /// `issue_embeddings` LEFT JOIN 結果から設定し、フロントの「類似を探す」ボタンの
    /// 構築待ち表示（埋め込み未構築なら無効化）に用いる。
    /// raw_data には保存されないため `#[serde(default)]` で復元時の欠落を許容する。
    #[serde(default)]
    pub embedding_ready: bool,
}

/// 優先度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Priority {
    pub id: i64,
    pub name: String,
}

/// ステータス
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Status {
    pub id: i64,
    pub name: String,
}

/// 種別
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IssueType {
    pub id: i64,
    pub name: String,
}

/// ユーザー
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: i64,
    pub name: String,
}

impl BacklogClient {
    /// 新しいBacklogClientを作成
    ///
    /// # 引数
    /// * `domain` - Backlogのドメイン (例: example.backlog.com)
    /// * `api_key` - BacklogのAPIキー
    pub fn new(domain: &str, api_key: &str) -> Self {
        let base_url = format!("https://{domain}/api/v2");
        Self {
            api_key: api_key.to_string(),
            base_url,
            client: reqwest::Client::new(),
        }
    }

    /// プロジェクトの課題一覧を取得
    ///
    /// 指定されたプロジェクトの課題を最大100件取得する。
    /// 更新日時の降順でソートされる。
    ///
    /// # 引数
    /// * `project_id_or_key` - プロジェクトIDまたはプロジェクトキー
    ///
    /// # 戻り値
    /// 課題のベクタ、またはエラー
    /// プロジェクト情報を取得
    ///
    /// プロジェクトキーまたはIDからプロジェクト情報を取得する。
    /// プロジェクトキーを使用する場合、このメソッドでIDを取得できる。
    ///
    /// # 引数
    /// * `project_id_or_key` - プロジェクトIDまたはプロジェクトキー
    ///
    /// # 戻り値
    /// プロジェクトID、またはエラー
    /// プロジェクトキーからプロジェクトIDを取得
    /// プロジェクトキーからプロジェクトIDを取得
    async fn get_project_id(
        &self,
        project_id_or_key: &str,
    ) -> Result<i64, Box<dyn Error + Send + Sync>> {
        // すでに数値の場合はそのまま返す
        if let Ok(id) = project_id_or_key.parse::<i64>() {
            return Ok(id);
        }

        // プロジェクト情報を取得してIDを特定
        let url = format!("{}/projects/{}", self.base_url, project_id_or_key);
        let response = self
            .client
            .get(&url)
            .query(&[("apiKey", &self.api_key)])
            .send()
            .await
            .map_err(|e| -> Box<dyn Error + Send + Sync> {
                format!("Request failed: {e}").into()
            })?;

        if !response.status().is_success() {
            return Err(format!(
                "Failed to get project info for {}: {}",
                project_id_or_key,
                response.status()
            )
            .into());
        }

        let project =
            response
                .json::<Project>()
                .await
                .map_err(|e| -> Box<dyn Error + Send + Sync> {
                    format!("JSON parse failed: {e}").into()
                })?;
        Ok(project.id)
    }

    /// プロジェクトの課題一覧を取得
    pub async fn get_issues(
        &self,
        project_id_or_key: &str,
        status_ids: &[i64],
    ) -> Result<(Vec<Issue>, crate::rate_limit::RateLimitInfo), Box<dyn Error + Send + Sync>> {
        // プロジェクトキーからIDを取得
        let project_id = self.get_project_id(project_id_or_key).await?;

        let url = format!("{}/issues", self.base_url);
        let mut query = vec![
            ("apiKey", self.api_key.clone()),
            ("projectId[]", project_id.to_string()),
            ("count", "100".to_string()),
            ("sort", "updated".to_string()),
        ];

        // ステータスIDを追加
        for status_id in status_ids {
            query.push(("statusId[]", status_id.to_string()));
        }

        let response = self.client.get(&url).query(&query).send().await.map_err(
            |e| -> Box<dyn Error + Send + Sync> { format!("Request failed: {e}").into() },
        )?;

        // レスポンスステータスの確認
        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(format!("API request failed: {status} - {body}").into());
        }

        // ヘッダーからレートリミット情報を取得
        let rate_limit = crate::rate_limit::RateLimitInfo::from_headers(response.headers());

        let issues =
            response
                .json::<Vec<Issue>>()
                .await
                .map_err(|e| -> Box<dyn Error + Send + Sync> {
                    format!("JSON parse failed: {e}").into()
                })?;
        Ok((issues, rate_limit))
    }

    /// コメント取得（`GET /issues/:id/comments`）のクエリパラメータを組み立てる（v0.4 / FR-V04-002）
    ///
    /// 差分取得のため `minId`（指定時のみ）・`order=asc`・`count=100` を付与する。
    /// ネットワークに依存しない純粋関数なので、組み立て結果を単体テストで検証できる。
    ///
    /// # 引数
    /// * `api_key` - Backlog APIキー
    /// * `min_id` - これより大きい ID のコメントのみ取得（`None` で全件先頭から）
    ///
    /// # 戻り値
    /// `(キー, 値)` のクエリパラメータ列
    fn build_comments_query(api_key: &str, min_id: Option<i64>) -> Vec<(&'static str, String)> {
        // order=asc・count=100 を固定し、差分取得の起点 minId は指定時のみ付与する。
        let mut query = vec![
            ("apiKey", api_key.to_string()),
            ("order", "asc".to_string()),
            ("count", "100".to_string()),
        ];
        if let Some(min_id) = min_id {
            query.push(("minId", min_id.to_string()));
        }
        query
    }

    /// 完了課題取得（`GET /issues`）のクエリパラメータを組み立てる（v0.4 / FR-V04-003）
    ///
    /// `statusId[]=4`（完了）固定・`updatedSince`（指定時のみ）・`count=100` に
    /// ページング用 `offset` を付与する。ネットワークに依存しない純粋関数。
    ///
    /// # 引数
    /// * `api_key` - Backlog APIキー
    /// * `project_id` - 対象プロジェクトID（数値）
    /// * `updated_since` - この日付（`yyyy-MM-dd`）以降に更新された課題のみ（`None` で無制限）
    /// * `offset` - ページング開始位置
    ///
    /// # 戻り値
    /// `(キー, 値)` のクエリパラメータ列
    fn build_closed_issues_query(
        api_key: &str,
        project_id: i64,
        updated_since: Option<&str>,
        offset: i64,
    ) -> Vec<(&'static str, String)> {
        // statusId[]=4 は Backlog の「完了」ステータス。コーパスは完了課題のみが対象（FR-V04-003）。
        let mut query = vec![
            ("apiKey", api_key.to_string()),
            ("projectId[]", project_id.to_string()),
            ("statusId[]", "4".to_string()),
            ("count", "100".to_string()),
            ("offset", offset.to_string()),
            ("sort", "updated".to_string()),
            // order を明示し、offset ページング中の並び順を安定させる（Backlog 既定への暗黙依存を避ける）。
            ("order", "desc".to_string()),
        ];
        if let Some(updated_since) = updated_since {
            query.push(("updatedSince", updated_since.to_string()));
        }
        query
    }

    /// 課題のコメント差分を取得（v0.4 / FR-V04-002）
    ///
    /// `GET /issues/:id/comments` を `minId`・`order=asc`・`count=100` で呼び、
    /// `min_id` より大きい ID の新規コメントだけを昇順で取得する。
    /// 取得した最大コメント ID を次回 `minId` の起点にする運用を想定する。
    /// レート情報はレスポンスヘッダから [`crate::rate_limit::RateLimitInfo`] へ取り込む。
    ///
    /// # 引数
    /// * `issue_id_or_key` - 課題IDまたは課題キー（例: 12345 / "PROJ-123"）
    /// * `min_id` - これより大きい ID のコメントのみ取得（`None` で全件先頭から）
    ///
    /// # 戻り値
    /// `(コメント列, レート情報)`、またはエラー
    #[allow(dead_code)]
    pub async fn get_comments(
        &self,
        issue_id_or_key: &str,
        min_id: Option<i64>,
    ) -> Result<
        (Vec<crate::db::Comment>, crate::rate_limit::RateLimitInfo),
        Box<dyn Error + Send + Sync>,
    > {
        let url = format!("{}/issues/{}/comments", self.base_url, issue_id_or_key);
        let query = Self::build_comments_query(&self.api_key, min_id);

        let response = self.client.get(&url).query(&query).send().await.map_err(
            |e| -> Box<dyn Error + Send + Sync> { format!("Request failed: {e}").into() },
        )?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(format!("API request failed: {status} - {body}").into());
        }

        let rate_limit = crate::rate_limit::RateLimitInfo::from_headers(response.headers());

        let comments = response.json::<Vec<crate::db::Comment>>().await.map_err(
            |e| -> Box<dyn Error + Send + Sync> { format!("JSON parse failed: {e}").into() },
        )?;
        Ok((comments, rate_limit))
    }

    /// 完了課題を期間指定・ページングで取得（v0.4 / FR-V04-003）
    ///
    /// `GET /issues` を `statusId[]=4`（完了）+ `updatedSince` + `count=100` + `offset` で呼び、
    /// 類似検索のコーパスにする完了課題を取得する。1回の呼び出しで最大100件返るため、
    /// 呼び出し側が `offset` を 100 ずつ進めて全件をページングする運用を想定する。
    /// 返した [`Issue`] には `is_corpus_only = true` を立てているので、そのまま
    /// `save_issues` へ渡せばコーパス専用として保存される。
    ///
    /// # 引数
    /// * `project_id_or_key` - プロジェクトIDまたはプロジェクトキー
    /// * `updated_since` - この日付（`yyyy-MM-dd`）以降に更新された課題のみ（`None` で無制限）
    /// * `offset` - ページング開始位置（0 起点）
    ///
    /// # 戻り値
    /// `(完了課題列, レート情報)`、またはエラー
    #[allow(dead_code)]
    pub async fn get_closed_issues(
        &self,
        project_id_or_key: &str,
        updated_since: Option<&str>,
        offset: i64,
    ) -> Result<(Vec<Issue>, crate::rate_limit::RateLimitInfo), Box<dyn Error + Send + Sync>> {
        let project_id = self.get_project_id(project_id_or_key).await?;

        let url = format!("{}/issues", self.base_url);
        let query =
            Self::build_closed_issues_query(&self.api_key, project_id, updated_since, offset);

        let response = self.client.get(&url).query(&query).send().await.map_err(
            |e| -> Box<dyn Error + Send + Sync> { format!("Request failed: {e}").into() },
        )?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(format!("API request failed: {status} - {body}").into());
        }

        let rate_limit = crate::rate_limit::RateLimitInfo::from_headers(response.headers());

        let mut issues =
            response
                .json::<Vec<Issue>>()
                .await
                .map_err(|e| -> Box<dyn Error + Send + Sync> {
                    format!("JSON parse failed: {e}").into()
                })?;
        // コーパス専用として取り込む（一覧・ダッシュボードから除外する。FR-V04-003）。
        for issue in &mut issues {
            issue.is_corpus_only = true;
        }
        Ok((issues, rate_limit))
    }

    /// 自分のユーザー情報を取得
    pub async fn get_myself(&self) -> Result<User, Box<dyn Error + Send + Sync>> {
        let url = format!("{}/users/myself", self.base_url);
        let response = self
            .client
            .get(&url)
            .query(&[("apiKey", &self.api_key)])
            .send()
            .await
            .map_err(|e| -> Box<dyn Error + Send + Sync> {
                format!("Request failed: {e}").into()
            })?;

        if !response.status().is_success() {
            return Err(format!("Failed to get myself: {}", response.status()).into());
        }

        let user = response
            .json::<User>()
            .await
            .map_err(|e| -> Box<dyn Error + Send + Sync> {
                format!("JSON parse failed: {e}").into()
            })?;
        Ok(user)
    }

    /// プロジェクト一覧を取得
    pub async fn get_projects(&self) -> Result<Vec<Project>, Box<dyn Error + Send + Sync>> {
        let url = format!("{}/projects", self.base_url);
        let response = self
            .client
            .get(&url)
            .query(&[("apiKey", &self.api_key)])
            .send()
            .await
            .map_err(|e| -> Box<dyn Error + Send + Sync> {
                format!("Request failed: {e}").into()
            })?;

        if !response.status().is_success() {
            return Err(format!("Failed to get projects: {}", response.status()).into());
        }

        let projects =
            response
                .json::<Vec<Project>>()
                .await
                .map_err(|e| -> Box<dyn Error + Send + Sync> {
                    format!("JSON parse failed: {e}").into()
                })?;
        Ok(projects)
    }
}

/// プロジェクト情報
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    /// プロジェクトID
    pub id: i64,
    /// プロジェクトキー (例: PROJ)
    #[serde(rename = "projectKey")]
    pub project_key: String,
    /// プロジェクト名
    pub name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `(キー, 値)` のクエリ列に指定キーが指定値で含まれるかを判定するヘルパー。
    fn has_param(query: &[(&str, String)], key: &str, value: &str) -> bool {
        query.iter().any(|(k, v)| *k == key && v == value)
    }

    /// 指定キーがクエリ列に1つも含まれないかを判定するヘルパー。
    fn lacks_key(query: &[(&str, String)], key: &str) -> bool {
        !query.iter().any(|(k, _)| *k == key)
    }

    #[test]
    fn build_comments_query_includes_order_and_count() {
        // minId なし: order=asc・count=100 が付き、minId は含まれない。
        let query = BacklogClient::build_comments_query("KEY", None);
        assert!(has_param(&query, "apiKey", "KEY"));
        assert!(has_param(&query, "order", "asc"));
        assert!(has_param(&query, "count", "100"));
        assert!(lacks_key(&query, "minId"));
    }

    #[test]
    fn build_comments_query_appends_min_id_when_present() {
        // minId あり: 指定値が付与される（差分取得の起点）。
        let query = BacklogClient::build_comments_query("KEY", Some(42));
        assert!(has_param(&query, "minId", "42"));
        assert!(has_param(&query, "order", "asc"));
        assert!(has_param(&query, "count", "100"));
    }

    #[test]
    fn build_closed_issues_query_uses_status_4_and_count_offset() {
        // updatedSince なし: statusId[]=4・count=100・offset が付き、updatedSince は含まれない。
        let query = BacklogClient::build_closed_issues_query("KEY", 1234, None, 0);
        assert!(has_param(&query, "apiKey", "KEY"));
        assert!(has_param(&query, "projectId[]", "1234"));
        assert!(has_param(&query, "statusId[]", "4"));
        assert!(has_param(&query, "count", "100"));
        assert!(has_param(&query, "offset", "0"));
        // order=desc を明示してページングの並び順を安定させる。
        assert!(has_param(&query, "order", "desc"));
        assert!(lacks_key(&query, "updatedSince"));
    }

    #[test]
    fn build_closed_issues_query_appends_updated_since_and_offset() {
        // updatedSince あり + offset 進行: 期間指定・ページングが反映される。
        let query = BacklogClient::build_closed_issues_query("KEY", 1234, Some("2026-01-01"), 100);
        assert!(has_param(&query, "updatedSince", "2026-01-01"));
        assert!(has_param(&query, "offset", "100"));
        assert!(has_param(&query, "statusId[]", "4"));
    }

    #[test]
    fn comment_deserializes_backlog_created_and_user() {
        // Backlog API 形式（created / createdUser）が created_at / created_user に取り込まれる。
        let json = r#"{
            "id": 7,
            "content": "本文",
            "created": "2026-06-01T00:00:00Z",
            "createdUser": { "id": 9, "name": "alice" }
        }"#;
        let comment: crate::db::Comment = serde_json::from_str(json).unwrap();
        assert_eq!(comment.comment_id, 7);
        assert_eq!(comment.content.as_deref(), Some("本文"));
        assert_eq!(comment.created_at.as_deref(), Some("2026-06-01T00:00:00Z"));
        assert_eq!(
            comment.created_user.map(|u| u.name).as_deref(),
            Some("alice")
        );
    }

    #[test]
    fn closed_issue_deserializes_without_corpus_flag() {
        // API レスポンスに is_corpus_only は無く、デフォルト（false）になる。
        let json = r#"{
            "id": 1,
            "issueKey": "PROJ-1",
            "summary": "完了課題",
            "status": { "id": 4, "name": "完了" }
        }"#;
        let issue: Issue = serde_json::from_str(json).unwrap();
        assert!(!issue.is_corpus_only);
    }
}
