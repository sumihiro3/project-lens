//! 埋め込み生成の抽象基盤（v0.4 新設）
//!
//! ローカル埋め込みモデル（v0.4 既定 = OS 組み込み `NLContextualEmbedding` / 512次元）による
//! 課題テキストのベクトル化を、推論経路（[`crate::ai::LlmInference`]）とは**別経路**として抽象化する（FR-V04-001）。
//! バックエンドを [`EmbeddingBackend`] トレイトで抽象化し、入出力を Serde 型で固定することで、
//! 後続の実装項目（sidecar 埋め込みプロトコル・バックエンド本体・埋め込み専用ワーカー・類似検索）が
//! 具体的なバックエンド実装に依存せず開発できるようにする。
//!
//! # 設計方針
//! - **LlmInference とは別経路**: 要約・リスク判定（[`crate::ai::LlmInference`]）と埋め込みは
//!   入出力も呼び出し頻度も異なるため、トレイト・レジストリを分離する。[`crate::ai::BackendKind`] /
//!   [`crate::ai::create_backend`] のレジストリ設計思想を踏襲し、埋め込み側に
//!   [`EmbeddingBackendKind`] / [`create_embedding_backend`] を対置する。
//! - **プレフィックス（[`EmbedPrefix`]）**: e5 系モデルは入力先頭に `query:` / `passage:` を付与する仕様。
//!   ワイヤ契約（クエリ課題と被検索コーパス課題の非対称付与）として [`EmbedPrefix`] を残すが、
//!   **v0.4 既定の `NLContextualEmbedding` はプレフィックスを用いない**ため sidecar 側で無視する。
//!   将来 e5 系バックエンド（HuggingFace DL）を足したときに sidecar が `prefix` を見て付与する。
//! - **単一ベクトル方式（既定）**: 512トークン上限への対処は「チャンク分割 vs ダイジェスト生成後に
//!   単一ベクトル」が未解決事項（要件 未解決事項 1）。本実装では **タイトル＋本文＋コメントを結合し
//!   上限文字数（[`EMBED_SOURCE_MAX_CHARS`]）で切り詰めた単一テキスト → 単一ベクトル** を既定として
//!   採用する。ダイジェスト生成（v0.4.5 背景要約と生成物共有）への移行余地は呼び出し側
//!   （埋め込みワーカー）で結合テキストを差し替えるだけで残す。切り詰めポリシーは
//!   [`build_embed_source`] に一元化する。
//! - **バックエンド差し替え**: 将来の埋め込みバックエンド（OS 同梱 `NLContextualEmbedding` 等・
//!   要件 未解決事項 7）は、[`EmbeddingBackendKind`] にバリアントを追加し
//!   [`create_embedding_backend`] の `match` にアームを足すだけで導入できるよう前置きする。
//! - **非対応環境の非阻害**: 埋め込みが利用できない環境（Intel 等。NFR-V04-004）でも既存機能・
//!   v0.3 AI を一切阻害しないため、バックエンド生成は失敗を許容する [`anyhow::Result`] を返す。
//!   呼び出し側はエラーを握りつぶして検索機能のみ degrade する（NFR-V04-005）。
//!
//! 本モジュールの公開要素は sidecar 埋め込みプロトコル・バックエンド本体・埋め込みワーカー・
//! 類似検索（`embed_worker` / `foundation_models` / `commands`）から実際に参照されている。

use anyhow::Result;
use serde::{Deserialize, Serialize};

/// 埋め込みモデルの出力次元数。
///
/// v0.4 既定の OS 組み込み `NLContextualEmbedding`（CJK / 日本語）は 512 次元。`issue_embeddings`
/// テーブルの BLOB（512 × f32）と一致させる（FR-V04-004）。モデル差し替え時（例: HuggingFace から
/// DL した e5 系=384 次元）はこの定数とテーブル側の想定をあわせて更新し、再埋め込みする。
pub const EMBEDDING_DIM: usize = 512;

/// 埋め込み元テキスト（タイトル＋本文＋コメント結合）の最大文字数。
///
/// 埋め込みモデルは概ね 512 トークン前後の上限を持つ。トークン数を厳密に数えず、保守的な文字数で
/// 切り詰める（日本語・英語混在を考慮した安全側の既定値）。
/// 単一ベクトル方式（モジュールドキュメント参照）における切り詰めの一元定義であり、
/// 実測でトークン上限との対応が判明したらこの定数のみ更新すれば全体に反映される。
///
/// 未解決事項（要件 1）: チャンク分割 vs ダイジェスト生成。まずは単一ベクトル＋本定数での
/// 切り詰めを既定とする。
pub const EMBED_SOURCE_MAX_CHARS: usize = 1800;

/// e5 系モデルが要求する入力プレフィックス。
///
/// `multilingual-e5-small` はクエリと被検索文に**非対称**のプレフィックスを付与する仕様。
/// 検索クエリには [`EmbedPrefix::Query`]、コーパス（被検索）文には [`EmbedPrefix::Passage`] を用いる。
/// クエリ課題自身を被検索コーパスにも埋め込む場合、両者で別ベクトルになる点に留意する。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EmbedPrefix {
    /// 検索クエリ用（`"query: "` を先頭に付与）。
    Query,
    /// 被検索文（コーパス）用（`"passage: "` を先頭に付与）。
    Passage,
}

impl EmbedPrefix {
    /// プレフィックス文字列（末尾スペース込み）を返す。
    ///
    /// e5 仕様に従い `"query: "` / `"passage: "` を返す。バックエンド（sidecar / 将来の
    /// OS 埋め込み）はこの文字列を入力テキストの先頭へ連結してからモデルへ渡す。
    ///
    /// # 戻り値
    /// プレフィックス文字列（`"query: "` または `"passage: "`）。
    pub fn as_str(self) -> &'static str {
        match self {
            EmbedPrefix::Query => "query: ",
            EmbedPrefix::Passage => "passage: ",
        }
    }

    /// 与えたテキストの先頭にプレフィックスを付与する。
    ///
    /// バックエンド実装はモデルへ渡す直前に本メソッドで一括付与する。
    ///
    /// # 引数
    /// * `text` - プレフィックスを付ける対象テキスト（既に切り詰め済みを想定）。
    ///
    /// # 戻り値
    /// プレフィックス付きテキスト。
    pub fn apply(self, text: &str) -> String {
        format!("{}{text}", self.as_str())
    }
}

/// 埋め込み生成の入力。
///
/// 単一ベクトル方式では、課題1件分の結合・切り詰め済みテキスト（[`build_embed_source`] の出力）を
/// `texts` に1要素として渡す。複数件をまとめて埋め込む場合は `texts` に並べる（バックエンドは
/// バッチ処理してよい）。`prefix` は `texts` 全要素へ一律に適用する。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingInput {
    /// 埋め込み対象テキスト群（切り詰め済み・プレフィックス未付与）。
    pub texts: Vec<String>,
    /// 付与するプレフィックス（クエリ／コーパスで切り替える）。
    pub prefix: EmbedPrefix,
}

/// 埋め込み生成の出力。
///
/// `vectors` は入力 `texts` と**同順・同数**で対応する。各ベクトルの次元は [`EmbeddingBackend::dim`]
/// （`multilingual-e5-small` では [`EMBEDDING_DIM`]）と一致する。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingOutput {
    /// 入力テキストと同順の埋め込みベクトル群。
    pub vectors: Vec<Vec<f32>>,
}

/// 埋め込みバックエンドを識別する種別。
///
/// [`create_embedding_backend`] でどのバックエンドを生成するかを選択するために用いる。
/// v0.4 既定は OS 組み込みの `AppleNLContextual`（Swift sidecar 経由）。将来のバックエンドは
/// バリアントを追加して拡張する（要件 未解決事項 2 / 7）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EmbeddingBackendKind {
    /// macOS 組み込み `NLContextualEmbedding`（CJK / 512 次元、Swift sidecar 経由）。v0.4 の既定バックエンド。
    /// アプリ同梱不要・即動作。品質は top-N 関連提示に十分（実測で類似>無関係を弁別）。
    AppleNLContextual,
    // 将来の拡張例（有料機能候補）:
    // /// HuggingFace から DL する高精度モデル（例: multilingual-e5-small / 384 次元）。
    // /// 検索精度を上げたいユーザー向け。DL 基盤（進捗/再開/検証/削除）を伴う。
    // DownloadedHuggingFace,
}

/// 埋め込み生成バックエンドの抽象トレイト。
///
/// 具体的な埋め込みバックエンド（`multilingual-e5-small` sidecar / 将来の OS 同梱埋め込み等）は
/// このトレイトを実装する。埋め込みワーカー・類似検索はこのトレイト越しに埋め込みを呼び出すため、
/// バックエンドの差し替えが呼び出し側に影響しない。
///
/// # 注意
/// [`embed`](EmbeddingBackend::embed) は `async fn` を含むため dyn 互換ではない。バックエンドを
/// 動的に切り替える場合は [`create_embedding_backend`] が返す具体型（または enum ディスパッチ）を
/// 経由する（[`crate::ai::LlmInference`] と同じ方針）。
pub trait EmbeddingBackend {
    /// 複数テキストをまとめて埋め込みベクトルへ変換する。
    ///
    /// 実装は `prefix` を各テキストの先頭へ付与（[`EmbedPrefix::apply`]）してからモデルへ渡す。
    /// 戻り値のベクトル群は入力 `texts` と**同順・同数**で対応し、各ベクトルの次元は
    /// [`dim`](EmbeddingBackend::dim) と一致しなければならない。
    ///
    /// # 引数
    /// * `input` - 埋め込み対象テキスト群とプレフィックス指定。
    ///
    /// # 戻り値
    /// 入力と同順の埋め込みベクトル群 [`EmbeddingOutput`]、または埋め込み失敗時のエラー。
    fn embed(
        &self,
        input: EmbeddingInput,
    ) -> impl std::future::Future<Output = Result<EmbeddingOutput>> + Send;

    /// 埋め込みベクトルの次元数を返す。
    ///
    /// `issue_embeddings` の BLOB レイアウト検証や、コサイン類似度計算前の次元一致チェックに用いる。
    ///
    /// # 戻り値
    /// 出力ベクトルの次元数（`multilingual-e5-small` では [`EMBEDDING_DIM`]）。
    fn dim(&self) -> usize;

    /// 埋め込みモデルの識別名を返す。
    ///
    /// `issue_embeddings` への記録（再埋め込みポリシー判定。要件 未解決事項 5）や、
    /// 設定画面での動作状況表示に用いる。
    ///
    /// # 戻り値
    /// モデル名（例: `"apple-nl-contextual-ja"`）。
    fn model_name(&self) -> &str;
}

/// 単一ベクトル方式の埋め込み元テキストを組み立てる。
///
/// タイトル・本文・コメント群を結合し、[`EMBED_SOURCE_MAX_CHARS`] で切り詰めた1本のテキストを返す
/// （モジュールドキュメントの「単一ベクトル方式（既定）」）。プレフィックス（`query:` / `passage:`）は
/// **付与しない**（付与は [`EmbeddingBackend::embed`] の責務）。
///
/// 結合順は「タイトル → 本文 → コメント（新しい順に渡された前提でそのまま連結）」とし、
/// 改行区切りで連結したうえで先頭から文字数上限で切り詰める。タイトルは検索品質に効くため
/// 先頭に置き、上限超過時も残りやすくする。
///
/// # 引数
/// * `summary` - 課題タイトル。
/// * `description` - 課題本文（空文字可）。
/// * `comments` - コメント本文群（空可。呼び出し側が新しい順などの方針で並べて渡す）。
///
/// # 戻り値
/// 結合・切り詰め済みの埋め込み元テキスト（プレフィックス未付与）。
pub fn build_embed_source(summary: &str, description: &str, comments: &[String]) -> String {
    let mut parts: Vec<&str> = Vec::with_capacity(2 + comments.len());
    if !summary.is_empty() {
        parts.push(summary);
    }
    if !description.is_empty() {
        parts.push(description);
    }
    for c in comments {
        if !c.is_empty() {
            parts.push(c);
        }
    }
    let joined = parts.join("\n");

    // 文字単位で切り詰める（マルチバイト境界を壊さないため `chars()` ベース）。
    if joined.chars().count() <= EMBED_SOURCE_MAX_CHARS {
        joined
    } else {
        joined.chars().take(EMBED_SOURCE_MAX_CHARS).collect()
    }
}

/// 埋め込みバックエンド種別から埋め込みバックエンドを生成する。
///
/// 将来の埋め込みバックエンド追加を見据えた**レジストリ的な入口**（[`crate::ai::create_backend`] と
/// 同じ設計思想）。新しいバックエンドを導入する際は、以下の手順で拡張できる:
///
/// 1. [`EmbeddingBackendKind`] に新しいバリアントを追加する。
/// 2. 当該バックエンドの実装型（[`EmbeddingBackend`] 実装）を `ai/` 配下に追加する。
/// 3. この関数の `match` に当該バリアントのアームを追加する。
///
/// 呼び出し側（埋め込みワーカー・類似検索）はこの関数を経由するため、バックエンド追加の影響は
/// `ai/` モジュール内に閉じる。
///
/// # 引数
/// * `app` - sidecar 起動等に用いる Tauri アプリケーションハンドル。
/// * `kind` - 生成するバックエンドの種別。
///
/// # 戻り値
/// 生成したバックエンド（[`EmbeddingBackend`] 実装）、または生成失敗時のエラー。
/// 埋め込み非対応環境（Intel 等）では呼び出し側がこのエラーを握りつぶして検索機能のみ
/// 無効化する想定（NFR-V04-004 / NFR-V04-005）。
///
/// # 補足
/// v0.4 では `match` のアームが [`EmbeddingBackendKind::AppleNLContextual`] のみのため、戻り値の
/// `impl EmbeddingBackend` は [`crate::ai::foundation_models::FoundationModelsBackend`] に解決される
/// （analyze と同一 sidecar・同一管理タスクを共用し、`embed` 要求で 512 次元ベクトルを得る）。
/// 将来バリアントを追加して複数アームが異なる具体型を返す段階になったら enum ディスパッチ型へ
/// 切り替える（呼び出し側のシグネチャは不変。[`crate::ai::create_backend`] と同方針）。
///
/// 可用性は推論側の [`crate::ai::availability::check_availability`]（Apple Silicon / macOS 26）を流用し、
/// 非対応環境では `embed` 呼び出しが `Err` を返して検索のみ degrade する（NFR-V04-004 / NFR-V04-005）。
/// このため本関数自体は sidecar の存在可否を問わず成功する（実起動は最初の embed 要求まで遅延）。
pub fn create_embedding_backend<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    kind: EmbeddingBackendKind,
) -> Result<impl EmbeddingBackend> {
    match kind {
        EmbeddingBackendKind::AppleNLContextual => {
            // analyze と同じ FoundationModels sidecar を共用する（同一プロセスで embed を扱う）。
            // sidecar の実起動は最初の embed 要求まで遅延する（アイドル時非消費。NFR-V04-003）。
            Ok(crate::ai::foundation_models::FoundationModelsBackend::new(
                app,
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// dim / プレフィックス付与を検証するためのモックバックエンド。
    ///
    /// `embed` は受け取った各テキストへ実際にプレフィックスを付与したうえで、その文字長を
    /// 1要素ベクトルとして返す。これにより「embed がプレフィックスを正しく付与しているか」を
    /// 出力から検証できる（実モデルなしでロジックを確認する）。
    struct MockEmbeddingBackend {
        dim: usize,
    }

    impl EmbeddingBackend for MockEmbeddingBackend {
        async fn embed(&self, input: EmbeddingInput) -> Result<EmbeddingOutput> {
            let vectors = input
                .texts
                .iter()
                .map(|t| {
                    let prefixed = input.prefix.apply(t);
                    // 先頭がプレフィックスで始まることを長さに反映させる（検証用の決定的な値）。
                    vec![prefixed.chars().count() as f32]
                })
                .collect();
            Ok(EmbeddingOutput { vectors })
        }

        fn dim(&self) -> usize {
            self.dim
        }

        fn model_name(&self) -> &str {
            "mock-embedding"
        }
    }

    #[test]
    fn prefix_strings_follow_e5_spec() {
        assert_eq!(EmbedPrefix::Query.as_str(), "query: ");
        assert_eq!(EmbedPrefix::Passage.as_str(), "passage: ");
        assert_eq!(EmbedPrefix::Query.apply("hello"), "query: hello");
        assert_eq!(EmbedPrefix::Passage.apply("text"), "passage: text");
    }

    #[tokio::test]
    async fn embed_applies_prefix_to_each_text() {
        let backend = MockEmbeddingBackend { dim: EMBEDDING_DIM };
        let input = EmbeddingInput {
            texts: vec!["a".into(), "bb".into()],
            prefix: EmbedPrefix::Passage,
        };
        let out = backend.embed(input).await.expect("embed ok");
        // "passage: " は 9 文字。"passage: a" = 10, "passage: bb" = 11。
        assert_eq!(out.vectors.len(), 2);
        assert_eq!(out.vectors[0], vec![10.0]);
        assert_eq!(out.vectors[1], vec![11.0]);
    }

    #[tokio::test]
    async fn embed_query_prefix_differs_from_passage() {
        let backend = MockEmbeddingBackend { dim: EMBEDDING_DIM };
        let q = backend
            .embed(EmbeddingInput {
                texts: vec!["x".into()],
                prefix: EmbedPrefix::Query,
            })
            .await
            .expect("query embed ok");
        let p = backend
            .embed(EmbeddingInput {
                texts: vec!["x".into()],
                prefix: EmbedPrefix::Passage,
            })
            .await
            .expect("passage embed ok");
        // "query: x" = 8, "passage: x" = 10。プレフィックス差が出力に反映される。
        assert_eq!(q.vectors[0], vec![8.0]);
        assert_eq!(p.vectors[0], vec![10.0]);
    }

    #[test]
    fn dim_reports_backend_dimension() {
        let backend = MockEmbeddingBackend { dim: EMBEDDING_DIM };
        assert_eq!(backend.dim(), EMBEDDING_DIM);
        // v0.4 既定 = OS 組み込み NLContextualEmbedding（日本語/CJK）の出力次元。
        assert_eq!(EMBEDDING_DIM, 512);
    }

    #[test]
    fn model_name_is_reported() {
        let backend = MockEmbeddingBackend { dim: 8 };
        assert_eq!(backend.model_name(), "mock-embedding");
    }

    #[test]
    fn build_embed_source_joins_title_body_comments() {
        let src = build_embed_source(
            "タイトル",
            "本文です",
            &["コメント1".to_string(), "コメント2".to_string()],
        );
        assert_eq!(src, "タイトル\n本文です\nコメント1\nコメント2");
    }

    #[test]
    fn build_embed_source_skips_empty_parts() {
        // 空の本文・空コメントは結合に含めない（余計な改行を作らない）。
        let src = build_embed_source("タイトル", "", &["".to_string(), "有効".to_string()]);
        assert_eq!(src, "タイトル\n有効");
    }

    #[test]
    fn build_embed_source_truncates_to_char_limit() {
        let long_body = "あ".repeat(EMBED_SOURCE_MAX_CHARS + 500);
        let src = build_embed_source("t", &long_body, &[]);
        // タイトル "t" + "\n" + 本文。先頭から上限文字数で切り詰められる。
        assert_eq!(src.chars().count(), EMBED_SOURCE_MAX_CHARS);
        // マルチバイト境界が壊れていない（チャー単位 take のため再構成できる）。
        assert!(src.starts_with("t\n"));
    }
}
