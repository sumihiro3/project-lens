use serde::{Deserialize, Serialize};
use std::error::Error;

#[derive(Debug, Clone)]
pub struct BacklogClient {
    api_key: String,
    base_url: String,
    client: reqwest::Client,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Issue {
    pub id: i64,
    #[serde(rename = "issueKey")]
    pub issue_key: String,
    pub summary: String,
    pub description: Option<String>,
    pub priority: Option<Priority>,
    pub status: Option<Status>,
    pub assignee: Option<User>,
    #[serde(rename = "dueDate")]
    pub due_date: Option<String>,
    pub updated: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Priority {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Status {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct User {
    pub id: i64,
    pub name: String,
}

impl BacklogClient {
    pub fn new(domain: &str, api_key: &str) -> Self {
        let base_url = format!("https://{}/api/v2", domain);
        Self {
            api_key: api_key.to_string(),
            base_url,
            client: reqwest::Client::new(),
        }
    }

    pub async fn get_issues(&self, project_id_or_key: &str) -> Result<Vec<Issue>, Box<dyn Error>> {
        let url = format!("{}/issues", self.base_url);
        let response = self.client
            .get(&url)
            .query(&[
                ("apiKey", &self.api_key),
                ("projectId[]", &project_id_or_key.to_string()),
                ("count", &"100".to_string()),
            ])
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(format!("API request failed: {}", response.status()).into());
        }

        let issues = response.json::<Vec<Issue>>().await?;
        Ok(issues)
    }
}
