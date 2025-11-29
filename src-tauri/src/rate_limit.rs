use serde::{Deserialize, Serialize};

/// API使用状況情報
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitInfo {
    pub limit: Option<i64>,
    pub remaining: Option<i64>,
    pub reset: Option<String>,
}

impl RateLimitInfo {
    pub fn empty() -> Self {
        Self {
            limit: None,
            remaining: None,
            reset: None,
        }
    }

    pub fn from_headers(headers: &reqwest::header::HeaderMap) -> Self {
        let limit = headers
            .get("X-RateLimit-Limit")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<i64>().ok());

        let remaining = headers
            .get("X-RateLimit-Remaining")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<i64>().ok());

        let reset = headers
            .get("X-RateLimit-Reset")
            .and_then(|v| v.to_str().ok())
            .map(|v| v.to_string());

        Self {
            limit,
            remaining,
            reset,
        }
    }
}
