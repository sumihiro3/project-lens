//! バックグラウンド埋め込みワーカー（v0.4 / FR-V04-001・FR-V04-004）
//!
//! `job_queue` から [`JOB_TYPE_EMBED`] ジョブを **同時1件** ずつ取り出し、対象課題の
//! 埋め込み入力テキスト（タイトル＋本文＋コメント。SQL 側で切り詰め済み）を組み立てて
//! [`source_hash`](compute_source_hash) を計算し、既存の `source_hash` と一致すれば再埋め込みを
//! スキップ（FR-V04-004）、変化していれば [`EmbeddingBackend`] で `passage:` プレフィックス付きの
//! 埋め込みを生成して `issue_embeddings` へ BLOB 保存し、ジョブを `done`（失敗が上限を超えたら
//! `failed`）へ遷移させる。
//!
//! # 設計方針
//! - **summarize ワーカーとは独立タスク**: 要約・リスク判定ワーカー（[`crate::ai::worker`]）とは
//!   別の非同期タスクで動く（[`init`]）。両ワーカーは同じ `job_queue` を `job_type` で区別して
//!   消費し、互いの処理を阻害しない（NFR-V04-005）。埋め込み生成は本体機能・summarize・v0.3 AI を
//!   一切ブロックしない。
//! - **同時1件**: 毎回 `limit=1` で取り出し、キューが空になるまで（上限内で）直列に処理する。
//!   sidecar 側の管理タスクで推論／埋め込みは直列化されるため、同時実行は構造的に1件に保たれる
//!   （NFR-V04-003 のメモリ常駐抑制）。
//! - **アイドル**: AI 機能 OFF（`settings.ai_enabled != "true"`）または可用性なし（埋め込み失敗）、
//!   キュー空のときは埋め込みを行わずアイドルする。アイドル時は sidecar を起こさない
//!   （NFR-V04-003）。
//! - **再埋め込みポリシー（FR-V04-004 / 未解決事項#5）**: 入力テキストの [`source_hash`] が
//!   保存済みハッシュと一致すれば本文・コメントに変更が無いとみなして埋め込みをスキップし、
//!   ジョブを `done` にする。変化していれば再生成する。モデル更新時の再生成は
//!   `issue_embeddings.model` 比較で将来対応する余地を残す（本ワーカーは未実装）。
//! - **リトライと記録**: 埋め込み失敗時は [`MAX_JOB_RETRIES`] 回までリトライし、上限を超えたジョブは
//!   `failed` にしてスキップを警告ログに記録する。失敗1件で全体は止めない（NFR-V04-005）。
//!
//! # 検証可能性
//! 埋め込みバックエンドは [`EmbeddingBackend`] トレイトで抽象化されているため、ジョブ消費ループの
//! ロジック（取得→ハッシュ判定→埋め込み→保存→状態遷移→リトライ）は、モックバックエンドと
//! in-memory SQLite で実機なしに検証できる。

use super::embedding::{
    create_embedding_backend, EmbedPrefix, EmbeddingBackend, EmbeddingBackendKind, EmbeddingInput,
};
use super::worker::{JOB_TYPE_EMBED, MAX_JOB_RETRIES, SETTING_AI_ENABLED};
use crate::db::DbClient;
use anyhow::{anyhow, Result};
use log::{debug, error, info, warn};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// 埋め込み元テキストの本文（description）切り詰め最大文字数。
///
/// `get_issue_embed_text` の `body_max` 引数に渡す。タイトル＋本文＋コメントを結合した最終テキストの
/// 上限は埋め込みバックエンド側（[`crate::ai::embedding::EMBED_SOURCE_MAX_CHARS`]）でも担保されるが、
/// 本文が極端に長い課題で1セクションが結合テキストを占有しないよう、SQL 側でも本文を切り詰める。
const EMBED_BODY_MAX_CHARS: i64 = 1500;

/// 埋め込み元テキストのコメント結合後の切り詰め最大文字数。
///
/// `get_issue_embed_text` の `comment_max` 引数に渡す。コメント群を結合した後にこの文字数で切り詰める。
const EMBED_COMMENT_MAX_CHARS: i64 = 1500;

/// 1回のドレインで処理するジョブの上限件数（暴走防止の安全弁）。
///
/// 1ポーリングでキュー全体を処理しつつ、異常時に無限ループへ陥らないための上限。
/// summarize ワーカーと同じ値で揃える。
const MAX_JOBS_PER_DRAIN: i64 = 500;

/// アイドル時・ドレイン後のポーリング間隔（秒）。
///
/// 取りこぼし防止・定期実行の保険として一定間隔でキューを確認する。summarize ワーカーと
/// 同じ間隔（30 秒）に揃え、空ポーリングの増加を抑える。
const POLL_INTERVAL_SECS: u64 = 30;

/// バックグラウンド埋め込みワーカーを起動する（FR-V04-001・FR-V04-004）。
///
/// DB 準備完了後（[`crate::run`] のセットアップ）に呼び出し、専用の非同期タスクで
/// [`POLL_INTERVAL_SECS`] ごとにキューをドレインするループを回す。`sync`・UI をブロックしない。
/// AI 機能 OFF・可用性なし・キュー空のときは埋め込みせずアイドルする。
///
/// # 引数
/// * `app` - Tauri アプリケーションハンドル（DB 状態・sidecar 起動に用いる）。
pub fn init(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // バックエンドは1度だけ生成して再利用する（管理タスク・sidecar をループ間で共有）。
        // 生成は [`create_embedding_backend`] レジストリ経由（v0.4 は OS 組み込み NLContextual に解決）。
        // 生成失敗（AI 非対応環境等）でも本体・summarize・v0.3 AI は阻害しないため、生成を別タスク化
        // せずポーリングループ側で「バックエンドが無ければアイドル」で吸収する。
        match create_embedding_backend(app.clone(), EmbeddingBackendKind::AppleNLContextual) {
            Ok(backend) => run_loop(app, backend).await,
            Err(e) => {
                warn!("Embed worker: backend unavailable at startup ({e}). Worker will not run.")
            }
        }
    });
}

/// ポーリングループ本体（バックエンドはトレイトで抽象化。テスト容易性のため分離）。
///
/// [`POLL_INTERVAL_SECS`] ごとに、AI 機能が有効なときだけキューをドレインする。OFF・キュー空の
/// ときはアイドルする（NFR-V04-003）。
///
/// # 引数
/// * `app` - DB 状態に用いるアプリケーションハンドル。
/// * `backend` - 埋め込みバックエンド（同時1件はバックエンドの管理タスク側で担保）。
async fn run_loop<B: EmbeddingBackend>(app: AppHandle, backend: B) {
    let mut interval = tokio::time::interval(Duration::from_secs(POLL_INTERVAL_SECS));
    loop {
        interval.tick().await;

        if !is_ai_enabled(&app).await {
            debug!("Embed worker: disabled, idling.");
            continue;
        }

        let db = app.state::<DbClient>();
        match drain_queue(&db, &backend).await {
            Ok(0) => debug!("Embed worker: queue empty, idling."),
            Ok(processed) => info!("Embed worker: processed {processed} embed job(s)."),
            Err(e) => error!("Embed worker: drain failed: {e}"),
        }
    }
}

/// AI 機能が有効かを判定する（`settings.ai_enabled == "true"`）。
///
/// 設定取得自体が失敗しても OFF 扱いにして本体を阻害しない（非阻害方針）。summarize ワーカーと
/// 同じ設定キー（[`SETTING_AI_ENABLED`]）を参照し、トグル1つで両ワーカーが連動する。
///
/// # 引数
/// * `app` - DB 状態を引くためのアプリケーションハンドル。
///
/// # 戻り値
/// AI 機能が有効なら `true`、無効・未設定・取得失敗なら `false`。
async fn is_ai_enabled(app: &AppHandle) -> bool {
    let db = app.state::<DbClient>();
    matches!(db.get_setting(SETTING_AI_ENABLED).await, Ok(Some(v)) if v == "true")
}

/// [`JOB_TYPE_EMBED`] の `pending` ジョブをキューが空になるまで（上限内で）処理する。
///
/// 1件ずつ取り出して [`process_job`] へ委譲し、処理した件数を返す。`get_pending_jobs` は種別を問わず
/// 古い順に返すため、本ワーカーは `job_type != embed` のジョブには触れず（summarize ワーカーへ委ねる）
/// スキップする。1件の処理失敗で全体は止めず、当該ジョブを `failed`（リトライ上限超過時）にした
/// うえで次のジョブへ進む（NFR-V04-005）。
///
/// # 引数
/// * `db` - DB クライアント。
/// * `backend` - 埋め込みに用いる [`EmbeddingBackend`] バックエンド。
///
/// # 戻り値
/// 埋め込み処理を試みたジョブ件数（成功・失敗・スキップ判定を問わない）、または DB アクセス失敗時の
/// エラー。
async fn drain_queue<B: EmbeddingBackend>(db: &DbClient, backend: &B) -> Result<usize> {
    let mut processed = 0usize;

    // 同時1件: 毎回 limit=1 で取り出し、空になるまで（上限内で）繰り返す。
    // embed ジョブのみを対象にする（summarize ジョブは summarize ワーカーが処理する）。
    // get_pending_jobs が job_type で絞るため、ここでは種別チェック不要で横取り・starve が起きない。
    for _ in 0..MAX_JOBS_PER_DRAIN {
        let jobs = db.get_pending_jobs(JOB_TYPE_EMBED, 1).await?;
        let Some(job) = jobs.into_iter().next() else {
            break; // キューが空。
        };

        // 二重処理を避けるため、まず 'processing' へ遷移させる。
        if let Err(e) = db.update_job_status(job.id, "processing").await {
            error!(
                "Embed worker: failed to mark job {} processing: {e}",
                job.id
            );
            break; // DB 書き込み不能。これ以上進めても無駄なので抜ける。
        }

        process_job(db, backend, &job).await;
        processed += 1;
    }

    Ok(processed)
}

/// 埋め込みジョブ1件を処理する（取得→ハッシュ判定→埋め込み→保存→状態遷移）。
///
/// 入力テキストの [`source_hash`](compute_source_hash) が保存済みハッシュと一致すれば再埋め込みを
/// スキップしてジョブを `done` にする（FR-V04-004）。変化していれば [`MAX_JOB_RETRIES`] 回まで
/// リトライしながら `passage:` プレフィックス付きの埋め込みを生成し、`issue_embeddings` へ保存して
/// ジョブを `done` にする。対象課題が見つからない・全リトライ失敗の場合はジョブを `failed` にして
/// スキップを記録する（NFR-V04-005）。本体は止めない。
///
/// # 引数
/// * `db` - DB クライアント。
/// * `backend` - 埋め込みバックエンド。
/// * `job` - 処理対象のジョブ（`processing` へ遷移済み）。
async fn process_job<B: EmbeddingBackend>(db: &DbClient, backend: &B, job: &crate::db::AiJob) {
    // 1. 埋め込み元テキスト（タイトル＋本文＋コメント。SQL 側で切り詰め済み）を取得。
    let source_text = match db
        .get_issue_embed_text(
            job.workspace_id,
            job.issue_id,
            EMBED_BODY_MAX_CHARS,
            EMBED_COMMENT_MAX_CHARS,
        )
        .await
    {
        Ok(Some(text)) => text,
        Ok(None) => {
            // 対象課題が削除済み等で見つからない。スキップして failed 記録。
            warn!(
                "Embed worker: issue (ws={}, id={}) not found. Marking job {} failed.",
                job.workspace_id, job.issue_id, job.id
            );
            mark_failed(db, job.id).await;
            return;
        }
        Err(e) => {
            warn!(
                "Embed worker: failed to load embed text for job {} (ws={}, id={}): {e}. Marking failed.",
                job.id, job.workspace_id, job.issue_id
            );
            mark_failed(db, job.id).await;
            return;
        }
    };

    // 2. source_hash を計算し、保存済みハッシュと一致するなら再埋め込みをスキップ（FR-V04-004）。
    let source_hash = compute_source_hash(&source_text);
    match db
        .get_embedding_source_hash(job.workspace_id, job.issue_id)
        .await
    {
        Ok(Some(stored)) if stored == source_hash => {
            // 本文・コメントに変更なし。埋め込みを生成せずに done（sidecar も起こさない）。
            debug!(
                "Embed worker: source_hash unchanged for (ws={}, id={}). Skipping re-embed (job {} done).",
                job.workspace_id, job.issue_id, job.id
            );
            mark_done(db, job.id).await;
            return;
        }
        Ok(_) => {} // 未生成またはハッシュ変化 → 埋め込みへ進む。
        Err(e) => {
            // ハッシュ取得失敗は致命ではない。安全側として再埋め込みへ進む（処理は継続）。
            warn!(
                "Embed worker: source_hash lookup failed for (ws={}, id={}): {e}. Proceeding to embed.",
                job.workspace_id, job.issue_id
            );
        }
    }

    // 3. passage プレフィックス付きでリトライしながら埋め込みを生成する（コーパス文として埋め込む）。
    let vector = match embed_with_retry(backend, &source_text).await {
        Ok(v) => v,
        Err(e) => {
            // 全リトライ失敗。可用性なし環境もここに落ち、検索機能のみ degrade する（NFR-V04-005）。
            warn!(
                "Embed worker: embedding failed for (ws={}, id={}) after {} attempt(s): {e}. Skipping (job {} failed).",
                job.workspace_id, job.issue_id, MAX_JOB_RETRIES, job.id
            );
            mark_failed(db, job.id).await;
            return;
        }
    };

    // 4. 次元検証: バックエンドの想定次元と一致しなければ保存しない（破損ベクトルの混入防止）。
    if vector.len() != backend.dim() {
        warn!(
            "Embed worker: dimension mismatch for (ws={}, id={}): got {}, expected {}. Marking job {} failed.",
            job.workspace_id, job.issue_id, vector.len(), backend.dim(), job.id
        );
        mark_failed(db, job.id).await;
        return;
    }

    // 5. issue_embeddings へ保存（課題単位 UPSERT。BLOB へ変換）。
    if let Err(e) = db
        .save_embedding(
            job.workspace_id,
            job.issue_id,
            // 保存するモデル名は「実際にベクトルを生成したバックエンド」を単一の真実源とする
            // （再埋め込み判定の正確性。FR-V04-004）。
            backend.model_name(),
            vector.len() as i64,
            &vector,
            &source_hash,
        )
        .await
    {
        error!(
            "Embed worker: failed to save embedding for (ws={}, id={}): {e}",
            job.workspace_id, job.issue_id
        );
        mark_failed(db, job.id).await;
        return;
    }

    // 6. ジョブを done に遷移。
    if let Err(e) = db.update_job_status(job.id, "done").await {
        error!("Embed worker: failed to mark job {} done: {e}", job.id);
    } else {
        debug!(
            "Embed worker: job {} done (ws={}, id={}).",
            job.id, job.workspace_id, job.issue_id
        );
    }
}

/// 埋め込みをリトライ付きで実行する（NFR-V04-005）。
///
/// 最大 [`MAX_JOB_RETRIES`] 回 `embed` を試行し、最初に成功した結果（先頭ベクトル）を返す。
/// すべて失敗したら最後のエラーを返す。バックエンドが一時停止（連続失敗超過）に至った場合は即エラーに
/// なるため、このリトライは無駄に長引かない。入力は単一テキスト・`passage:` プレフィックスで固定する。
///
/// # 引数
/// * `backend` - 埋め込みバックエンド。
/// * `source_text` - 埋め込み元テキスト（プレフィックス未付与。付与は `embed` 側の責務）。
///
/// # 戻り値
/// 埋め込みベクトル、または全試行失敗時の最後のエラー（出力が空の場合のエラーを含む）。
async fn embed_with_retry<B: EmbeddingBackend>(backend: &B, source_text: &str) -> Result<Vec<f32>> {
    let mut last_err = anyhow!("no embedding attempted");
    for attempt in 1..=MAX_JOB_RETRIES {
        let input = EmbeddingInput {
            texts: vec![source_text.to_string()],
            prefix: EmbedPrefix::Passage,
        };
        match backend.embed(input).await {
            Ok(out) => match out.vectors.into_iter().next() {
                Some(v) => return Ok(v),
                None => last_err = anyhow!("embedding backend returned no vectors"),
            },
            Err(e) => {
                warn!("Embed worker: embed attempt {attempt}/{MAX_JOB_RETRIES} failed: {e}");
                last_err = e;
            }
        }
    }
    Err(last_err)
}

/// 埋め込み元テキストから再埋め込み判定用のハッシュ文字列を計算する（FR-V04-004 / 未解決事項#5）。
///
/// 暗号学的な強度は不要で、本文・コメント変更の検知（同一テキスト → 同一ハッシュ）だけが要件のため、
/// 追加依存を増やさず標準ライブラリの [`DefaultHasher`]（SipHash 1-3）を用いる。SipHash の鍵は std で
/// 固定されており同一バイナリ内・実行間で安定するため、「保存済みハッシュ vs 今回のハッシュ」の
/// 一致判定に十分（両者を同じバイナリで計算するため衝突確率も無視できる）。EMBEDDING_DIM の変化のような
/// モデル差し替えは `issue_embeddings.model` 側で別途扱う。
///
/// `pub(crate)` に昇格しており、背景要約キャッシュ（FR-V045-004）でも同一の SipHash 方式を
/// 再利用できる（`crate::ai::embed_worker::compute_source_hash` で参照）。
///
/// # 引数
/// * `source_text` - ハッシュ対象テキスト（埋め込み用途はタイトル＋本文＋コメント結合、
///   背景要約用途はコメント本文結合）。
///
/// # 戻り値
/// 16進数文字列のハッシュ（`source_hash` カラムへ保存する）。
pub(crate) fn compute_source_hash(source_text: &str) -> String {
    let mut hasher = DefaultHasher::new();
    source_text.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// ジョブを `done` に遷移させる。
///
/// 状態遷移自体に失敗してもログのみ残して本体は止めない。
///
/// # 引数
/// * `db` - DB クライアント。
/// * `job_id` - 対象ジョブID。
async fn mark_done(db: &DbClient, job_id: i64) {
    if let Err(e) = db.update_job_status(job_id, "done").await {
        error!("Embed worker: failed to mark job {job_id} done: {e}");
    }
}

/// ジョブを `failed` に遷移させる（スキップ記録）。
///
/// 状態遷移自体に失敗してもログのみ残して本体は止めない。
///
/// # 引数
/// * `db` - DB クライアント。
/// * `job_id` - 対象ジョブID。
async fn mark_failed(db: &DbClient, job_id: i64) {
    if let Err(e) = db.update_job_status(job_id, "failed").await {
        error!("Embed worker: failed to mark job {job_id} failed: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::embedding::{EmbeddingInput, EmbeddingOutput, EMBEDDING_DIM};
    use sqlx::sqlite::SqliteConnectOptions;
    use std::str::FromStr;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    /// 呼び出し回数を数え、固定次元の決定的ベクトルを返すモック埋め込みバックエンド。
    ///
    /// `embed` 呼び出しのたびに `calls` を加算する。これにより「source_hash 不変のときに
    /// 埋め込みが呼ばれないこと（スキップ）」を呼び出し回数で検証できる。
    struct CountingEmbeddingBackend {
        calls: Arc<AtomicU32>,
        dim: usize,
    }

    impl EmbeddingBackend for CountingEmbeddingBackend {
        async fn embed(&self, input: EmbeddingInput) -> Result<EmbeddingOutput> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            // 入力テキスト数ぶん、dim 次元の決定的ベクトル（全要素 0.5）を返す。
            let vectors = input
                .texts
                .iter()
                .map(|_| vec![0.5_f32; self.dim])
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

    /// in-memory SQLite を用いてマイグレーション済みの [`DbClient`] を生成する。
    async fn new_test_db() -> DbClient {
        let options = SqliteConnectOptions::from_str("sqlite::memory:").unwrap();
        let db = DbClient::new_with_options(options).await.unwrap();
        db.migrate().await.unwrap();
        db
    }

    /// 単一の embed ジョブを処理する `drain_queue` のヘルパ。処理件数を返す。
    async fn drain<B: EmbeddingBackend>(db: &DbClient, backend: &B) -> usize {
        drain_queue(db, backend).await.expect("drain ok")
    }

    #[tokio::test]
    async fn consumes_embed_job_saves_vector_then_skips_on_unchanged_hash() {
        let db = new_test_db().await;
        db.insert_test_issue(1, 100, "タイトル", "本文です").await;

        let calls = Arc::new(AtomicU32::new(0));
        let backend = CountingEmbeddingBackend {
            calls: Arc::clone(&calls),
            dim: EMBEDDING_DIM,
        };

        // embed ジョブを投入。
        db.enqueue_jobs(1, &[100], JOB_TYPE_EMBED).await.unwrap();

        // 1回目のドレイン: 埋め込みを生成して保存し、ジョブを done にする。
        let processed = drain(&db, &backend).await;
        assert_eq!(processed, 1, "1件の embed ジョブを処理する");
        assert_eq!(calls.load(Ordering::SeqCst), 1, "埋め込みが1回呼ばれる");
        assert_eq!(
            db.count_pending_jobs().await.unwrap(),
            0,
            "キューが空になる"
        );

        // ベクトルが保存されている（モックは全要素 0.5、EMBEDDING_DIM 次元）。
        let saved = db.get_embedding(1, 100).await.unwrap();
        assert_eq!(saved, Some(vec![0.5_f32; EMBEDDING_DIM]));

        // source_hash が保存され、入力テキストのハッシュと一致する。
        let text = db
            .get_issue_embed_text(1, 100, EMBED_BODY_MAX_CHARS, EMBED_COMMENT_MAX_CHARS)
            .await
            .unwrap()
            .unwrap();
        let stored_hash = db.get_embedding_source_hash(1, 100).await.unwrap();
        assert_eq!(
            stored_hash.as_deref(),
            Some(compute_source_hash(&text).as_str())
        );

        // 2回目: 同じ課題で再度 embed ジョブを投入してドレインしても、source_hash が不変なので
        // 埋め込みは呼ばれず（calls 据え置き）、ジョブは done になる（再埋め込みスキップ。FR-V04-004）。
        db.enqueue_jobs(1, &[100], JOB_TYPE_EMBED).await.unwrap();
        let processed2 = drain(&db, &backend).await;
        assert_eq!(processed2, 1, "ジョブ自体は処理（done）される");
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "source_hash 不変なので埋め込みは再実行されない"
        );
        assert_eq!(
            db.count_pending_jobs().await.unwrap(),
            0,
            "キューが空になる"
        );
    }

    #[tokio::test]
    async fn missing_issue_marks_job_failed() {
        let db = new_test_db().await;
        let calls = Arc::new(AtomicU32::new(0));
        let backend = CountingEmbeddingBackend {
            calls: Arc::clone(&calls),
            dim: EMBEDDING_DIM,
        };

        // ワークスペースだけ用意し、存在しない課題 ID の embed ジョブを投入する。
        db.insert_test_issue(1, 100, "存在する", "本文").await;
        db.enqueue_jobs(1, &[999], JOB_TYPE_EMBED).await.unwrap();

        let processed = drain(&db, &backend).await;
        assert_eq!(processed, 1);
        assert_eq!(
            calls.load(Ordering::SeqCst),
            0,
            "課題が無いので埋め込みは呼ばれない"
        );
        // 埋め込みは保存されず、ジョブは failed（pending には残らない）。
        assert_eq!(db.get_embedding(1, 999).await.unwrap(), None);
        assert_eq!(db.count_pending_jobs().await.unwrap(), 0);
    }

    #[tokio::test]
    async fn changed_text_triggers_re_embed() {
        let db = new_test_db().await;
        let calls = Arc::new(AtomicU32::new(0));
        let backend = CountingEmbeddingBackend {
            calls: Arc::clone(&calls),
            dim: EMBEDDING_DIM,
        };

        db.insert_test_issue(1, 100, "タイトルA", "本文").await;
        db.enqueue_jobs(1, &[100], JOB_TYPE_EMBED).await.unwrap();
        drain(&db, &backend).await;
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        // タイトルを変更して再度ジョブ投入 → source_hash が変わるので再埋め込みされる。
        db.insert_test_issue(1, 100, "タイトルB", "本文").await;
        db.enqueue_jobs(1, &[100], JOB_TYPE_EMBED).await.unwrap();
        drain(&db, &backend).await;
        assert_eq!(
            calls.load(Ordering::SeqCst),
            2,
            "テキスト変更で再埋め込みされる"
        );
    }

    #[test]
    fn source_hash_is_deterministic_and_sensitive() {
        // 同一入力は同一ハッシュ、別入力は別ハッシュ（変更検知の最小要件）。
        let a = compute_source_hash("タイトル\n本文");
        let b = compute_source_hash("タイトル\n本文");
        let c = compute_source_hash("タイトル\n別本文");
        assert_eq!(a, b);
        assert_ne!(a, c);
        // 16桁の16進文字列であること。
        assert_eq!(a.len(), 16);
        assert!(a.chars().all(|ch| ch.is_ascii_hexdigit()));
    }
}
