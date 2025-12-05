use crate::backlog::{Issue, User};
use chrono::{DateTime, Local, NaiveDate, Utc};

/// スコアリングサービス
///
/// 課題の関連度スコアを計算するサービス。
/// 担当者、期限、更新日時、メンションなどの要素から総合的にスコアを算出する。
pub struct ScoringService;

impl ScoringService {
    /// 課題の関連度スコアを計算
    ///
    /// 以下の基準でスコアを加算する：
    /// - 自分が担当者: +50点
    /// - 期限切れ: +100点
    /// - 期限まで7日以内: +50点
    /// - 3日以内に更新: +50点
    /// - 説明文に自分の名前が含まれる: +30点
    ///
    /// # 引数
    /// * `issue` - スコアを計算する課題
    /// * `me` - 現在のユーザー情報
    ///
    /// # 戻り値
    /// 計算された関連度スコア（0以上の整数）
    pub fn calculate_score(issue: &Issue, me: &User) -> i32 {
        let mut score = 0;

        // 1. 担当者が自分かどうかをチェック
        if let Some(assignee) = &issue.assignee {
            if assignee.id == me.id {
                // 基本スコア: 自分が担当者
                score += 50;

                // 期限日のチェック
                if let Some(due_date_str) = &issue.due_date {
                    // 日付フォーマットのパース（複数形式に対応）
                    if let Ok(due_date) =
                        NaiveDate::parse_from_str(due_date_str, "%Y-%m-%dT%H:%M:%SZ")
                            .or_else(|_| NaiveDate::parse_from_str(due_date_str, "%Y-%m-%d"))
                    {
                        let today = Local::now().date_naive();
                        let diff = (due_date - today).num_days();

                        if diff < 0 {
                            // 期限切れ → 最優先
                            score += 100;
                        } else if diff <= 7 {
                            // 期限まで7日以内 → 優先度高
                            score += 50;
                        }
                    }
                }

                // 最近更新されたかどうかをチェック（3日以内）
                if let Some(updated_str) = &issue.updated {
                    if let Ok(updated) = DateTime::parse_from_rfc3339(updated_str) {
                        let updated_utc = updated.with_timezone(&Utc);
                        let now_utc = Utc::now();
                        if (now_utc - updated_utc).num_days() <= 3 {
                            // 最近更新された → 優先度高
                            score += 50;
                        }
                    }
                }
            }
        }

        // 2. メンションのチェック（簡易版）
        // 注: 本来はコメントや通知APIを使用すべきだが、ここでは説明文に名前が含まれるかで判定
        if let Some(desc) = &issue.description {
            if desc.contains(&me.name) {
                // 自分の名前が含まれる → 重要
                score += 30;
            }
        }

        score
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, Utc};

    // テスト用のUserを作成するヘルパー関数
    fn create_test_user(id: i64, name: &str) -> User {
        User {
            id,
            name: name.to_string(),
        }
    }

    // テスト用のIssueを作成するヘルパー関数
    fn create_test_issue() -> Issue {
        Issue {
            id: 1,
            issue_key: "TEST-1".to_string(),
            summary: "テスト課題".to_string(),
            description: None,
            priority: Some(crate::backlog::Priority {
                id: 2,
                name: "中".to_string(),
            }),
            status: Some(crate::backlog::Status {
                id: 1,
                name: "未対応".to_string(),
            }),
            issue_type: Some(crate::backlog::IssueType {
                id: 1,
                name: "タスク".to_string(),
            }),
            assignee: None,
            due_date: None,
            updated: None,
            relevance_score: 0,
            workspace_id: 1,
        }
    }

    /// 担当者が設定されていない課題のスコアは0になることを確認
    #[test]
    fn test_no_assignee_returns_zero_score() {
        let me = create_test_user(1, "テストユーザー");
        let issue = create_test_issue();
        
        let score = ScoringService::calculate_score(&issue, &me);
        assert_eq!(score, 0, "担当者がいない場合はスコア0");
    }

    /// 自分が担当者に設定されている課題は基本スコア50点を獲得することを確認
    #[test]
    fn test_assigned_to_me_returns_base_score() {
        let me = create_test_user(1, "テストユーザー");
        let mut issue = create_test_issue();
        issue.assignee = Some(create_test_user(1, "テストユーザー"));
        
        let score = ScoringService::calculate_score(&issue, &me);
        assert_eq!(score, 50, "自分が担当者の場合は基本スコア50点");
    }

    /// 他のユーザーが担当者の課題はスコア0になることを確認
    #[test]
    fn test_assigned_to_other_returns_zero_score() {
        let me = create_test_user(1, "テストユーザー");
        let mut issue = create_test_issue();
        issue.assignee = Some(create_test_user(2, "他のユーザー"));
        
        let score = ScoringService::calculate_score(&issue, &me);
        assert_eq!(score, 0, "他のユーザーが担当者の場合はスコア0");
    }

    /// 期限切れの課題は基本スコア+100点のボーナスを獲得することを確認
    #[test]
    fn test_overdue_task_adds_100_points() {
        let me = create_test_user(1, "テストユーザー");
        let mut issue = create_test_issue();
        issue.assignee = Some(create_test_user(1, "テストユーザー"));
        
        // 10日前の日付を設定
        let overdue_date = (Local::now() - Duration::days(10)).format("%Y-%m-%d").to_string();
        issue.due_date = Some(overdue_date);
        
        let score = ScoringService::calculate_score(&issue, &me);
        assert_eq!(score, 150, "期限切れの場合は50(基本) + 100(期限切れ) = 150点");
    }

    /// 期限まで7日以内の課題は基本スコア+50点のボーナスを獲得することを確認
    #[test]
    fn test_due_within_7_days_adds_50_points() {
        let me = create_test_user(1, "テストユーザー");
        let mut issue = create_test_issue();
        issue.assignee = Some(create_test_user(1, "テストユーザー"));
        
        // 5日後の日付を設定
        let due_date = (Local::now() + Duration::days(5)).format("%Y-%m-%d").to_string();
        issue.due_date = Some(due_date);
        
        let score = ScoringService::calculate_score(&issue, &me);
        assert_eq!(score, 100, "期限まで7日以内の場合は50(基本) + 50(期限近い) = 100点");
    }


    /// 期限までちょうど7日の場合も+50点のボーナスが得られることを確認
    #[test]
    fn test_due_date_exactly_7_days_adds_50_points() {
        let me = create_test_user(1, "テストユーザー");
        let mut issue = create_test_issue();
        issue.assignee = Some(create_test_user(1, "テストユーザー"));
        
        // ちょうど7日後の日付を設定
        let due_date = (Local::now() + Duration::days(7)).format("%Y-%m-%d").to_string();
        issue.due_date = Some(due_date);
        
        let score = ScoringService::calculate_score(&issue, &me);
        assert_eq!(score, 100, "期限まで7日の場合は50(基本) + 50(期限近い) = 100点");
    }

    /// 期限まで8日以上ある課題は期限ボーナスが付かないことを確認
    #[test]
    fn test_due_date_beyond_7_days_no_bonus() {
        let me = create_test_user(1, "テストユーザー");
        let mut issue = create_test_issue();
        issue.assignee = Some(create_test_user(1, "テストユーザー"));
        
        // 10日後の日付を設定
        let due_date = (Local::now() + Duration::days(10)).format("%Y-%m-%d").to_string();
        issue.due_date = Some(due_date);
        
        let score = ScoringService::calculate_score(&issue, &me);
        assert_eq!(score, 50, "期限まで8日以上ある場合は基本スコアのみ");
    }

    /// 3日以内に更新された課題は+50点のボーナスを獲得することを確認
    #[test]
    fn test_recently_updated_adds_50_points() {
        let me = create_test_user(1, "テストユーザー");
        let mut issue = create_test_issue();
        issue.assignee = Some(create_test_user(1, "テストユーザー"));
        
        // 2日前に更新された日付を設定
        let updated_date = (Utc::now() - Duration::days(2)).to_rfc3339();
        issue.updated = Some(updated_date);
        
        let score = ScoringService::calculate_score(&issue, &me);
        assert_eq!(score, 100, "3日以内に更新された場合は50(基本) + 50(最近更新) = 100点");
    }

    /// ちょうど3日前の更新もボーナス対象に含まれることを確認（境界値テスト）
    #[test]
    fn test_updated_exactly_3_days_ago_adds_50_points() {
        let me = create_test_user(1, "テストユーザー");
        let mut issue = create_test_issue();
        issue.assignee = Some(create_test_user(1, "テストユーザー"));
        
        // ちょうど3日前に更新
        let updated_date = (Utc::now() - Duration::days(3)).to_rfc3339();
        issue.updated = Some(updated_date);
        
        let score = ScoringService::calculate_score(&issue, &me);
        assert_eq!(score, 100, "ちょうど3日前に更新された場合も50点追加");
    }

    /// 4日以上前に更新された課題は更新ボーナスが付かないことを確認
    #[test]
    fn test_updated_over_3_days_ago_no_bonus() {
        let me = create_test_user(1, "テストユーザー");
        let mut issue = create_test_issue();
        issue.assignee = Some(create_test_user(1, "テストユーザー"));
        
        // 4日前に更新
        let updated_date = (Utc::now() - Duration::days(4)).to_rfc3339();
        issue.updated = Some(updated_date);
        
        let score = ScoringService::calculate_score(&issue, &me);
        assert_eq!(score, 50, "4日以上前の更新は基本スコアのみ");
    }

    /// 説明文に自分の名前が含まれている場合に+30点が付与されることを確認
    #[test]
    fn test_mentioned_in_description_adds_30_points() {
        let me = create_test_user(1, "山田太郎");
        let mut issue = create_test_issue();
        issue.description = Some("@山田太郎 さん、この課題をお願いします".to_string());
        
        let score = ScoringService::calculate_score(&issue, &me);
        assert_eq!(score, 30, "説明文に名前が含まれる場合は30点");
    }

    /// 担当者とメンションの両方が該当する場合、スコアが加算されることを確認
    #[test]
    fn test_assigned_and_mentioned_combines_scores() {
        let me = create_test_user(1, "山田太郎");
        let mut issue = create_test_issue();
        issue.assignee = Some(create_test_user(1, "山田太郎"));
        issue.description = Some("@山田太郎 さん、至急お願いします".to_string());
        
        let score = ScoringService::calculate_score(&issue, &me);
        assert_eq!(score, 80, "担当者(50) + メンション(30) = 80点");
    }

    /// すべての条件（担当者+期限切れ+最近更新+メンション）が揃った場合の最大スコアを確認
    #[test]
    fn test_all_conditions_max_score() {
        let me = create_test_user(1, "山田太郎");
        let mut issue = create_test_issue();
        issue.assignee = Some(create_test_user(1, "山田太郎"));
        issue.description = Some("@山田太郎 さん、確認をお願いします".to_string());
        
        // 期限切れ
        let overdue_date = (Local::now() - Duration::days(1)).format("%Y-%m-%d").to_string();
        issue.due_date = Some(overdue_date);
        
        // 最近更新
        let updated_date = (Utc::now() - Duration::hours(12)).to_rfc3339();
        issue.updated = Some(updated_date);
        
        let score = ScoringService::calculate_score(&issue, &me);
        assert_eq!(score, 230, "すべての条件: 50(基本) + 100(期限切れ) + 50(最近更新) + 30(メンション) = 230点");
    }

    /// 無効な期限日フォーマットが入力されてもクラッシュせず、基本スコアを返すことを確認
    #[test]
    fn test_invalid_due_date_format_no_crash() {
        let me = create_test_user(1, "テストユーザー");
        let mut issue = create_test_issue();
        issue.assignee = Some(create_test_user(1, "テストユーザー"));
        issue.due_date = Some("invalid-date".to_string());
        
        let score = ScoringService::calculate_score(&issue, &me);
        assert_eq!(score, 50, "無効な日付フォーマットでもクラッシュせず基本スコアを返す");
    }

    /// 無効な更新日時フォーマットが入力されてもクラッシュせず、基本スコアを返すことを確認
    #[test]
    fn test_invalid_updated_date_format_no_crash() {
        let me = create_test_user(1, "テストユーザー");
        let mut issue = create_test_issue();
        issue.assignee = Some(create_test_user(1, "テストユーザー"));
        issue.updated = Some("invalid-datetime".to_string());
        
        let score = ScoringService::calculate_score(&issue, &me);
        assert_eq!(score, 50, "無効な更新日時フォーマットでもクラッシュせず基本スコアを返す");
    }

    /// 説明文がNoneの場合でもクラッシュしないことを確認
    #[test]
    fn test_none_description_no_crash() {
        let me = create_test_user(1, "テストユーザー");
        let mut issue = create_test_issue();
        issue.assignee = Some(create_test_user(1, "テストユーザー"));
        issue.description = None;
        
        let score = ScoringService::calculate_score(&issue, &me);
        assert_eq!(score, 50, "説明文がNoneでもクラッシュしない");
    }

    /// ISO8601形式の期限日も正しくパースできることを確認
    #[test]
    fn test_alternative_due_date_format() {
        let me = create_test_user(1, "テストユーザー");
        let mut issue = create_test_issue();
        issue.assignee = Some(create_test_user(1, "テストユーザー"));
        
        // ISO8601形式の日付
        let due_date = (Local::now() + Duration::days(3)).format("%Y-%m-%dT%H:%M:%SZ").to_string();
        issue.due_date = Some(due_date);
        
        let score = ScoringService::calculate_score(&issue, &me);
        assert_eq!(score, 100, "ISO8601形式の期限日もパース可能");
    }
}
