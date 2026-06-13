//! FoundationModels バックエンド（Swift sidecar 連携）
//!
//! macOS の FoundationModels（オンデバイス LLM）を、`externalBin` で同梱した Swift sidecar 経由で
//! 呼び出す [`LlmInference`] 実装を提供する（FR-V03-001）。sidecar とは **JSON Lines over stdin/stdout**
//! で通信し、リクエスト1行に対して対応する1行レスポンスを受け取る。
//!
//! # 設計方針
//! - **同時推論1件**: sidecar への要求は専用の管理タスク（[`run_manager`]）が直列に処理する。
//!   推論要求は1件ずつ送られ、対応レスポンスを受け取るまで次を送らない（排他制御）。NFR-V03-003。
//!   sidecar プロトコルには要求 ID が無く、応答は **送信順に1対1で対応する** ため、この直列化が
//!   応答突合の前提になっている。
//! - **自動再起動**: sidecar の異常終了（`Terminated` / `Error`）を検知すると次の要求時に再起動する。
//!   sidecar は常駐ループのため、正常時は1プロセスを複数要求で再利用する。
//! - **連続失敗での一時停止**: 連続失敗カウンタが [`MAX_CONSECUTIVE_FAILURES`] を超えると AI 機能を
//!   一時停止状態（[`SidecarState::Suspended`]）にし、以降の推論要求を即座にエラーで返す（FR-V03-001）。
//!   成功すればカウンタはリセットされ、`Suspended` への遷移は手動再開（[`FoundationModelsBackend::resume`]）で解除する。
//! - **非阻害**: AI 非対応環境やビルド未同梱でも本体機能を阻害しないよう、推論失敗は [`anyhow::Result`] の
//!   `Err` として返すのみで panic させない。
//! - **テスト容易性**: sidecar の起動・通信を [`SidecarTransport`] トレイトで抽象化し、実機（macOS 26 /
//!   Apple Intelligence）が無くても管理タスクのロジック（要求応答・再起動・失敗エスカレーション）を
//!   モック越しに検証できるようにする。本番は [`ShellSidecarTransport`] が `tauri-plugin-shell` の
//!   sidecar API を用いる。
//!
//! # sidecar プロトコル（JSON Lines）
//! Swift sidecar（`src-tauri/sidecar/`）の入出力契約と一致させること。
//!
//! Rust → sidecar（1行 = 1 JSON、`\n` 終端）:
//! ```jsonc
//! {"type":"availability"}
//! {"type":"analyze","issue_key":"PROJ-1","summary":"...","description_head":"...","status":"...","due_date":"2026-06-30","lang":"ja"}
//! {"type":"embed","texts":["...","..."],"prefix":"query"}
//! {"type":"shutdown"}
//! ```
//! sidecar → Rust（1行 = 1 JSON。`type` で判別）:
//! ```jsonc
//! {"type":"availability","available":true,"reason":"available"}
//! {"type":"result","summary":"...","risk_level":"high","suggestion":"..."}
//! {"type":"embedding","vectors":[[/* 512 個の f32 */], ...]}
//! {"type":"error","message":"..."}
//! ```
//!
//! # 埋め込み（FR-V04-001）
//! analyze（要約・リスク判定）と embed（埋め込み生成）は **同一 sidecar プロセス** で扱う。
//! 双方とも管理タスク（[`run_manager`]）が直列に処理するため、同時実行は構造的に1件に保たれ、
//! 要求 ID を持たないプロトコルの応答突合（送信順 1 対 1）も維持される。プレフィックス
//! （`query: ` / `passage: `）の付与は **sidecar 側** が行い、Rust は [`EmbedPrefix`] をどちらにするか
//! 渡すのみ（二重付与防止。`embedding.rs` の契約参照）。埋め込み経路は [`EmbeddingBackend`] として
//! 公開し、[`super::embedding::create_embedding_backend`] が本バックエンドへ解決する。

use super::embedding::{
    EmbedPrefix, EmbeddingBackend, EmbeddingInput, EmbeddingOutput, EMBEDDING_DIM,
};
use super::{AiAnalysisInput, AiAnalysisOutput, LlmInference, RiskLevel};
use anyhow::{anyhow, Result};
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use tauri::async_runtime::{channel, Receiver, Sender};
use tokio::sync::oneshot;

/// 同梱する Swift sidecar の実行時名（`shell().sidecar()` に渡す名前）。
///
/// **basename のみ**（`binaries/` プレフィックスを付けない）。tauri-plugin-shell の
/// `relative_command_path` は `<実行ファイルのディレクトリ>/<この名前>` をそのまま解決する一方、
/// Tauri は `externalBin`（`tauri.conf.json` の `binaries/projectlens-ai-sidecar`）を
/// **ターゲットトリプルと `binaries/` を除いた basename** で実行ファイルの隣に配置する
/// （dev: `target/debug/projectlens-ai-sidecar`、バンドル: `*.app/Contents/MacOS/projectlens-ai-sidecar`）。
/// よってここに `binaries/` を付けると解決先がずれて spawn に失敗する。
/// なお `externalBin` の登録値とソース配置（`src-tauri/binaries/<name>-<triple>`）は別概念で、そちらは `binaries/` 付きのまま。
pub const SIDECAR_NAME: &str = "projectlens-ai-sidecar";

/// バックエンドの識別名。`ai_results.model_used` への記録に用いる。
pub const BACKEND_NAME: &str = "foundation-models";

/// 埋め込みモデルの識別名。`issue_embeddings.model` への記録に用いる（FR-V04-001 / 再埋め込み判定）。
///
/// 推論バックエンド名（[`BACKEND_NAME`]）とは別概念で、こちらは **モデル本体**を識別する。
/// モデル更新時にこの値を変えることで、`source_hash` と併せて再埋め込みの要否を判定できる
/// （要件 未解決事項 5）。v0.4 既定は OS 組み込み `NLContextualEmbedding`（日本語/CJK・512 次元）。
/// 将来 HuggingFace から別モデルを DL した場合はこの値を変え、全ベクトルを再埋め込みする。
pub const EMBEDDING_MODEL_NAME: &str = "apple-nl-contextual-ja";

/// 連続失敗をこの回数超えたら AI 機能を一時停止状態にする閾値（FR-V03-001）。
///
/// 1件の推論要求が（再起動を挟んでも）応答を得られず失敗するたびにカウントし、
/// 連続でこの回数に達したら [`SidecarState::Suspended`] へ遷移する。
pub const MAX_CONSECUTIVE_FAILURES: u32 = 3;

/// 推論要求 1 件に対する応答待ちのタイムアウト（秒）。
///
/// sidecar が応答しないまま固まった場合に管理タスクが先へ進めるための安全弁。
const REQUEST_TIMEOUT_SECS: u64 = 60;

/// sidecar への要求（Rust → sidecar、JSON 1行）。
///
/// `type` フィールドで判別する。Swift sidecar の `SidecarRequest`（`type` / `issue_key` /
/// `summary` / `description_head` / `status` / `due_date` / `lang`）と一致させる。
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum SidecarRequest {
    /// FoundationModels の可用性問い合わせ（FR-V03-002）。
    Availability,
    /// 課題1件の構造化分析（フィールドは [`AiAnalysisInput`] と一致）。
    Analyze {
        /// 課題キー（例: "PROJ-123"）。
        issue_key: String,
        /// 課題タイトル。
        summary: String,
        /// 課題本文の先頭（切り詰め済み）。
        description_head: String,
        /// 現在のステータス。
        status: String,
        /// 期限日（未設定時は省略）。
        #[serde(skip_serializing_if = "Option::is_none")]
        due_date: Option<String>,
        /// 出力言語（`ja` / `en`）。
        lang: String,
    },
    /// 複数テキストの埋め込み生成要求（FR-V04-001）。
    ///
    /// `texts` は **プレフィックス未付与・切り詰め済み**で渡す。`query: ` / `passage: ` の付与は
    /// sidecar 側が `prefix` を見て一括で行う（二重付与防止。`embedding.rs` の契約参照）。
    Embed {
        /// 埋め込み対象テキスト群（プレフィックス未付与・切り詰め済み）。
        texts: Vec<String>,
        /// 付与するプレフィックス種別（`query` / `passage`）。
        prefix: EmbedPrefix,
    },
    /// 正常終了要求（sidecar を停止する。EOF でも停止する）。
    Shutdown,
}

impl SidecarRequest {
    /// [`AiAnalysisInput`] から analyze 要求を組み立てる。
    ///
    /// # 引数
    /// * `input` - SQL側で前処理済みの分析入力。
    ///
    /// # 戻り値
    /// sidecar へ送る analyze 要求。
    fn analyze(input: AiAnalysisInput) -> Self {
        SidecarRequest::Analyze {
            issue_key: input.issue_key,
            summary: input.summary,
            description_head: input.description_head,
            status: input.status,
            due_date: input.due_date,
            lang: input.lang,
        }
    }

    /// [`EmbeddingInput`] から embed 要求を組み立てる。
    ///
    /// `texts` はプレフィックス未付与のまま渡す（付与は sidecar 側の責務）。
    ///
    /// # 引数
    /// * `input` - 埋め込み対象テキスト群とプレフィックス指定。
    ///
    /// # 戻り値
    /// sidecar へ送る embed 要求。
    fn embed(input: EmbeddingInput) -> Self {
        SidecarRequest::Embed {
            texts: input.texts,
            prefix: input.prefix,
        }
    }
}

/// sidecar からの応答（sidecar → Rust、JSON 1行）。`type` で判別する。
///
/// Swift sidecar の `ResultResponse` / `AvailabilityResponse` / `ErrorResponse` と一致させる。
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum SidecarResponse {
    /// analyze 成功時の結果（[`AiAnalysisOutput`] と同じ並び）。
    Result {
        /// 1行要約。
        summary: String,
        /// リスクレベル（high / medium / low）。
        risk_level: RiskLevel,
        /// 対応提案。
        suggestion: String,
    },
    /// 可用性応答。
    Availability {
        /// 推論が利用可能か。
        available: bool,
        /// 理由コード（`available` / `appleIntelligenceNotEnabled` / `modelNotReady` /
        /// `deviceNotEligible` / `unavailableOther` / `unsupportedOS`）。
        reason: String,
    },
    /// embed 成功時の応答（[`EmbeddingOutput`] と同じ並び。FR-V04-001）。
    ///
    /// `vectors` は要求の `texts` と**同順・同数**で対応し、各ベクトルは [`EMBEDDING_DIM`] 次元。
    /// 次元・件数の検証は [`parse_embedding`] で行う。
    Embedding {
        /// 入力テキストと同順の埋め込みベクトル群。
        vectors: Vec<Vec<f32>>,
    },
    /// エラー応答（生成失敗・入力不正）。
    Error {
        /// エラーメッセージ。
        message: String,
    },
}

/// FoundationModels の可用性情報（FR-V03-002）。
///
/// 環境検出（macOS 26 以上 / Apple Intelligence 有効 / availability API）の結果を表す。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailabilityInfo {
    /// 推論が利用可能か。
    pub available: bool,
    /// 理由コード（`available` / `appleIntelligenceNotEnabled` / `modelNotReady` /
    /// `deviceNotEligible` / `unavailableOther` / `unsupportedOS`）。
    /// フロント側で理由別メッセージへマップする。
    pub reason: String,
}

/// 管理タスクへ渡す内部コマンド（推論要求／可用性要求）。
///
/// 応答は `respond` の oneshot 経由で要求元へ返す。要求は1件ずつ管理タスクが処理するため、
/// この型を MPSC で送ることで「同時推論1件」の排他制御が自然に成立する。
enum ManagerCommand {
    /// 推論要求。
    Infer {
        /// 分析入力。
        input: AiAnalysisInput,
        /// 結果返却用の oneshot 送信端。
        respond: oneshot::Sender<Result<AiAnalysisOutput>>,
    },
    /// 可用性要求。
    Availability {
        /// 結果返却用の oneshot 送信端。
        respond: oneshot::Sender<Result<AvailabilityInfo>>,
    },
    /// 埋め込み生成要求（FR-V04-001）。
    Embed {
        /// 埋め込み入力（テキスト群とプレフィックス）。
        input: EmbeddingInput,
        /// 結果返却用の oneshot 送信端。
        respond: oneshot::Sender<Result<EmbeddingOutput>>,
    },
}

/// 期待する応答の種別（送信順に1対1対応する応答の検証に用いる）。
///
/// sidecar プロトコルに要求 ID が無いため、送った要求の種別と返ってきた応答の `type` が
/// 一致するかをこの値で検証する。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExpectedResponse {
    /// analyze 要求 → `result`（または `error`）を期待。
    Result,
    /// availability 要求 → `availability`（または `error`）を期待。
    Availability,
    /// embed 要求 → `embedding`（または `error`）を期待。
    Embedding,
}

/// sidecar プロセスを表すハンドル抽象。
///
/// 管理タスクは [`SidecarTransport::spawn`] で得たこのハンドル越しに 1 行 JSON を書き込み、
/// イベント（stdout 行・終了・エラー）を受け取る。本番は [`ShellSidecarTransport`] が
/// `tauri-plugin-shell` の `CommandChild` / `Receiver<CommandEvent>` を包む。
trait SidecarProcess: Send {
    /// stdin に 1 行（末尾改行付き）を書き込む。
    ///
    /// # 引数
    /// * `line` - 改行を含まない 1 行分の JSON 文字列。
    ///
    /// # 戻り値
    /// 書き込み成功で `Ok(())`、失敗で `Err`（プロセス異常とみなして再起動契機になる）。
    fn write_line(&mut self, line: &str) -> Result<()>;

    /// 次のプロセスイベント（stdout 行・stderr 行・終了・エラー）を待つ。
    ///
    /// # 戻り値
    /// 次のイベント。チャネルが閉じた（プロセス消滅）場合は `None`。
    fn next_event(&mut self) -> impl std::future::Future<Output = Option<ProcessEvent>> + Send;
}

/// sidecar プロセスから受け取るイベント（transport 非依存の正規化形）。
#[derive(Debug)]
enum ProcessEvent {
    /// stdout の 1 行（JSON 応答想定）。
    Stdout(String),
    /// stderr の 1 行（診断ログ）。
    Stderr(String),
    /// プロセス終了。
    Terminated,
    /// プロセスエラー（spawn 後の I/O 失敗等）。
    Error(String),
}

/// sidecar の起動を抽象化するトレイト（テスト差し替え用）。
///
/// 本番実装 [`ShellSidecarTransport`] は `externalBin` の sidecar を起動する。テストでは
/// モックプロセスを返して管理タスクのロジックを実機なしで検証する。
trait SidecarTransport: Send + Sync + 'static {
    /// sidecar プロセスを起動する。
    ///
    /// # 戻り値
    /// 起動した [`SidecarProcess`]、または起動失敗時のエラー。
    fn spawn(&self) -> Result<Box<dyn SidecarProcessDyn>>;
}

/// `async fn` を含む [`SidecarProcess`] を `dyn` 越しに扱うためのオブジェクトセーフ版。
///
/// [`SidecarProcess::next_event`] が `impl Future` を返すため `dyn` 化できない。`async_trait` を
/// 導入せずに済むよう、`next_event` を `Pin<Box<dyn Future>>` 返却に落とした薄いラッパを定義する。
trait SidecarProcessDyn: Send {
    /// stdin に 1 行を書き込む（[`SidecarProcess::write_line`] と同義）。
    fn write_line(&mut self, line: &str) -> Result<()>;
    /// 次のイベントを待つ（[`SidecarProcess::next_event`] のボックス化版）。
    fn next_event(
        &mut self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Option<ProcessEvent>> + Send + '_>>;
}

impl<T: SidecarProcess> SidecarProcessDyn for T {
    fn write_line(&mut self, line: &str) -> Result<()> {
        SidecarProcess::write_line(self, line)
    }

    fn next_event(
        &mut self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Option<ProcessEvent>> + Send + '_>>
    {
        Box::pin(SidecarProcess::next_event(self))
    }
}

/// バックエンドの稼働状態。
///
/// 連続失敗が閾値を超えると `Suspended` へ遷移し、推論要求を即エラーにする（FR-V03-001 / NFR-V03-004）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SidecarState {
    /// 稼働中（推論を受け付ける）。
    Running,
    /// 一時停止中（連続失敗が閾値超過。手動再開まで推論を受け付けない）。
    Suspended,
}

/// バックエンド間で共有する稼働状態（失敗カウンタ・一時停止フラグ）。
///
/// 管理タスクと [`FoundationModelsBackend`] のクローンで共有し、設定画面での動作状況表示にも使う。
#[derive(Debug, Default)]
struct SharedState {
    /// 連続失敗回数。成功でリセットされる。
    consecutive_failures: AtomicU32,
    /// 一時停止フラグ（true なら推論を受け付けない）。
    suspended: AtomicBool,
}

/// FoundationModels バックエンド（[`LlmInference`] 実装）。
///
/// 推論要求を管理タスクへ MPSC 送信し、応答を oneshot で受け取る。クローンしても同じ管理タスク・
/// 同じ稼働状態を共有する（`tx` と `state` を `Arc`/チャネルで共有）。
#[derive(Clone)]
pub struct FoundationModelsBackend {
    /// 管理タスクへ要求を送るチャネル送信端。
    tx: Sender<ManagerCommand>,
    /// 共有稼働状態（失敗カウンタ・一時停止フラグ）。
    state: Arc<SharedState>,
}

impl FoundationModelsBackend {
    /// 本番用 transport（`externalBin` sidecar）でバックエンドを生成する。
    ///
    /// 与えられた `AppHandle` から `tauri-plugin-shell` の sidecar を起動できるようにし、
    /// 管理タスクを spawn する。実際の sidecar 起動は最初の要求時まで遅延する
    /// （アイドル時 sidecar 非消費。NFR-V03-003）。
    ///
    /// # 引数
    /// * `app` - sidecar 起動に用いる Tauri アプリケーションハンドル。
    ///
    /// # 戻り値
    /// 生成したバックエンド。管理タスクは内部で起動済み。
    pub fn new<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Self {
        Self::with_transport(ShellSidecarTransport { app })
    }

    /// 任意の transport を指定してバックエンドを生成する（テスト用の差し替え口）。
    ///
    /// 管理タスクを spawn し、要求受付用チャネルを保持したバックエンドを返す。
    ///
    /// # 引数
    /// * `transport` - sidecar 起動を担う [`SidecarTransport`]。
    ///
    /// # 戻り値
    /// 生成したバックエンド。
    fn with_transport<T: SidecarTransport>(transport: T) -> Self {
        // 要求は1件ずつ直列処理する想定だが、送信側のブロックを避けるため小さめのバッファを持たせる。
        let (tx, rx) = channel::<ManagerCommand>(16);
        let state = Arc::new(SharedState::default());
        let state_for_task = Arc::clone(&state);

        tauri::async_runtime::spawn(async move {
            run_manager(transport, rx, state_for_task).await;
        });

        Self { tx, state }
    }

    /// 現在の稼働状態を返す（設定画面の動作状況表示用。FR-V03-003）。
    ///
    /// # 戻り値
    /// 一時停止中なら [`SidecarState::Suspended`]、それ以外は [`SidecarState::Running`]。
    pub fn state(&self) -> SidecarState {
        if self.state.suspended.load(Ordering::SeqCst) {
            SidecarState::Suspended
        } else {
            SidecarState::Running
        }
    }

    /// 一時停止状態を解除し、稼働状態へ戻す（手動再開）。
    ///
    /// 連続失敗カウンタもリセットする。設定画面の「再開」操作や再分析トリガーから呼ぶ想定。
    pub fn resume(&self) {
        self.state.suspended.store(false, Ordering::SeqCst);
        self.state.consecutive_failures.store(0, Ordering::SeqCst);
    }

    /// FoundationModels の可用性を問い合わせる（FR-V03-002）。
    ///
    /// sidecar に availability 要求を送り、`available` と理由コードを取得する。
    /// 一時停止中・sidecar 起動不能時はエラーを返すため、呼び出し側は `available=false` 相当として扱う。
    ///
    /// # 戻り値
    /// 可用性情報 [`AvailabilityInfo`]、または問い合わせ失敗時のエラー。
    pub async fn availability(&self) -> Result<AvailabilityInfo> {
        if self.state() == SidecarState::Suspended {
            return Err(anyhow!("AI backend is suspended"));
        }
        let (respond, recv) = oneshot::channel();
        self.tx
            .send(ManagerCommand::Availability { respond })
            .await
            .map_err(|_| anyhow!("AI manager task is not running"))?;
        recv.await
            .map_err(|_| anyhow!("AI manager dropped the availability response"))?
    }

    /// テキスト群を埋め込みベクトルへ変換する（FR-V04-001）。
    ///
    /// analyze と同じ管理タスク・同じ sidecar プロセスを経由し、embed 要求を送って `embedding`
    /// 応答を受け取る。一時停止中（連続失敗超過）は即エラーを返す。埋め込み非対応環境
    /// （Intel・モデル未同梱等）では sidecar が `error` を返すため、ここでも `Err` になり、
    /// 呼び出し側は検索機能のみ degrade する（NFR-V04-005）。
    ///
    /// # 引数
    /// * `input` - 埋め込み対象テキスト群とプレフィックス指定（テキストは切り詰め済み）。
    ///
    /// # 戻り値
    /// 入力と同順・同数の埋め込みベクトル群 [`EmbeddingOutput`]、または失敗・一時停止時のエラー。
    async fn embed_internal(&self, input: EmbeddingInput) -> Result<EmbeddingOutput> {
        if self.state() == SidecarState::Suspended {
            return Err(anyhow!(
                "AI backend is suspended after {MAX_CONSECUTIVE_FAILURES} consecutive failures"
            ));
        }
        let (respond, recv) = oneshot::channel();
        self.tx
            .send(ManagerCommand::Embed { input, respond })
            .await
            .map_err(|_| anyhow!("AI manager task is not running"))?;
        recv.await
            .map_err(|_| anyhow!("AI manager dropped the embedding response"))?
    }
}

impl EmbeddingBackend for FoundationModelsBackend {
    /// テキスト群を sidecar 経由で埋め込みベクトルへ変換する（FR-V04-001）。
    ///
    /// analyze と同一 sidecar・同一管理タスクを共用するため、埋め込みと要約が同時に走ることはなく
    /// （直列化）、応答突合も維持される。詳細は [`FoundationModelsBackend::embed_internal`]。
    ///
    /// # 引数
    /// * `input` - 埋め込み対象テキスト群とプレフィックス指定。
    ///
    /// # 戻り値
    /// 入力と同順・同数の埋め込みベクトル群、または失敗・一時停止時のエラー。
    async fn embed(&self, input: EmbeddingInput) -> Result<EmbeddingOutput> {
        self.embed_internal(input).await
    }

    /// 埋め込みベクトルの次元数（[`EMBEDDING_DIM`] = 512）を返す。
    fn dim(&self) -> usize {
        EMBEDDING_DIM
    }

    /// 埋め込みモデルの識別名を返す。
    ///
    /// `issue_embeddings.model` への記録（再埋め込みポリシー判定）に用いる。バックエンドの
    /// 識別名（[`BACKEND_NAME`]）ではなく、**モデル名**を返す点に注意（モデル更新検知のため）。
    fn model_name(&self) -> &str {
        EMBEDDING_MODEL_NAME
    }
}

impl LlmInference for FoundationModelsBackend {
    /// 課題1件を sidecar で分析し、構造化結果を返す。
    ///
    /// 管理タスクへ要求を送り、対応する1行レスポンスを待つ。一時停止中（連続失敗超過）は
    /// 即座にエラーを返し、新規 sidecar 起動も推論も行わない。
    ///
    /// # 引数
    /// * `input` - SQL側で前処理済みの分析入力（本文は切り詰め済み）。
    ///
    /// # 戻り値
    /// 構造化分析結果 [`AiAnalysisOutput`]、または推論失敗・一時停止時のエラー。
    async fn infer(&self, input: AiAnalysisInput) -> Result<AiAnalysisOutput> {
        if self.state() == SidecarState::Suspended {
            return Err(anyhow!(
                "AI backend is suspended after {MAX_CONSECUTIVE_FAILURES} consecutive failures"
            ));
        }
        let (respond, recv) = oneshot::channel();
        self.tx
            .send(ManagerCommand::Infer { input, respond })
            .await
            .map_err(|_| anyhow!("AI manager task is not running"))?;
        recv.await
            .map_err(|_| anyhow!("AI manager dropped the inference response"))?
    }

    /// バックエンドの識別名（[`BACKEND_NAME`]）を返す。
    fn name(&self) -> &str {
        BACKEND_NAME
    }
}

/// sidecar 管理タスク本体。
///
/// 要求を1件ずつ受け取り、必要なら sidecar を起動・再起動して 1 行 JSON で送受信する。
/// 成功で連続失敗カウンタをリセットし、失敗が [`MAX_CONSECUTIVE_FAILURES`] を超えたら
/// 一時停止状態へ遷移して以降の起動を抑止する（FR-V03-001）。
///
/// この関数は専用タスク内で動くため、推論の同時実行は構造的に1件に限定される（NFR-V03-003）。
/// 要求 ID を持たないプロトコルの応答突合も、この直列処理によって成立する。
///
/// # 引数
/// * `transport` - sidecar 起動を担う transport。
/// * `rx` - 要求受信チャネル。
/// * `state` - 共有稼働状態（失敗カウンタ・一時停止フラグ）。
async fn run_manager<T: SidecarTransport>(
    transport: T,
    mut rx: Receiver<ManagerCommand>,
    state: Arc<SharedState>,
) {
    // 現在稼働中の sidecar プロセス。None なら未起動（次の要求時に遅延起動）。
    let mut proc: Option<Box<dyn SidecarProcessDyn>> = None;

    while let Some(cmd) = rx.recv().await {
        // 一時停止中は新規起動も推論も行わず、要求を即エラーで返す。
        if state.suspended.load(Ordering::SeqCst) {
            reject_suspended(cmd);
            continue;
        }

        // sidecar 未起動なら起動を試みる。失敗は当該要求の失敗としてカウントする。
        if proc.is_none() {
            match transport.spawn() {
                Ok(p) => {
                    info!("AI sidecar started");
                    proc = Some(p);
                }
                Err(e) => {
                    error!("AI sidecar spawn failed: {e}");
                    record_failure(&state);
                    fail_command(cmd, anyhow!("failed to start AI sidecar: {e}"));
                    continue;
                }
            }
        }

        let child = proc.as_mut().expect("sidecar must be started here");
        match dispatch_command(child.as_mut(), cmd).await {
            Ok(()) => {
                state.consecutive_failures.store(0, Ordering::SeqCst);
            }
            Err(e) => {
                warn!("AI sidecar exchange failed: {e}. Restarting sidecar on next request.");
                // 通信失敗時は sidecar を破棄し、次要求で再起動する（自動再起動）。
                proc = None;
                record_failure(&state);
            }
        }
    }

    info!("AI manager task stopped (request channel closed)");
}

/// 1 要求を sidecar とやり取りし、結果を要求元へ返す。
///
/// 要求種別に応じて [`SidecarRequest`] を組み立てて送信し、対応する1行レスポンスを受け取って
/// oneshot へ返す。通信失敗（プロセス異常・タイムアウト）は `Err` として呼び出し元へ伝え、
/// 呼び出し元（[`run_manager`]）が sidecar 再起動を判断する。
/// 応答内容のエラー（sidecar が `error` を返した・型不一致）は、通信は成立しているため
/// 要求元へ `Err` を返しつつ本関数は `Ok(())`（＝接続は健全）を返す。
///
/// # 引数
/// * `child` - 稼働中の sidecar プロセス。
/// * `cmd` - 処理する要求。
///
/// # 戻り値
/// 接続が健全なら `Ok(())`、通信失敗（再起動が必要）なら `Err`。
async fn dispatch_command(child: &mut dyn SidecarProcessDyn, cmd: ManagerCommand) -> Result<()> {
    match cmd {
        ManagerCommand::Infer { input, respond } => {
            let request = SidecarRequest::analyze(input);
            match exchange(child, &request, ExpectedResponse::Result).await {
                Ok(response) => {
                    let _ = respond.send(parse_result(response));
                    Ok(())
                }
                Err(e) => {
                    // 通信失敗は要求元へ伝えつつ、再起動契機として呼び出し元へも伝える。
                    let _ = respond.send(Err(anyhow!("{e}")));
                    Err(e)
                }
            }
        }
        ManagerCommand::Availability { respond } => {
            match exchange(
                child,
                &SidecarRequest::Availability,
                ExpectedResponse::Availability,
            )
            .await
            {
                Ok(response) => {
                    let _ = respond.send(parse_availability(response));
                    Ok(())
                }
                Err(e) => {
                    let _ = respond.send(Err(anyhow!("{e}")));
                    Err(e)
                }
            }
        }
        ManagerCommand::Embed { input, respond } => {
            // 期待件数を控えてから move する（応答の件数検証に用いる）。
            let expected_count = input.texts.len();
            let request = SidecarRequest::embed(input);
            match exchange(child, &request, ExpectedResponse::Embedding).await {
                Ok(response) => {
                    let _ = respond.send(parse_embedding(response, expected_count));
                    Ok(())
                }
                Err(e) => {
                    let _ = respond.send(Err(anyhow!("{e}")));
                    Err(e)
                }
            }
        }
    }
}

/// `result` 応答（または `error`・型不一致）を [`AiAnalysisOutput`] へ変換する。
///
/// # 引数
/// * `response` - 受信済みの応答。
///
/// # 戻り値
/// 分析結果、または sidecar エラー・型不一致時のエラー。
fn parse_result(response: SidecarResponse) -> Result<AiAnalysisOutput> {
    match response {
        SidecarResponse::Result {
            summary,
            risk_level,
            suggestion,
        } => Ok(AiAnalysisOutput {
            summary,
            risk_level,
            suggestion,
        }),
        SidecarResponse::Error { message } => Err(anyhow!("sidecar error: {message}")),
        SidecarResponse::Availability { .. } => Err(anyhow!(
            "unexpected 'availability' response for analyze request"
        )),
        SidecarResponse::Embedding { .. } => Err(anyhow!(
            "unexpected 'embedding' response for analyze request"
        )),
    }
}

/// `availability` 応答（または `error`・型不一致）を [`AvailabilityInfo`] へ変換する。
///
/// # 引数
/// * `response` - 受信済みの応答。
///
/// # 戻り値
/// 可用性情報、または sidecar エラー・型不一致時のエラー。
fn parse_availability(response: SidecarResponse) -> Result<AvailabilityInfo> {
    match response {
        SidecarResponse::Availability { available, reason } => {
            Ok(AvailabilityInfo { available, reason })
        }
        SidecarResponse::Error { message } => Err(anyhow!("sidecar error: {message}")),
        SidecarResponse::Result { .. } => Err(anyhow!(
            "unexpected 'result' response for availability request"
        )),
        SidecarResponse::Embedding { .. } => Err(anyhow!(
            "unexpected 'embedding' response for availability request"
        )),
    }
}

/// `embedding` 応答（または `error`・型不一致）を [`EmbeddingOutput`] へ変換する。
///
/// sidecar は要求の `texts` と**同順・同数**のベクトルを返す契約のため、件数と各ベクトルの次元
/// （[`EMBEDDING_DIM`]）を検証してから受け入れる。検証に外れた応答は、後続の BLOB 保存・コサイン
/// 類似度計算が前提を崩さないよう `Err` にする（NFR-V04-005 で検索のみ degrade）。
///
/// # 引数
/// * `response` - 受信済みの応答。
/// * `expected_count` - 要求した `texts` の件数（応答件数の検証に用いる）。
///
/// # 戻り値
/// 検証済みの埋め込みベクトル群、または sidecar エラー・型不一致・件数/次元不一致時のエラー。
fn parse_embedding(response: SidecarResponse, expected_count: usize) -> Result<EmbeddingOutput> {
    match response {
        SidecarResponse::Embedding { vectors } => {
            if vectors.len() != expected_count {
                return Err(anyhow!(
                    "embedding count mismatch: expected {expected_count}, got {}",
                    vectors.len()
                ));
            }
            if let Some(bad) = vectors.iter().find(|v| v.len() != EMBEDDING_DIM) {
                return Err(anyhow!(
                    "embedding dimension mismatch: expected {EMBEDDING_DIM}, got {}",
                    bad.len()
                ));
            }
            Ok(EmbeddingOutput { vectors })
        }
        SidecarResponse::Error { message } => Err(anyhow!("sidecar error: {message}")),
        SidecarResponse::Result { .. } => {
            Err(anyhow!("unexpected 'result' response for embed request"))
        }
        SidecarResponse::Availability { .. } => Err(anyhow!(
            "unexpected 'availability' response for embed request"
        )),
    }
}

/// 連続失敗を1回記録し、閾値超過なら一時停止状態へ遷移させる。
///
/// # 引数
/// * `state` - 共有稼働状態。
fn record_failure(state: &SharedState) {
    let failures = state.consecutive_failures.fetch_add(1, Ordering::SeqCst) + 1;
    if failures > MAX_CONSECUTIVE_FAILURES {
        state.suspended.store(true, Ordering::SeqCst);
        error!(
            "AI backend suspended after {failures} consecutive failures (threshold {MAX_CONSECUTIVE_FAILURES})"
        );
    }
}

/// 一時停止中に届いた要求を、停止理由のエラーで即座に返す。
///
/// # 引数
/// * `cmd` - 拒否する要求。
fn reject_suspended(cmd: ManagerCommand) {
    fail_command(cmd, anyhow!("AI backend is suspended"));
}

/// 任意の要求を共通のエラーで失敗させる（要求種別ごとに oneshot へ `Err` を送る）。
///
/// # 引数
/// * `cmd` - 失敗させる要求。
/// * `err` - 返すエラー。
fn fail_command(cmd: ManagerCommand, err: anyhow::Error) {
    match cmd {
        ManagerCommand::Infer { respond, .. } => {
            let _ = respond.send(Err(err));
        }
        ManagerCommand::Availability { respond } => {
            let _ = respond.send(Err(err));
        }
        ManagerCommand::Embed { respond, .. } => {
            let _ = respond.send(Err(err));
        }
    }
}

/// 1 要求を送信し、対応する1行レスポンスを受け取る（排他的な1往復）。
///
/// stdin に JSON 1 行を書き込み、stdout 行の到着を待つ。`Terminated` / `Error` / チャネル切断は
/// 通信失敗として扱い、呼び出し側（[`run_manager`]）が sidecar 再起動を判断する。応答が
/// [`REQUEST_TIMEOUT_SECS`] 以内に来ない場合もエラーとする。
///
/// 要求 ID が無いプロトコルのため、最初に届いた**パース可能な応答行**を採用する。診断目的の
/// 非 JSON 行は読み飛ばす。期待種別（`expected`）と異なる応答は [`parse_result`] /
/// [`parse_availability`] 側で型不一致エラーになる。
///
/// # 引数
/// * `child` - 稼働中の sidecar プロセス。
/// * `request` - 送信する要求。
/// * `expected` - 期待する応答種別（ログ用途。突合自体は直列処理で担保）。
///
/// # 戻り値
/// パース済みの応答、または通信失敗・タイムアウト時のエラー。
async fn exchange(
    child: &mut dyn SidecarProcessDyn,
    request: &SidecarRequest,
    expected: ExpectedResponse,
) -> Result<SidecarResponse> {
    let mut line = serde_json::to_string(request)?;
    line.push('\n');
    child.write_line(&line)?;

    let timeout = tokio::time::Duration::from_secs(REQUEST_TIMEOUT_SECS);

    tokio::time::timeout(timeout, async {
        loop {
            match child.next_event().await {
                Some(ProcessEvent::Stdout(text)) => {
                    let trimmed = text.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    // 最初にパースできた応答行を採用する。非 JSON 行（診断ログ）は読み飛ばす。
                    match serde_json::from_str::<SidecarResponse>(trimmed) {
                        Ok(resp) => return Ok(resp),
                        Err(e) => {
                            warn!("Ignoring non-JSON sidecar stdout line: {e}");
                            continue;
                        }
                    }
                }
                Some(ProcessEvent::Stderr(text)) => {
                    warn!("AI sidecar stderr: {}", text.trim());
                }
                Some(ProcessEvent::Terminated) => {
                    return Err(anyhow!("AI sidecar terminated before responding"));
                }
                Some(ProcessEvent::Error(e)) => {
                    return Err(anyhow!("AI sidecar error: {e}"));
                }
                None => {
                    return Err(anyhow!("AI sidecar event stream closed"));
                }
            }
        }
    })
    .await
    .map_err(|_| {
        anyhow!(
            "AI sidecar response timed out after {REQUEST_TIMEOUT_SECS}s (expected {expected:?})"
        )
    })?
}

// ===== 本番 transport（tauri-plugin-shell の sidecar） =====

/// `tauri-plugin-shell` の sidecar API を用いる本番 transport。
///
/// `AppHandle` から `externalBin`（[`SIDECAR_NAME`]）を起動する。
struct ShellSidecarTransport<R: tauri::Runtime> {
    /// sidecar 起動に用いるアプリケーションハンドル。
    app: tauri::AppHandle<R>,
}

impl<R: tauri::Runtime> SidecarTransport for ShellSidecarTransport<R> {
    fn spawn(&self) -> Result<Box<dyn SidecarProcessDyn>> {
        use tauri_plugin_shell::ShellExt;
        let command = self
            .app
            .shell()
            .sidecar(SIDECAR_NAME)
            .map_err(|e| anyhow!("failed to resolve AI sidecar '{SIDECAR_NAME}': {e}"))?;
        let (rx, child) = command
            .spawn()
            .map_err(|e| anyhow!("failed to spawn AI sidecar: {e}"))?;
        Ok(Box::new(ShellSidecarProcess {
            rx,
            child: Some(child),
        }))
    }
}

/// `tauri-plugin-shell` の `CommandChild` / イベント Receiver を [`SidecarProcess`] に適合させるラッパ。
struct ShellSidecarProcess {
    /// プロセスイベント受信端。
    rx: Receiver<tauri_plugin_shell::process::CommandEvent>,
    /// stdin 書き込み・kill 用の子プロセスハンドル。drop 時に取り出して停止する。
    child: Option<tauri_plugin_shell::process::CommandChild>,
}

impl SidecarProcess for ShellSidecarProcess {
    fn write_line(&mut self, line: &str) -> Result<()> {
        let child = self
            .child
            .as_mut()
            .ok_or_else(|| anyhow!("AI sidecar already shut down"))?;
        child
            .write(line.as_bytes())
            .map_err(|e| anyhow!("failed to write to AI sidecar stdin: {e}"))
    }

    async fn next_event(&mut self) -> Option<ProcessEvent> {
        use tauri_plugin_shell::process::CommandEvent;
        self.rx.recv().await.map(|event| match event {
            CommandEvent::Stdout(bytes) => {
                ProcessEvent::Stdout(String::from_utf8_lossy(&bytes).into_owned())
            }
            CommandEvent::Stderr(bytes) => {
                ProcessEvent::Stderr(String::from_utf8_lossy(&bytes).into_owned())
            }
            CommandEvent::Terminated(_) => ProcessEvent::Terminated,
            CommandEvent::Error(e) => ProcessEvent::Error(e),
            _ => ProcessEvent::Error("unknown sidecar event".to_string()),
        })
    }
}

impl Drop for ShellSidecarProcess {
    /// プロセス破棄時に sidecar を停止し、アイドル時にプロセスを残さない（NFR-V03-003）。
    ///
    /// `CommandChild::kill` は `self` を消費するため、`Option::take` で取り出してから kill する。
    /// kill に失敗しても本体機能には影響しない（ベストエフォート）。
    fn drop(&mut self) {
        if let Some(child) = self.child.take() {
            if let Err(e) = child.kill() {
                warn!("failed to kill AI sidecar on drop: {e}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    /// モック sidecar の挙動を記述するスクリプト。
    enum MockBehavior {
        /// 与えた応答行を1行返す（実際の sidecar 出力 JSON を渡す）。
        Reply(String),
        /// 応答せずプロセス終了する（異常終了→再起動の検証用）。
        Terminate,
    }

    /// テスト用のモック sidecar プロセス。受信のたびにスクリプト先頭の挙動を消費する。
    struct MockProcess {
        /// 各書き込みに対する挙動キュー（transport と共有）。
        behaviors: Arc<Mutex<VecDeque<MockBehavior>>>,
        /// 次に next_event で返すイベントのキュー。
        pending: VecDeque<ProcessEvent>,
    }

    impl SidecarProcess for MockProcess {
        fn write_line(&mut self, line: &str) -> Result<()> {
            // 送信行が有効な JSON であることを確認（プロトコル整合の最低限の検証）。
            let _: serde_json::Value = serde_json::from_str(line.trim())?;
            match self.behaviors.lock().unwrap().pop_front() {
                Some(MockBehavior::Reply(reply)) => {
                    self.pending.push_back(ProcessEvent::Stdout(reply));
                }
                Some(MockBehavior::Terminate) | None => {
                    self.pending.push_back(ProcessEvent::Terminated);
                }
            }
            Ok(())
        }

        async fn next_event(&mut self) -> Option<ProcessEvent> {
            self.pending.pop_front()
        }
    }

    /// モック transport。spawn 回数を数え、毎回新しい MockProcess を返す。
    struct MockTransport {
        behaviors: Arc<Mutex<VecDeque<MockBehavior>>>,
        spawns: Arc<AtomicU32>,
    }

    impl SidecarTransport for MockTransport {
        fn spawn(&self) -> Result<Box<dyn SidecarProcessDyn>> {
            self.spawns.fetch_add(1, Ordering::SeqCst);
            Ok(Box::new(MockProcess {
                behaviors: Arc::clone(&self.behaviors),
                pending: VecDeque::new(),
            }))
        }
    }

    fn backend_with(script: Vec<MockBehavior>, spawns: Arc<AtomicU32>) -> FoundationModelsBackend {
        FoundationModelsBackend::with_transport(MockTransport {
            behaviors: Arc::new(Mutex::new(VecDeque::from(script))),
            spawns,
        })
    }

    fn sample_input() -> AiAnalysisInput {
        AiAnalysisInput {
            issue_key: "PROJ-1".into(),
            summary: "title".into(),
            description_head: "body".into(),
            status: "open".into(),
            due_date: None,
            lang: "ja".into(),
        }
    }

    /// 1 テキストの埋め込み入力（passage プレフィックス）を作る。
    fn sample_embed_input() -> EmbeddingInput {
        EmbeddingInput {
            texts: vec!["hello".into()],
            prefix: EmbedPrefix::Passage,
        }
    }

    /// `EMBEDDING_DIM` 次元のダミーベクトルを `count` 本含む embedding 応答行を作る。
    fn embedding_reply(count: usize) -> String {
        let vectors: Vec<Vec<f32>> = (0..count).map(|_| vec![0.0_f32; EMBEDDING_DIM]).collect();
        serde_json::to_string(&serde_json::json!({
            "type": "embedding",
            "vectors": vectors,
        }))
        .expect("serialize embedding reply")
    }

    #[tokio::test]
    async fn infer_returns_structured_output() {
        let backend = backend_with(
            vec![MockBehavior::Reply(
                r#"{"type":"result","summary":"s","risk_level":"high","suggestion":"do x"}"#.into(),
            )],
            Arc::new(AtomicU32::new(0)),
        );

        let out = backend.infer(sample_input()).await.expect("infer ok");
        assert_eq!(out.summary, "s");
        assert_eq!(out.risk_level, RiskLevel::High);
        assert_eq!(out.suggestion, "do x");
        assert_eq!(backend.state(), SidecarState::Running);
    }

    #[tokio::test]
    async fn availability_query_succeeds() {
        let backend = backend_with(
            vec![MockBehavior::Reply(
                r#"{"type":"availability","available":false,"reason":"appleIntelligenceNotEnabled"}"#
                    .into(),
            )],
            Arc::new(AtomicU32::new(0)),
        );

        let info = backend.availability().await.expect("availability ok");
        assert!(!info.available);
        assert_eq!(info.reason, "appleIntelligenceNotEnabled");
    }

    #[tokio::test]
    async fn sidecar_error_response_is_propagated_without_restart() {
        // sidecar が error を返した場合: 要求は失敗するが接続は健全 → 再起動せず1回のみ spawn。
        let spawns = Arc::new(AtomicU32::new(0));
        let backend = backend_with(
            vec![
                MockBehavior::Reply(r#"{"type":"error","message":"generation failed"}"#.into()),
                MockBehavior::Reply(
                    r#"{"type":"result","summary":"ok","risk_level":"low","suggestion":"y"}"#
                        .into(),
                ),
            ],
            Arc::clone(&spawns),
        );

        assert!(backend.infer(sample_input()).await.is_err());
        let out = backend.infer(sample_input()).await.expect("second ok");
        assert_eq!(out.summary, "ok");
        // error 応答は通信成立とみなすため再起動しない（spawn は1回のみ）。
        assert_eq!(spawns.load(Ordering::SeqCst), 1);
        assert_eq!(backend.state(), SidecarState::Running);
    }

    #[tokio::test]
    async fn restarts_after_termination() {
        // 1回目: 終了（応答なし）→ 失敗。2回目: 正常応答 → 成功。spawn は2回起きる。
        let spawns = Arc::new(AtomicU32::new(0));
        let backend = backend_with(
            vec![
                MockBehavior::Terminate,
                MockBehavior::Reply(
                    r#"{"type":"result","summary":"s2","risk_level":"low","suggestion":"y"}"#
                        .into(),
                ),
            ],
            Arc::clone(&spawns),
        );

        assert!(backend.infer(sample_input()).await.is_err());
        let out = backend.infer(sample_input()).await.expect("second ok");
        assert_eq!(out.summary, "s2");
        assert_eq!(spawns.load(Ordering::SeqCst), 2, "sidecar should restart");
    }

    #[tokio::test]
    async fn suspends_after_consecutive_failures() {
        // すべて終了させて連続失敗を積み上げる。閾値超過で Suspended になる。
        let script: Vec<MockBehavior> = (0..(MAX_CONSECUTIVE_FAILURES + 1))
            .map(|_| MockBehavior::Terminate)
            .collect();
        let backend = backend_with(script, Arc::new(AtomicU32::new(0)));

        for _ in 0..(MAX_CONSECUTIVE_FAILURES + 1) {
            let _ = backend.infer(sample_input()).await;
        }
        assert_eq!(backend.state(), SidecarState::Suspended);

        // 一時停止中は即エラー、resume で復帰。
        assert!(backend.infer(sample_input()).await.is_err());
        backend.resume();
        assert_eq!(backend.state(), SidecarState::Running);
    }

    #[test]
    fn analyze_request_serializes_to_sidecar_contract() {
        // Rust → sidecar の analyze 行が Swift 側 CodingKeys（snake_case + type）と一致するか。
        let req = SidecarRequest::analyze(sample_input());
        let json = serde_json::to_string(&req).expect("serialize");
        assert!(json.contains(r#""type":"analyze""#));
        assert!(json.contains(r#""issue_key":"PROJ-1""#));
        assert!(json.contains(r#""description_head":"body""#));
        // due_date は None なので省略される。
        assert!(!json.contains("due_date"));
    }

    #[test]
    fn parse_result_rejects_wrong_type() {
        // availability 応答を result として解釈しようとすると型不一致エラー。
        let resp = SidecarResponse::Availability {
            available: true,
            reason: "available".into(),
        };
        assert!(parse_result(resp).is_err());
    }

    #[tokio::test]
    async fn embed_returns_vectors() {
        // embed 要求 → embedding 応答（512 次元 × 1 本）を受け取り、同順・同数で返ること。
        let backend = backend_with(
            vec![MockBehavior::Reply(embedding_reply(1))],
            Arc::new(AtomicU32::new(0)),
        );

        let out = backend.embed(sample_embed_input()).await.expect("embed ok");
        assert_eq!(out.vectors.len(), 1);
        assert_eq!(out.vectors[0].len(), EMBEDDING_DIM);
        assert_eq!(backend.state(), SidecarState::Running);
    }

    #[tokio::test]
    async fn embed_request_serializes_to_sidecar_contract() {
        // Rust → sidecar の embed 行が Swift 側契約（type/texts/prefix・prefix は小文字）と一致するか。
        let req = SidecarRequest::embed(EmbeddingInput {
            texts: vec!["a".into(), "b".into()],
            prefix: EmbedPrefix::Query,
        });
        let json = serde_json::to_string(&req).expect("serialize");
        assert!(json.contains(r#""type":"embed""#));
        assert!(json.contains(r#""texts":["a","b"]"#));
        // EmbedPrefix は lowercase serde のため "query" / "passage" になる（sidecar の rawValue と一致）。
        assert!(json.contains(r#""prefix":"query""#));
    }

    #[tokio::test]
    async fn embed_rejects_dimension_mismatch() {
        // 次元が EMBEDDING_DIM と異なる応答は Err（BLOB 保存・類似度計算の前提を守る）。
        // 通信自体は成立しているため再起動はしない（spawn は1回）。
        let spawns = Arc::new(AtomicU32::new(0));
        let backend = backend_with(
            vec![MockBehavior::Reply(
                r#"{"type":"embedding","vectors":[[0.1,0.2,0.3]]}"#.into(),
            )],
            Arc::clone(&spawns),
        );

        assert!(backend.embed(sample_embed_input()).await.is_err());
        assert_eq!(spawns.load(Ordering::SeqCst), 1);
        assert_eq!(backend.state(), SidecarState::Running);
    }

    #[tokio::test]
    async fn embed_rejects_count_mismatch() {
        // 要求 1 件に対し 2 本のベクトルが返ったら件数不一致で Err。
        let backend = backend_with(
            vec![MockBehavior::Reply(embedding_reply(2))],
            Arc::new(AtomicU32::new(0)),
        );
        assert!(backend.embed(sample_embed_input()).await.is_err());
    }

    #[tokio::test]
    async fn embed_error_response_is_propagated_without_restart() {
        // sidecar が error（モデル未同梱等）を返した場合: 要求は失敗するが接続は健全 → 再起動しない。
        let spawns = Arc::new(AtomicU32::new(0));
        let backend = backend_with(
            vec![
                MockBehavior::Reply(
                    r#"{"type":"error","message":"embedding model not bundled"}"#.into(),
                ),
                MockBehavior::Reply(embedding_reply(1)),
            ],
            Arc::clone(&spawns),
        );

        assert!(backend.embed(sample_embed_input()).await.is_err());
        let out = backend
            .embed(sample_embed_input())
            .await
            .expect("second ok");
        assert_eq!(out.vectors.len(), 1);
        // error 応答は通信成立とみなすため再起動しない（spawn は1回のみ）。
        assert_eq!(spawns.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn embed_restarts_after_termination() {
        // 1回目: 終了（応答なし）→ 失敗。2回目: 正常応答 → 成功。spawn は2回起きる。
        let spawns = Arc::new(AtomicU32::new(0));
        let backend = backend_with(
            vec![
                MockBehavior::Terminate,
                MockBehavior::Reply(embedding_reply(1)),
            ],
            Arc::clone(&spawns),
        );

        assert!(backend.embed(sample_embed_input()).await.is_err());
        let out = backend
            .embed(sample_embed_input())
            .await
            .expect("second ok");
        assert_eq!(out.vectors.len(), 1);
        assert_eq!(spawns.load(Ordering::SeqCst), 2, "sidecar should restart");
    }

    #[tokio::test]
    async fn embed_suspends_after_consecutive_failures() {
        // embed をすべて終了させて連続失敗を積み上げる。閾値超過で Suspended になり以降は即エラー。
        let script: Vec<MockBehavior> = (0..(MAX_CONSECUTIVE_FAILURES + 1))
            .map(|_| MockBehavior::Terminate)
            .collect();
        let backend = backend_with(script, Arc::new(AtomicU32::new(0)));

        for _ in 0..(MAX_CONSECUTIVE_FAILURES + 1) {
            let _ = backend.embed(sample_embed_input()).await;
        }
        assert_eq!(backend.state(), SidecarState::Suspended);

        // 一時停止中は即エラー、resume で復帰。
        assert!(backend.embed(sample_embed_input()).await.is_err());
        backend.resume();
        assert_eq!(backend.state(), SidecarState::Running);
    }

    #[tokio::test]
    async fn analyze_and_embed_share_one_sidecar() {
        // analyze と embed が同一 sidecar プロセスを共用すること（spawn は1回のみ）。
        let spawns = Arc::new(AtomicU32::new(0));
        let backend = backend_with(
            vec![
                MockBehavior::Reply(
                    r#"{"type":"result","summary":"s","risk_level":"low","suggestion":"y"}"#.into(),
                ),
                MockBehavior::Reply(embedding_reply(1)),
            ],
            Arc::clone(&spawns),
        );

        backend.infer(sample_input()).await.expect("infer ok");
        backend.embed(sample_embed_input()).await.expect("embed ok");
        assert_eq!(
            spawns.load(Ordering::SeqCst),
            1,
            "analyze and embed reuse one sidecar"
        );
    }

    #[test]
    fn embed_backend_reports_dim_and_model_name() {
        // EmbeddingBackend の dim / model_name が DB 保存の前提（512 / モデル名）と一致すること。
        let backend = backend_with(vec![], Arc::new(AtomicU32::new(0)));
        assert_eq!(EmbeddingBackend::dim(&backend), EMBEDDING_DIM);
        assert_eq!(EmbeddingBackend::model_name(&backend), EMBEDDING_MODEL_NAME);
    }
}
