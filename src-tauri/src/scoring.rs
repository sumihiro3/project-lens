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
                    if let Ok(due_date) = NaiveDate::parse_from_str(due_date_str, "%Y-%m-%dT%H:%M:%SZ") 
                       .or_else(|_| NaiveDate::parse_from_str(due_date_str, "%Y-%m-%d")) {
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
