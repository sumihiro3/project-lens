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
    /// 関連度スコア（デシリアライズ時はスキップ、後で計算して設定）
    #[serde(skip_deserializing, default)]
    pub relevance_score: i32,
    /// ワークスペースID（DB保存時に設定）
    #[serde(skip_deserializing, default)]
    pub workspace_id: i64,
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
        let base_url = format!("https://{}/api/v2", domain);
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
    async fn get_project_id(&self, project_id_or_key: &str) -> Result<i64, Box<dyn Error + Send + Sync>> {
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
            .map_err(|e| -> Box<dyn Error + Send + Sync> { format!("Request failed: {}", e).into() })?;

        if !response.status().is_success() {
            return Err(format!(
                "Failed to get project info for {}: {}",
                project_id_or_key,
                response.status()
            )
            .into());
        }

        let project = response.json::<Project>().await.map_err(|e| -> Box<dyn Error + Send + Sync> { format!("JSON parse failed: {}", e).into() })?;
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

        let response = self.client.get(&url).query(&query).send().await.map_err(|e| -> Box<dyn Error + Send + Sync> { format!("Request failed: {}", e).into() })?;

        // レスポンスステータスの確認
        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(format!("API request failed: {} - {}", status, body).into());
        }

        // ヘッダーからレートリミット情報を取得
        let rate_limit = crate::rate_limit::RateLimitInfo::from_headers(response.headers());

        let issues = response.json::<Vec<Issue>>().await.map_err(|e| -> Box<dyn Error + Send + Sync> { format!("JSON parse failed: {}", e).into() })?;
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
            .map_err(|e| -> Box<dyn Error + Send + Sync> { format!("Request failed: {}", e).into() })?;

        if !response.status().is_success() {
            return Err(format!("Failed to get myself: {}", response.status()).into());
        }

        let user = response.json::<User>().await.map_err(|e| -> Box<dyn Error + Send + Sync> { format!("JSON parse failed: {}", e).into() })?;
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
            .map_err(|e| -> Box<dyn Error + Send + Sync> { format!("Request failed: {}", e).into() })?;

        if !response.status().is_success() {
            return Err(format!("Failed to get projects: {}", response.status()).into());
        }

        let projects = response.json::<Vec<Project>>().await.map_err(|e| -> Box<dyn Error + Send + Sync> { format!("JSON parse failed: {}", e).into() })?;
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

    /// BacklogClientの初期化が正しく行われることを確認
    #[test]
    fn test_backlog_client_new() {
        let client = BacklogClient::new("example.backlog.com", "test-api-key");
        
        assert_eq!(client.base_url, "https://example.backlog.com/api/v2");
        assert_eq!(client.api_key, "test-api-key");
    }

    /// User構造体のJSONデシリアライズが正しく動作することを確認
    #[test]
    fn test_user_deserialization() {
        let json = r#"{"id": 123, "name": "Test User"}"#;
        let user: User = serde_json::from_str(json).unwrap();
        
        assert_eq!(user.id, 123);
        assert_eq!(user.name, "Test User");
    }

    /// Priority構造体のJSONデシリアライズが正しく動作することを確認
    #[test]
    fn test_priority_deserialization() {
        let json = r#"{"id": 2, "name": "高"}"#;
        let priority: Priority = serde_json::from_str(json).unwrap();
        
        assert_eq!(priority.id, 2);
        assert_eq!(priority.name, "高");
    }

    /// Status構造体のJSONデシリアライズが正しく動作することを確認
    #[test]
    fn test_status_deserialization() {
        let json = r#"{"id": 1, "name": "未対応"}"#;
        let status: Status = serde_json::from_str(json).unwrap();
        
        assert_eq!(status.id, 1);
        assert_eq!(status.name, "未対応");
    }

    /// IssueType構造体のJSONデシリアライズが正しく動作することを確認
    #[test]
    fn test_issue_type_deserialization() {
        let json = r#"{"id": 3, "name": "バグ"}"#;
        let issue_type: IssueType = serde_json::from_str(json).unwrap();
        
        assert_eq!(issue_type.id, 3);
        assert_eq!(issue_type.name, "バグ");
    }

    /// 最小限のフィールドのみを持つIssueのデシリアライズが正しく動作することを確認
    #[test]
    fn test_issue_deserialization_minimal() {
        let json = r#"{
            "id": 456,
            "issueKey": "PROJ-123",
            "summary": "Test Issue"
        }"#;
        let issue: Issue = serde_json::from_str(json).unwrap();
        
        assert_eq!(issue.id, 456);
        assert_eq!(issue.issue_key, "PROJ-123");
        assert_eq!(issue.summary, "Test Issue");
        assert!(issue.description.is_none());
        assert!(issue.priority.is_none());
        assert!(issue.status.is_none());
        assert!(issue.issue_type.is_none());
        assert!(issue.assignee.is_none());
    }

    /// すべてのフィールドを持つIssueのデシリアライズが正しく動作することを確認
    #[test]
    fn test_issue_deserialization_full() {
        let json = r#"{
            "id": 789,
            "issueKey": "PROJ-456",
            "summary": "Full Test Issue",
            "description": "This is a test issue",
            "priority": {"id": 3, "name": "高"},
            "status": {"id": 2, "name": "処理中"},
            "issueType": {"id": 1, "name": "タスク"},
            "assignee": {"id": 100, "name": "山田太郎"},
            "dueDate": "2024-12-31",
            "updated": "2024-12-05T10:00:00Z"
        }"#;
        let issue: Issue = serde_json::from_str(json).unwrap();
        
        assert_eq!(issue.id, 789);
        assert_eq!(issue.issue_key, "PROJ-456");
        assert_eq!(issue.summary, "Full Test Issue");
        assert_eq!(issue.description, Some("This is a test issue".to_string()));
        
        let priority = issue.priority.unwrap();
        assert_eq!(priority.id, 3);
        assert_eq!(priority.name, "高");
        
        let status = issue.status.unwrap();
        assert_eq!(status.id, 2);
        assert_eq!(status.name, "処理中");
        
        let issue_type = issue.issue_type.unwrap();
        assert_eq!(issue_type.id, 1);
        assert_eq!(issue_type.name, "タスク");
        
        let assignee = issue.assignee.unwrap();
        assert_eq!(assignee.id, 100);
        assert_eq!(assignee.name, "山田太郎");
        
        assert_eq!(issue.due_date, Some("2024-12-31".to_string()));
        assert_eq!(issue.updated, Some("2024-12-05T10:00:00Z".to_string()));
    }

    /// Project構造体のJSONデシリアライズが正しく動作することを確認
    #[test]
    fn test_project_deserialization() {
        let json = r#"{
            "id": 999,
            "projectKey": "TESTPROJ",
            "name": "Test Project"
        }"#;
        let project: Project = serde_json::from_str(json).unwrap();
        
        assert_eq!(project.id, 999);
        assert_eq!(project.project_key, "TESTPROJ");
        assert_eq!(project.name, "Test Project");
    }

    /// Issueのrelevance_scoreフィールドがデフォルト値（0）になることを確認
    #[test]
    fn test_issue_relevance_score_default() {
        let json = r#"{
            "id": 1,
            "issueKey": "TEST-1",
            "summary": "Test"
        }"#;
        let issue: Issue = serde_json::from_str(json).unwrap();
        
        // デシリアライズ時はスコアはデフォルト値（0）
        assert_eq!(issue.relevance_score, 0);
    }

    /// Issueのworkspace_idフィールドがデフォルト値（0）になることを確認
    #[test]
    fn test_issue_workspace_id_default() {
        let json = r#"{
            "id": 1,
            "issueKey": "TEST-1",
            "summary": "Test"
        }"#;
        let issue: Issue = serde_json::from_str(json).unwrap();
        
        // デシリアライズ時はworkspace_idはデフォルト値（0）
        assert_eq!(issue.workspace_id, 0);
    }
}
