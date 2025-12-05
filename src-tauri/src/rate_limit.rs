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

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderMap, HeaderName, HeaderValue};

    /// empty()メソッドがすべてのフィールドをNoneで初期化することを確認
    #[test]
    fn test_empty_creates_all_none() {
        let info = RateLimitInfo::empty();
        
        assert!(info.limit.is_none(), "limit should be None");
        assert!(info.remaining.is_none(), "remaining should be None");
        assert!(info.reset.is_none(), "reset should be None");
    }

    /// すべてのレートリミットヘッダーが存在する場合、正しく情報を抽出できることを確認
    #[test]
    fn test_from_headers_with_all_fields() {
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("x-ratelimit-limit"),
            HeaderValue::from_static("5000"),
        );
        headers.insert(
            HeaderName::from_static("x-ratelimit-remaining"),
            HeaderValue::from_static("4999"),
        );
        headers.insert(
            HeaderName::from_static("x-ratelimit-reset"),
            HeaderValue::from_static("1609459200"),
        );

        let info = RateLimitInfo::from_headers(&headers);

        assert_eq!(info.limit, Some(5000), "limit should be 5000");
        assert_eq!(info.remaining, Some(4999), "remaining should be 4999");
        assert_eq!(info.reset, Some("1609459200".to_string()), "reset should be 1609459200");
    }

    /// 一部のヘッダーのみ存在する場合、存在するものだけ抽出し、残りはNoneになることを確認
    #[test]
    fn test_from_headers_with_missing_fields() {
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("x-ratelimit-limit"),
            HeaderValue::from_static("5000"),
        );
        // remainingとresetは含めない

        let info = RateLimitInfo::from_headers(&headers);

        assert_eq!(info.limit, Some(5000), "limit should be present");
        assert!(info.remaining.is_none(), "remaining should be None");
        assert!(info.reset.is_none(), "reset should be None");
    }

    /// ヘッダーが空の場合、すべてのフィールドがNoneになることを確認
    #[test]
    fn test_from_headers_empty() {
        let headers = HeaderMap::new();
        let info = RateLimitInfo::from_headers(&headers);

        assert!(info.limit.is_none(), "limit should be None");
        assert!(info.remaining.is_none(), "remaining should be None");
        assert!(info.reset.is_none(), "reset should be None");
    }

    /// limitヘッダーの値が無効な場合、Noneになることを確認
    #[test]
    fn test_from_headers_invalid_limit_value() {
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("x-ratelimit-limit"),
            HeaderValue::from_static("invalid"),
        );

        let info = RateLimitInfo::from_headers(&headers);

        assert!(info.limit.is_none(), "invalid limit should result in None");
    }

    /// remainingヘッダーの値が無効な場合、Noneになることを確認
    #[test]
    fn test_from_headers_invalid_remaining_value() {
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("x-ratelimit-remaining"),
            HeaderValue::from_static("not-a-number"),
        );

        let info = RateLimitInfo::from_headers(&headers);

        assert!(info.remaining.is_none(), "invalid remaining should result in None");
    }

    /// remainingが0の場合も正しく処理されることを確認
    #[test]
    fn test_from_headers_zero_remaining() {
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("x-ratelimit-limit"),
            HeaderValue::from_static("5000"),
        );
        headers.insert(
            HeaderName::from_static("x-ratelimit-remaining"),
            HeaderValue::from_static("0"),
        );

        let info = RateLimitInfo::from_headers(&headers);

        assert_eq!(info.limit, Some(5000));
        assert_eq!(info.remaining, Some(0), "0 remaining is valid");
    }

    /// 負の数値もパースされることを確認（APIの仕様による）
    #[test]
    fn test_from_headers_negative_values_rejected() {
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("x-ratelimit-remaining"),
            HeaderValue::from_static("-1"),
        );

        let info = RateLimitInfo::from_headers(&headers);

        // -1は有効なi64なので、パースされる（仕様による）
        assert_eq!(info.remaining, Some(-1));
    }

    /// ヘッダー名の大文字小文字が正しく処理されることを確認
    #[test]
    fn test_from_headers_case_sensitivity() {
        // HeaderMapは通常case-insensitiveだが、HeaderNameの定義によって動作が変わる
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("x-ratelimit-limit"),
            HeaderValue::from_static("5000"),
        );

        let info = RateLimitInfo::from_headers(&headers);

        assert_eq!(info.limit, Some(5000), "should handle lowercase header names");
    }

    /// reset値が文字列として正しく保持されることを確認
    #[test]
    fn test_reset_string_preservation() {
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("x-ratelimit-reset"),
            HeaderValue::from_static("2024-12-31T23:59:59Z"),
        );

        let info = RateLimitInfo::from_headers(&headers);

        assert_eq!(
            info.reset,
            Some("2024-12-31T23:59:59Z".to_string()),
            "reset should preserve the string value"
        );
    }
}
