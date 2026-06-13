//! AI推論モジュール
//!
//! オンデバイスAI（macOS FoundationModels 等）による課題分析の抽象基盤。
//! 推論バックエンドを [`LlmInference`] トレイトで抽象化し、入出力を Serde 型で固定することで、
//! 後続の実装項目（Swift sidecar バックエンド・バックグラウンドワーカー・Tauriコマンド）が
//! 具体的なバックエンド実装に依存せず開発できるようにする。
//!
//! # 設計方針
//! - **構造化出力**: FR-V03-005 に対応し、要約・リスクレベル・対応提案を構造化型で受け渡す。
//! - **遅延日数は LLM 出力に含めない**: 遅延日数・期限切れ判定は SQL 側で確実に算出する
//!   （[`crate::db::DbClient::get_issue_delay_days`]）。LLM の不確実な出力に依存させない。
//! - **バックエンド差し替え**: v0.4 以降に予定される MLX/Candle バックエンドは、
//!   [`create_backend`] のレジストリにアームを追加するだけで導入できるよう前置きする。
//! - **非対応環境の非阻害**: AI が利用できない環境でも既存機能を一切阻害しないため、
//!   バックエンド生成は失敗を許容する [`anyhow::Result`] を返す。
//!
//! 本モジュールの公開要素は後続の実装項目（sidecar バックエンド・ワーカー・Tauriコマンド）で
//! 参照される骨格であり、現時点ではクレート内から未参照のため module 単位で dead_code を許可する。

#![allow(dead_code)]

pub mod availability;
pub mod cosine;
pub mod embed_worker;
pub mod embedding;
pub mod foundation_models;
pub mod worker;

use anyhow::Result;
use serde::{Deserialize, Serialize};

/// 課題本文（説明）をLLMへ渡す際の最大文字数。
///
/// FoundationModels のコンテキスト上限を考慮し、SQL側の前処理で本文をこの文字数に切り詰める。
/// 切り詰め文字数の根拠（コンテキスト上限の実測）は v0.3 の未解決事項であり、
/// 確定後はこの定数のみを更新すれば全体に反映される（切り詰めポリシーの一元管理）。
pub const CONTEXT_BODY_MAX_CHARS: usize = 1000;

/// 推論バックエンドを識別する種別。
///
/// [`create_backend`] でどのバックエンドを生成するかを選択するために用いる。
/// v0.3 では `FoundationModels` のみ実装し、将来のバックエンドはバリアントを追加して拡張する。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BackendKind {
    /// macOS FoundationModels（Swift sidecar 経由）。v0.3 の標準バックエンド。
    FoundationModels,
    // 将来の拡張例（v0.4 以降）:
    // /// MLX（Qwen3 等）。古い macOS のカバー・品質向上用。
    // Mlx,
    // /// Candle（Windows 等のクロスプラットフォーム用）。
    // Candle,
}

/// AI分析の入力。
///
/// SQL側でコンテキスト上限を考慮した前処理を済ませた状態でバックエンドへ渡す。
/// `description_head` は [`CONTEXT_BODY_MAX_CHARS`] で切り詰め済みであることを前提とする。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiAnalysisInput {
    /// 課題キー（例: "PROJ-123"）。
    pub issue_key: String,
    /// 課題タイトル（要約元の主情報）。
    pub summary: String,
    /// 課題本文の先頭部分（[`CONTEXT_BODY_MAX_CHARS`] で切り詰め済み）。
    pub description_head: String,
    /// 現在のステータス（例: "未対応" / "処理中"）。
    pub status: String,
    /// 期限日（ISO8601 文字列。未設定の場合は `None`）。
    pub due_date: Option<String>,
    /// 出力言語（UI言語に追従。`"ja"` または `"en"`）。
    pub lang: String,
}

/// リスクレベル。
///
/// FR-V03-005 の構造化出力に対応する。シリアライズ時は小文字（`high` / `medium` / `low`）になり、
/// `ai_results.risk_level` カラムおよびフロントエンドのバッジ色分けと一致する。
///
/// # 順序（FR-V04-006）
/// `final_risk = max(llm_risk, schedule_risk)` を取れるよう `Ord` を導出する。
/// バリアントの宣言順がそのまま順序になる（`Low < Medium < High`）ため、
/// 危険度が高いほど大きい値になるよう **Low → Medium → High の順**で宣言する。
/// この順序は `max` 演算の意味（より高いリスクを採用する）と一致する。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    /// 低リスク。
    Low,
    /// 中リスク。
    Medium,
    /// 高リスク。
    High,
}

impl RiskLevel {
    /// `ai_results.risk_level` へ保存する小文字文字列へ変換する。
    ///
    /// フロントのバッジ色分け（`high` / `medium` / `low`）および serde 表現
    /// （`rename_all = "lowercase"`）と一致する文字列を、JSON を経由せずに得る。
    ///
    /// # 戻り値
    /// `"high"` / `"medium"` / `"low"` のいずれか。
    pub fn as_storage_str(self) -> &'static str {
        match self {
            RiskLevel::High => "high",
            RiskLevel::Medium => "medium",
            RiskLevel::Low => "low",
        }
    }

    /// `ai_results.risk_level` の保存文字列から復元する。
    ///
    /// 既保存結果の再計算（FR-V04-006 の [`crate::db::DbClient::recompute_schedule_risk`]）で、
    /// 保存済み LLM リスクを `RiskLevel` に戻して `schedule_risk` と `max` を取るために用いる。
    /// 大文字小文字は無視する。`high` / `medium` / `low` 以外は `None`。
    ///
    /// # 引数
    /// * `s` - 保存文字列（`"high"` / `"medium"` / `"low"`）。
    ///
    /// # 戻り値
    /// 対応する [`RiskLevel`]、未知の値なら `None`。
    pub fn from_storage_str(s: &str) -> Option<RiskLevel> {
        match s.to_ascii_lowercase().as_str() {
            "high" => Some(RiskLevel::High),
            "medium" => Some(RiskLevel::Medium),
            "low" => Some(RiskLevel::Low),
            _ => None,
        }
    }
}

/// 遅延日数からスケジュール由来のリスクレベルを決定的に算出する（FR-V04-006）。
///
/// 期限超過・期限間近の度合いだけで決まる**決定的**なリスク評価で、LLM の不確実な出力に依存しない。
/// 課題本文の内容リスク（LLM 由来）とは独立に算出し、最終リスクは
/// `final_risk = max(llm_risk, schedule_risk(delay_days))` で合成する（ワーカー / 再計算で共用）。
///
/// # しきい値
/// `delay_days` は SQL 算出値（[`crate::db::DbClient::get_issue_delay_days`]）で、
/// **正=期限超過・0=当日・負=期限までの猶予日数**を表す。
///
/// | 条件                         | 返り値   | 意味                                   |
/// | ---------------------------- | -------- | -------------------------------------- |
/// | `delay_days > 14`            | `High`   | 14日超の超過は高リスク                 |
/// | `1 ..= 14`                   | `Medium` | 1〜14日の超過は中リスク以上            |
/// | `-3 ..= 0`（期限間近・当日） | `Medium` | 期限まで数日（3日以内）は中リスク      |
/// | それ以外（猶予が十分・期限なし） | `Low`    | 内容リスク据え置き（合成で影響なし）   |
///
/// `Low` は「スケジュール由来では昇格させない」ことを表す。`max` を取ると LLM リスクがそのまま残るため、
/// 内容リスクを据え置く（影響なし）という要件を満たす。
///
/// # 引数
/// * `delay_days` - SQL 算出の遅延日数（期限未設定・算出不能なら `None`）。
///
/// # 戻り値
/// スケジュール由来のリスクレベル。
pub fn schedule_risk(delay_days: Option<i64>) -> RiskLevel {
    match delay_days {
        // 14日超の超過 → 高リスク。
        Some(d) if d > 14 => RiskLevel::High,
        // 1〜14日の超過 → 中リスク以上。
        Some(d) if d >= 1 => RiskLevel::Medium,
        // 当日〜期限まで数日以内（猶予 3 日以内）→ 中リスク。
        // delay_days は猶予を負で表すため、-3 ..= 0 が「3日以内に期限」を意味する。
        Some(d) if d >= -3 => RiskLevel::Medium,
        // 十分な猶予がある / 期限なし → スケジュール由来では昇格しない（内容リスク据え置き）。
        _ => RiskLevel::Low,
    }
}

/// AI分析の出力。
///
/// FR-V03-005 の構造化出力。guided generation でこの構造を保証する。
/// 遅延日数は SQL 側で算出するため、ここには**含めない**。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiAnalysisOutput {
    /// 1行要約。
    pub summary: String,
    /// リスクレベル（high / medium / low）。
    pub risk_level: RiskLevel,
    /// 対応提案（次に取るべきアクション）。
    pub suggestion: String,
}

/// LLM推論バックエンドの抽象トレイト。
///
/// 具体的な推論バックエンド（FoundationModels / 将来の MLX・Candle 等）はこのトレイトを実装する。
/// バックグラウンドワーカーはこのトレイト越しに推論を呼び出すため、バックエンドの差し替えが
/// 呼び出し側に影響しない。
///
/// # 注意
/// `async fn` を含むため dyn 互換ではない。バックエンドを動的に切り替える場合は
/// [`create_backend`] が返す具体型（または enum ディスパッチ）を経由する。
pub trait LlmInference {
    /// 課題1件を分析して構造化結果を返す。
    ///
    /// # 引数
    /// * `input` - SQL側で前処理済みの分析入力（本文は切り詰め済み）。
    ///
    /// # 戻り値
    /// 構造化された分析結果 [`AiAnalysisOutput`]、または推論失敗時のエラー。
    fn infer(
        &self,
        input: AiAnalysisInput,
    ) -> impl std::future::Future<Output = Result<AiAnalysisOutput>> + Send;

    /// バックエンドの識別名を返す。
    ///
    /// `ai_results.model_used` への記録や、設定画面での動作状況表示に用いる。
    ///
    /// # 戻り値
    /// バックエンド名（例: `"foundation-models"`）。
    fn name(&self) -> &str;
}

/// バックエンド種別から推論バックエンドを生成する。
///
/// 将来のバックエンド追加（v0.4 以降の MLX/Candle 等）を見据えた**レジストリ的な入口**。
/// 新しいバックエンドを導入する際は、以下の手順で拡張できる:
///
/// 1. [`BackendKind`] に新しいバリアントを追加する。
/// 2. 当該バックエンドの実装型（[`LlmInference`] 実装）を `ai/` 配下に追加する。
/// 3. この関数の `match` に当該バリアントのアームを追加する。
///
/// 呼び出し側（ワーカー・コマンド）はこの関数を経由するため、バックエンド追加の影響は
/// `ai/` モジュール内に閉じる。
///
/// # 引数
/// * `app` - sidecar 起動等に用いる Tauri アプリケーションハンドル。
/// * `kind` - 生成するバックエンドの種別。
///
/// # 戻り値
/// 生成したバックエンド（[`LlmInference`] 実装）、または生成失敗時のエラー。
/// AI 非対応環境では呼び出し側がこのエラーを握りつぶして AI 機能のみ無効化する想定。
///
/// # 補足
/// v0.3 では `match` のアームが [`BackendKind::FoundationModels`] のみのため、戻り値の `impl LlmInference`
/// は [`foundation_models::FoundationModelsBackend`] に解決される。将来バリアントを追加して複数アームが
/// 異なる具体型を返す段階になったら、enum ディスパッチ型へ切り替える（呼び出し側のシグネチャは不変）。
pub fn create_backend<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    kind: BackendKind,
) -> Result<impl LlmInference> {
    match kind {
        BackendKind::FoundationModels => {
            // v0.3 の標準バックエンド。sidecar の実起動は最初の推論要求まで遅延する（アイドル時非消費）。
            Ok(foundation_models::FoundationModelsBackend::new(app))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedule_risk_thresholds() {
        // 14日超 → High（要件の代表値 469 日も含む）。
        assert_eq!(schedule_risk(Some(469)), RiskLevel::High);
        assert_eq!(schedule_risk(Some(15)), RiskLevel::High);
        // 境界: ちょうど14日は High ではなく Medium（「14日超=High」）。
        assert_eq!(schedule_risk(Some(14)), RiskLevel::Medium);
        assert_eq!(schedule_risk(Some(13)), RiskLevel::Medium);
        // 1日超過 → Medium。
        assert_eq!(schedule_risk(Some(1)), RiskLevel::Medium);
        // 当日（0日）→ 期限間近として Medium。
        assert_eq!(schedule_risk(Some(0)), RiskLevel::Medium);
        // 期限まで数日（3日以内）→ Medium。
        assert_eq!(schedule_risk(Some(-3)), RiskLevel::Medium);
        // 4日以上の猶予 → Low（スケジュール由来では昇格しない）。
        assert_eq!(schedule_risk(Some(-4)), RiskLevel::Low);
        assert_eq!(schedule_risk(Some(-5)), RiskLevel::Low);
        // 期限未設定・算出不能 → Low。
        assert_eq!(schedule_risk(None), RiskLevel::Low);
    }

    #[test]
    fn final_risk_is_max_of_llm_and_schedule() {
        // Ord は Low < Medium < High。max でより高いリスクが採用される。
        // LLM=Low・スケジュール=High（大幅超過）→ High に昇格。
        assert_eq!(
            RiskLevel::Low.max(schedule_risk(Some(469))),
            RiskLevel::High
        );
        // LLM=High・スケジュール=Low（十分な猶予）→ High を据え置き（スケジュールで下げない）。
        assert_eq!(
            RiskLevel::High.max(schedule_risk(Some(-30))),
            RiskLevel::High
        );
        // LLM=Low・スケジュール=Medium（期限間近）→ Medium に昇格。
        assert_eq!(
            RiskLevel::Low.max(schedule_risk(Some(0))),
            RiskLevel::Medium
        );
        // LLM=Medium・スケジュール=Low → Medium 据え置き。
        assert_eq!(
            RiskLevel::Medium.max(schedule_risk(None)),
            RiskLevel::Medium
        );
    }

    #[test]
    fn risk_level_storage_str_roundtrip() {
        for lvl in [RiskLevel::High, RiskLevel::Medium, RiskLevel::Low] {
            let s = lvl.as_storage_str();
            assert_eq!(RiskLevel::from_storage_str(s), Some(lvl));
        }
        // 大文字・未知の値の扱い。
        assert_eq!(RiskLevel::from_storage_str("HIGH"), Some(RiskLevel::High));
        assert_eq!(RiskLevel::from_storage_str("unknown"), None);
    }

    #[test]
    fn risk_level_ord_is_low_medium_high() {
        assert!(RiskLevel::Low < RiskLevel::Medium);
        assert!(RiskLevel::Medium < RiskLevel::High);
        assert!(RiskLevel::Low < RiskLevel::High);
    }
}
