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
#[derive(Debug, Serialize, Deserialize)]
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
}

/// 優先度
#[derive(Debug, Serialize, Deserialize)]
pub struct Priority {
    pub id: i64,
    pub name: String,
}

/// ステータス
#[derive(Debug, Serialize, Deserialize)]
pub struct Status {
    pub id: i64,
    pub name: String,
}

/// ユーザー
#[derive(Debug, Serialize, Deserialize)]
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
    async fn get_project_id(&self, project_id_or_key: &str) -> Result<i64, Box<dyn Error>> {
        let url = format!("{}/projects/{}", self.base_url, project_id_or_key);
        let response = self.client
            .get(&url)
            .query(&[("apiKey", &self.api_key)])
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(format!("Failed to get project: {} - {}", status, body).into());
        }

        #[derive(Deserialize)]
        struct Project {
            id: i64,
        }

        let project = response.json::<Project>().await?;
        Ok(project.id)
    }

    /// プロジェクトの課題一覧を取得
    /// 
    /// 指定されたプロジェクトの課題を最大100件取得する。
    /// 更新日時の降順でソートされる。
    /// 
    /// # 引数
    /// * `project_id_or_key` - プロジェクトIDまたはプロジェクトキー
    /// * `status_ids` - 取得対象のステータスIDのリスト（空の場合はすべて取得）
    /// 
    /// # 戻り値
    /// 課題のベクタ、またはエラー
    pub async fn get_issues(&self, project_id_or_key: &str, status_ids: &[i64]) -> Result<Vec<Issue>, Box<dyn Error>> {
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

        let response = self.client
            .get(&url)
            .query(&query)
            .send()
            .await?;

        // レスポンスステータスの確認
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(format!("API request failed: {} - {}", status, body).into());
        }

        let issues = response.json::<Vec<Issue>>().await?;
        Ok(issues)
    }

    /// 自分のユーザー情報を取得
    /// 
    /// APIキーに紐づくユーザーの情報を取得する。
    /// スコアリング時に「自分が担当者」かどうかを判定するために使用。
    /// 
    /// # 戻り値
    /// ユーザー情報、またはエラー
    pub async fn get_myself(&self) -> Result<User, Box<dyn Error>> {
        let url = format!("{}/users/myself", self.base_url);
        let response = self.client
            .get(&url)
            .query(&[("apiKey", &self.api_key)])
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(format!("API request failed: {}", response.status()).into());
        }

        let user = response.json::<User>().await?;
        Ok(user)
    }

    /// ユーザーがアクセス可能なプロジェクト一覧を取得
    /// 
    /// APIキーに紐づくユーザーがアクセスできるプロジェクトの一覧を取得する。
    /// 設定画面でプロジェクトを選択する際に使用。
    /// 
    /// # 戻り値
    /// プロジェクト情報のベクタ、またはエラー
    pub async fn get_projects(&self) -> Result<Vec<Project>, Box<dyn Error>> {
        let url = format!("{}/projects", self.base_url);
        let response = self.client
            .get(&url)
            .query(&[("apiKey", &self.api_key)])
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(format!("API request failed: {}", response.status()).into());
        }

        let projects = response.json::<Vec<Project>>().await?;
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
