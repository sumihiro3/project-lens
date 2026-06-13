//! バックグラウンドAIワーカー（FR-V03-004 / FR-V03-005）
//!
//! `job_queue` から `pending` ジョブを **同時1件** ずつ取り出し、対象課題を DB から取得して
//! [`AiAnalysisInput`] に整形 → [`LlmInference`] バックエンドで推論 → SQL 算出の遅延日数を付与して
//! `ai_results` に保存し、ジョブを `done`（失敗が上限を超えたら `failed`）へ遷移させる。
//!
//! # 設計方針
//! - **非阻害・独立タスク**: ワーカーは `sync`・UI 操作をブロックしないよう専用の非同期タスクで動く
//!   ([`init`])。推論はバックエンド側の管理タスクで直列化されるため、同時推論は構造的に1件に保たれる
//!   （NFR-V03-003）。
//! - **アイドル**: AI 機能 OFF（`settings.ai_enabled != "true"`）または可用性なしのときは推論を行わず、
//!   キューにも触れずにアイドルする。キューが空のときも次のポーリングまでアイドルする
//!   （アイドル時 sidecar 非消費。NFR-V03-003）。
//! - **リトライと記録**: 生成失敗時は [`MAX_JOB_RETRIES`] 回までリトライし、上限を超えたジョブは
//!   `failed` にしてスキップを警告ログに記録する（FR-V03-005）。失敗1件で全体は止めない。
//! - **遅延日数は SQL 算出**: 遅延日数・期限切れ判定は LLM 出力に含めず、
//!   [`DbClient::get_issue_delay_days`] の SQL 算出値を `ai_results.delay_days` に保存する。
//! - **出力言語は UI 言語に追従**: `settings.language`（既定 `ja`）を入力 `lang` に渡す（FR-V03-005）。
//!   言語切替時に既存結果は再生成せず、次回処理分から反映される。
//! - **完了通知**: 1回のドレイン（キューを空になるまで処理）で1件以上処理したら、フロントへ
//!   リフレッシュイベント（[`REFRESH_EVENT`]）を emit して UI を更新させる。
//!
//! # 検証可能性
//! 推論バックエンドは [`LlmInference`] トレイトで抽象化されているため、ジョブ消費ループのロジック
//! （取得→整形→推論→保存→状態遷移→リトライ）は、モックバックエンドと in-memory SQLite で実機なしに
//! 検証できる。

use super::{
    create_backend, AiAnalysisInput, BackendKind, LlmInference, RiskLevel, CONTEXT_BODY_MAX_CHARS,
};
use crate::db::{AiResult, DbClient};
use anyhow::{anyhow, Result};
use log::{debug, error, info, warn};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// AI 機能の有効・無効を保持する設定キー（`settings` テーブル）。
///
/// 値が `"true"` のときのみ AI 処理を行う。未設定・それ以外は OFF とみなしてアイドルする
/// （FR-V03-003 のオン/オフトグルが書き込む想定。設定 UI は後続項目）。
pub const SETTING_AI_ENABLED: &str = "ai_enabled";

/// 出力言語を保持する設定キー（`settings` テーブル）。既定は [`DEFAULT_LANG`]。
const SETTING_LANGUAGE: &str = "language";

/// 出力言語の既定値（UI 言語未設定時）。
const DEFAULT_LANG: &str = "ja";

/// ジョブ種別の既定値（`job_queue.job_type`）。1行要約 + リスク + 提案のユースケース。
pub const JOB_TYPE_SUMMARIZE: &str = "summarize";

/// 1ジョブあたりの推論リトライ上限（FR-V03-005）。
///
/// この回数を試行しても失敗するジョブは `failed` にしてスキップする。
/// 「初回 + リトライ」の合計試行回数であり、`MAX_JOB_RETRIES` 回の `infer` 呼び出しを行う。
pub const MAX_JOB_RETRIES: u32 = 3;

/// 1回のドレインで処理するジョブの上限件数（暴走防止の安全弁）。
///
/// 1ポーリングでキュー全体を処理しつつ、異常時に無限ループへ陥らないための上限。
const MAX_JOBS_PER_DRAIN: i64 = 500;

/// アイドル時・ドレイン後のポーリング間隔（秒）。
///
/// 本ループは取りこぼし防止・定期実行の保険として一定間隔でキューを確認する。sync 直後の即時処理
/// （外部トリガーからのキュー投入）も次のポーリングで拾われる。短すぎると空ポーリングが増えるため
/// 30 秒に設定する。
const POLL_INTERVAL_SECS: u64 = 30;

/// フロントへ送るリフレッシュイベント名（AI 結果更新後に UI を再読込させる）。
///
/// `scheduler` の課題同期通知（`refresh-issues`）と同じイベントを用い、フロントは
/// AI 結果込みで `get_issues` を再取得する。
const REFRESH_EVENT: &str = "refresh-issues";

/// バックグラウンドAIワーカーを起動する（FR-V03-004）。
///
/// DB 準備完了後（[`crate::lib`] のセットアップ）に呼び出し、専用の非同期タスクで
/// [`POLL_INTERVAL_SECS`] ごとにキューをドレインするループを回す。`sync`・UI をブロックしない。
/// AI 機能 OFF・可用性なし・キュー空のときは推論せずアイドルする。
///
/// # 引数
/// * `app` - Tauri アプリケーションハンドル（DB 状態・sidecar 起動・イベント emit に用いる）。
pub fn init(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // バックエンドは1度だけ生成して再利用する（管理タスク・sidecar をループ間で共有）。
        // 生成は [`create_backend`] レジストリ経由（v0.3 は FoundationModels に解決）。
        // 生成失敗（AI 非対応環境等）でも本体は阻害しないため、生成を別タスク化せず
        // ポーリングループ側で「バックエンドが無ければアイドル」で吸収する。
        match create_backend(app.clone(), BackendKind::FoundationModels) {
            Ok(backend) => run_loop(app, backend).await,
            Err(e) => {
                warn!("AI worker: backend unavailable at startup ({e}). Worker will not run.")
            }
        }
    });
}

/// ポーリングループ本体（バックエンドはトレイトで抽象化。テスト容易性のため分離）。
///
/// [`POLL_INTERVAL_SECS`] ごとに、AI 機能が有効なときだけキューをドレインする。OFF・キュー空の
/// ときはアイドルする（NFR-V03-003）。1件以上処理したらフロントへリフレッシュを emit する。
///
/// # 引数
/// * `app` - DB 状態・イベント emit に用いるアプリケーションハンドル。
/// * `backend` - 推論バックエンド（同時1件はバックエンドの管理タスク側で担保）。
async fn run_loop<B: LlmInference>(app: AppHandle, backend: B) {
    let mut interval = tokio::time::interval(Duration::from_secs(POLL_INTERVAL_SECS));
    loop {
        interval.tick().await;

        if !is_ai_enabled(&app).await {
            debug!("AI worker: disabled, idling.");
            continue;
        }

        match drain_queue(&app, &backend).await {
            Ok(0) => debug!("AI worker: queue empty, idling."),
            Ok(processed) => {
                info!("AI worker: processed {processed} job(s).");
                // 1件以上処理したらフロントへリフレッシュを通知する。
                let now = chrono::Local::now().format("%H:%M").to_string();
                let _ = app.emit(REFRESH_EVENT, now);
            }
            Err(e) => error!("AI worker: drain failed: {e}"),
        }
    }
}

/// AI 機能が有効かを判定する（`settings.ai_enabled == "true"`）。
///
/// 設定取得自体が失敗しても OFF 扱いにして本体を阻害しない（非阻害方針）。
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

/// `pending` ジョブをキューが空になるまで（上限内で）処理する。
///
/// 1件ずつ取り出して [`process_job`] へ委譲し、処理した件数を返す。1件の処理失敗で全体は止めず、
/// 当該ジョブを `failed`（リトライ上限超過時）にしたうえで次のジョブへ進む（FR-V03-005）。
///
/// # 引数
/// * `app` - DB 状態・遅延日数算出に用いるアプリケーションハンドル。
/// * `backend` - 推論に用いる [`LlmInference`] バックエンド。
///
/// # 戻り値
/// 処理を試みたジョブ件数（成功・失敗を問わない）、または DB アクセス失敗時のエラー。
async fn drain_queue<B: LlmInference>(app: &AppHandle, backend: &B) -> Result<usize> {
    let db = app.state::<DbClient>();
    let lang = resolve_lang(&db).await;
    let mut processed = 0usize;

    // 同時1件: 毎回 limit=1 で取り出し、空になるまで（上限内で）繰り返す。
    for _ in 0..MAX_JOBS_PER_DRAIN {
        let jobs = db.get_pending_jobs(1).await?;
        let Some(job) = jobs.into_iter().next() else {
            break; // キューが空。
        };

        // 二重処理を避けるため、まず 'processing' へ遷移させる。
        if let Err(e) = db.update_job_status(job.id, "processing").await {
            error!("AI worker: failed to mark job {} processing: {e}", job.id);
            break; // DB 書き込み不能。これ以上進めても無駄なので抜ける。
        }

        process_job(&db, backend, &job, &lang).await;
        processed += 1;
    }

    Ok(processed)
}

/// ジョブ1件を処理する（取得→整形→推論→保存→状態遷移）。
///
/// 推論は [`MAX_JOB_RETRIES`] 回までリトライする。成功すれば結果に SQL 算出の遅延日数を付与して
/// `ai_results` へ保存し、ジョブを `done` にする。対象課題が見つからない・全リトライ失敗の場合は
/// ジョブを `failed` にしてスキップを記録する（FR-V03-005）。本体は止めない。
///
/// # 引数
/// * `db` - DB クライアント。
/// * `backend` - 推論バックエンド。
/// * `job` - 処理対象のジョブ（`processing` へ遷移済み）。
/// * `lang` - 出力言語（UI 言語に追従）。
async fn process_job<B: LlmInference>(
    db: &DbClient,
    backend: &B,
    job: &crate::db::AiJob,
    lang: &str,
) {
    // 1. 対象課題を DB から取得して入力へ整形（本文は SQL 側で切り詰め済み）。
    let input = match build_input(db, job, lang).await {
        Ok(Some(input)) => input,
        Ok(None) => {
            // 対象課題が削除済み等で見つからない。スキップして failed 記録。
            warn!(
                "AI worker: issue (ws={}, id={}) not found. Marking job {} failed.",
                job.workspace_id, job.issue_id, job.id
            );
            mark_failed(db, job.id).await;
            return;
        }
        Err(e) => {
            warn!(
                "AI worker: failed to build input for job {} (ws={}, id={}): {e}. Marking failed.",
                job.id, job.workspace_id, job.issue_id
            );
            mark_failed(db, job.id).await;
            return;
        }
    };

    // 2. リトライ付きで推論する。
    let output = match infer_with_retry(backend, &input).await {
        Ok(out) => out,
        Err(e) => {
            // 全リトライ失敗。スキップして failed 記録（FR-V03-005）。
            warn!(
                "AI worker: inference failed for issue {} after {} attempt(s): {e}. Skipping (job {} failed).",
                input.issue_key, MAX_JOB_RETRIES, job.id
            );
            mark_failed(db, job.id).await;
            return;
        }
    };

    // 3. 遅延日数を SQL で算出して結果へ付与（LLM 出力には含めない）。
    let delay_days = db
        .get_issue_delay_days(job.workspace_id, job.issue_id)
        .await
        .unwrap_or_else(|e| {
            warn!(
                "AI worker: delay_days calc failed for {}: {e}",
                input.issue_key
            );
            None
        });

    // 4. ai_results へ保存（issue 単位 UPSERT）。
    let result = AiResult {
        issue_id: job.issue_id,
        workspace_id: job.workspace_id,
        summary: Some(output.summary),
        risk_level: Some(risk_level_to_str(output.risk_level).to_string()),
        delay_days,
        suggestion: Some(output.suggestion),
        processed_at: Some(chrono::Utc::now().to_rfc3339()),
        model_used: Some(backend.name().to_string()),
    };

    if let Err(e) = db.save_ai_result(&result).await {
        error!(
            "AI worker: failed to save ai_result for {}: {e}",
            input.issue_key
        );
        mark_failed(db, job.id).await;
        return;
    }

    // 5. ジョブを done に遷移。
    if let Err(e) = db.update_job_status(job.id, "done").await {
        error!("AI worker: failed to mark job {} done: {e}", job.id);
    } else {
        debug!(
            "AI worker: job {} done (issue {}).",
            job.id, input.issue_key
        );
    }
}

/// 対象課題を DB から取得し、[`AiAnalysisInput`] に整形する。
///
/// 本文の切り詰めは [`DbClient::get_issue_analysis_fields`] が SQL 側で行う（[`CONTEXT_BODY_MAX_CHARS`]）。
/// 期限・ステータス・出力言語を付与する。
///
/// # 引数
/// * `db` - DB クライアント。
/// * `job` - 対象ジョブ（`workspace_id` / `issue_id` を参照）。
/// * `lang` - 出力言語。
///
/// # 戻り値
/// 整形済みの分析入力。対象課題が無ければ`None`、DB アクセス失敗時はエラー。
async fn build_input(
    db: &DbClient,
    job: &crate::db::AiJob,
    lang: &str,
) -> Result<Option<AiAnalysisInput>> {
    let fields = db
        .get_issue_analysis_fields(
            job.workspace_id,
            job.issue_id,
            CONTEXT_BODY_MAX_CHARS as i64,
        )
        .await?;

    Ok(fields.map(
        |(issue_key, summary, description_head, status, due_date)| AiAnalysisInput {
            issue_key,
            summary,
            description_head,
            status,
            due_date,
            lang: lang.to_string(),
        },
    ))
}

/// 推論をリトライ付きで実行する（FR-V03-005）。
///
/// 最大 [`MAX_JOB_RETRIES`] 回 `infer` を試行し、最初に成功した結果を返す。すべて失敗したら
/// 最後のエラーを返す。バックエンドが一時停止（連続失敗超過）に至った場合は即エラーになるため、
/// このリトライは無駄に長引かない。推論はバックグラウンド優先度（バックエンドの管理タスク内で実行）。
///
/// # 引数
/// * `backend` - 推論バックエンド。
/// * `input` - 分析入力。
///
/// # 戻り値
/// 推論結果、または全試行失敗時の最後のエラー。
async fn infer_with_retry<B: LlmInference>(
    backend: &B,
    input: &AiAnalysisInput,
) -> Result<super::AiAnalysisOutput> {
    let mut last_err = anyhow!("no inference attempted");
    for attempt in 1..=MAX_JOB_RETRIES {
        match backend.infer(input.clone()).await {
            Ok(out) => return Ok(out),
            Err(e) => {
                warn!(
                    "AI worker: inference attempt {attempt}/{MAX_JOB_RETRIES} failed for {}: {e}",
                    input.issue_key
                );
                last_err = e;
            }
        }
    }
    Err(last_err)
}

/// [`RiskLevel`] を `ai_results.risk_level` へ保存する小文字文字列へ変換する。
///
/// フロントのバッジ色分け（`high` / `medium` / `low`）と一致させる。`RiskLevel` の serde 表現
/// （`rename_all = "lowercase"`）と同じ文字列を、JSON を経由せず直接得るためのヘルパー。
///
/// # 引数
/// * `level` - リスクレベル。
///
/// # 戻り値
/// `"high"` / `"medium"` / `"low"` のいずれか。
fn risk_level_to_str(level: RiskLevel) -> &'static str {
    match level {
        RiskLevel::High => "high",
        RiskLevel::Medium => "medium",
        RiskLevel::Low => "low",
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
        error!("AI worker: failed to mark job {job_id} failed: {e}");
    }
}

/// 出力言語を解決する（`settings.language`、既定 [`DEFAULT_LANG`]）。
///
/// 取得失敗・未設定はいずれも既定言語に倒す。
///
/// # 引数
/// * `db` - DB クライアント。
///
/// # 戻り値
/// 出力言語コード（`ja` / `en` 等）。
async fn resolve_lang(db: &DbClient) -> String {
    db.get_setting(SETTING_LANGUAGE)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| DEFAULT_LANG.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::{AiAnalysisInput, AiAnalysisOutput, RiskLevel};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    /// 指定回数だけ失敗し、その後成功するモックバックエンド。
    struct FlakyBackend {
        /// これまでの呼び出し回数。
        calls: Arc<AtomicU32>,
        /// 失敗させる回数（これを超えたら成功する）。
        fail_until: u32,
    }

    impl LlmInference for FlakyBackend {
        async fn infer(&self, _input: AiAnalysisInput) -> Result<AiAnalysisOutput> {
            let n = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
            if n <= self.fail_until {
                Err(anyhow!("simulated failure {n}"))
            } else {
                Ok(AiAnalysisOutput {
                    summary: "s".into(),
                    risk_level: RiskLevel::Low,
                    suggestion: "do x".into(),
                })
            }
        }

        fn name(&self) -> &str {
            "mock"
        }
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

    #[tokio::test]
    async fn retry_succeeds_within_limit() {
        // 2回失敗してから成功 → 上限3回内なので Ok。
        let calls = Arc::new(AtomicU32::new(0));
        let backend = FlakyBackend {
            calls: Arc::clone(&calls),
            fail_until: 2,
        };
        let out = infer_with_retry(&backend, &sample_input())
            .await
            .expect("should succeed within retry limit");
        assert_eq!(out.summary, "s");
        assert_eq!(calls.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn retry_exhausts_and_errors() {
        // 常に失敗 → 上限回数試行して Err。
        let calls = Arc::new(AtomicU32::new(0));
        let backend = FlakyBackend {
            calls: Arc::clone(&calls),
            fail_until: u32::MAX,
        };
        assert!(infer_with_retry(&backend, &sample_input()).await.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), MAX_JOB_RETRIES);
    }

    #[test]
    fn risk_level_maps_to_storage_string() {
        // ai_results.risk_level へ保存する文字列が小文字になること（フロントのバッジ色分けと一致）。
        assert_eq!(risk_level_to_str(RiskLevel::High), "high");
        assert_eq!(risk_level_to_str(RiskLevel::Medium), "medium");
        assert_eq!(risk_level_to_str(RiskLevel::Low), "low");
    }
}
