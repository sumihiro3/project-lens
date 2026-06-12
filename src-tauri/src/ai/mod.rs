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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    /// 高リスク。
    High,
    /// 中リスク。
    Medium,
    /// 低リスク。
    Low,
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
