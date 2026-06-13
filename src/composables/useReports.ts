import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { invoke } from '@tauri-apps/api/core'
import { useAiSettings } from './useAiSettings'

/**
 * レポート種別（Rust `report_summaries.report_type` カラムと一致）
 *
 * - `cross_summary`: 複数プロジェクト横断サマリ（最新のみ上書き。`period_key='latest'`）
 * - `weekly`: 週次アクティビティレポート（ISO 週 `YYYY-Www` で履歴保持）
 * - `monthly`: 月次アクティビティレポート（`YYYY-MM` で履歴保持）
 */
export type ReportType = 'cross_summary' | 'weekly' | 'monthly'

/**
 * 期間キーで履歴を保持するレポート種別（週次/月次）。
 *
 * 横断サマリ（`cross_summary`）は常に `period_key='latest'` の最新1件のみで履歴を持たないため、
 * 期間セレクタを伴う state（期間リスト・選択期間）はこの種別だけに用意する。
 */
export type PeriodReportType = 'weekly' | 'monthly'

/**
 * 横断サマリの集計1行（Rust 側 `CrossSummaryStat` の camelCase シリアライズに対応。FR-V045-002）
 *
 * 同一ワークスペース内のプロジェクトキーごとに SQL で決定的に集計された件数。
 * `report_summaries.stats_json` をパースした配列要素として扱う（コーパス専用課題は集計対象外）。
 */
export interface CrossSummaryStat {
  /** プロジェクトキー（例: "PROJ"）。`issue_key` から導出 */
  projectKey: string
  /** 未完了件数（残っている通常課題の総数） */
  openCount: number
  /** 期限超過件数（`due_date < 今日`） */
  overdueCount: number
  /** 停滞件数（最終更新がしきい値日数以上前） */
  staleCount: number
  /** 自分担当の要対応件数（担当者が自分かつ期限超過 or 停滞） */
  myActionableCount: number
  /** AI リスク分布: high の件数 */
  riskHigh: number
  /** AI リスク分布: medium の件数 */
  riskMedium: number
  /** AI リスク分布: low の件数 */
  riskLow: number
}

/**
 * 週次/月次アクティビティの集計1行（Rust 側 `PeriodActivityStat` の camelCase シリアライズに対応。FR-V045-003）
 *
 * 指定期間 `[period_start, period_end)` についてプロジェクト別に SQL 集計された件数。
 * `report_summaries.stats_json` をパースした配列要素として扱う。
 */
export interface PeriodActivityStat {
  /** プロジェクトキー（例: "PROJ"）。`issue_key` から導出 */
  projectKey: string
  /** 期間内に新規作成された件数（`created_at` が期間内） */
  createdCount: number
  /** 期間内に更新された件数（`updated_at` が期間内） */
  updatedCount: number
  /** 完了課題（`is_corpus_only=1`＝statusId4 相当）のうち `updated_at` が期間内のもの。完了日時は近似・コーパス取込期間内に限る（UI で補足） */
  completedCount: number
}

/**
 * 保存済みレポート/サマリーの1行（Rust 側 `ReportSummary` の camelCase シリアライズに対応。FR-V045-006）
 *
 * `statsJson` はプロジェクト別集計 JSON を文字列のまま保持する（Rust 側で `serde_json::to_string` 済み）。
 * UI で扱うには `parseCrossStats` / `parsePeriodStats` で配列へパースする。
 */
export interface ReportSummary {
  /** ワークスペースID */
  workspaceId: number
  /** レポート種別（`cross_summary` / `weekly` / `monthly`） */
  reportType: ReportType
  /** 期間キー（横断は `latest`、週次は `YYYY-Www`、月次は `YYYY-MM`） */
  periodKey: string
  /** 言語（`ja` / `en`） */
  lang: string
  /** プロジェクト別集計 JSON 文字列（未生成時は null） */
  statsJson: string | null
  /** AI 生成の1行見出し（未生成・degrade 時は null） */
  headline: string | null
  /** AI 生成の narrative テキスト（注目点・期間ハイライト。未生成・degrade 時は null） */
  narrative: string | null
  /** 最終生成日時（ISO8601 文字列） */
  generatedAt: string | null
}

/**
 * レポート機能を degrade（narrative 無効化）した理由
 *
 * AI 非対応・データ未生成などで narrative を提供できない場合に UI へ理由を提示する識別子。
 * 統計テーブルは degrade 対象に含めない（数値は SQL で常に算出可能なため。NFR-V045-003）。
 */
export type ReportDegradedReason =
  /** AI（FoundationModels）が利用不可。統計のみ表示し narrative は出さない */
  | 'aiUnavailable'
  /** レポートがまだ生成されていない（バックグラウンド生成待ち or 未再生成） */
  | 'notGenerated'
  /** レポート取得コマンド自体が失敗した */
  | 'loadFailed'

/**
 * 横断サマリ用の state バンドル（stats + headline + narrative + 取得済みフラグ）
 */
interface CrossSummaryState {
  /** パース済みのプロジェクト別統計（未取得時は空配列） */
  stats: CrossSummaryStat[]
  /** AI 生成の1行見出し（未生成・degrade 時は null） */
  headline: string | null
  /** AI 生成の narrative（未生成・degrade 時は null） */
  narrative: string | null
  /** 最終生成日時（ISO8601 文字列。未生成時は null） */
  generatedAt: string | null
}

/**
 * 週次/月次レポート用の state バンドル（選択期間の stats + narrative + 期間リスト）
 */
interface PeriodReportState {
  /** 選択中の期間キー（未選択・未生成時は null） */
  selectedPeriod: string | null
  /** 保存済み期間キー一覧（生成日時降順。期間セレクタ用） */
  periods: string[]
  /** 選択期間のパース済み統計（未取得時は空配列） */
  stats: PeriodActivityStat[]
  /** 選択期間の AI narrative（未生成・degrade 時は null） */
  narrative: string | null
  /** 選択期間の生成日時（ISO8601 文字列。未生成時は null） */
  generatedAt: string | null
}

// -----------------------------------------------------------------------
// グローバルステート（useSimilarSearch / useAiSettings の module スコープ流儀に倣う）
// /reports ページは単一インスタンスのため、状態をモジュール単一インスタンスで共有する。
// -----------------------------------------------------------------------

/** 横断サマリ（最新1件） */
const crossSummary = ref<CrossSummaryState>({
  stats: [],
  headline: null,
  narrative: null,
  generatedAt: null,
})
/** 週次レポート（期間履歴つき） */
const weekly = ref<PeriodReportState>({
  selectedPeriod: null,
  periods: [],
  stats: [],
  narrative: null,
  generatedAt: null,
})
/** 月次レポート（期間履歴つき） */
const monthly = ref<PeriodReportState>({
  selectedPeriod: null,
  periods: [],
  stats: [],
  narrative: null,
  generatedAt: null,
})

/** 横断サマリのロード中フラグ */
const loadingCross = ref(false)
/** 週次レポートのロード中フラグ（期間切り替え含む） */
const loadingWeekly = ref(false)
/** 月次レポートのロード中フラグ（期間切り替え含む） */
const loadingMonthly = ref(false)
/** 再生成中の種別フラグ（再生成スピナー用。同時に複数走らせない前提で種別ごとに保持） */
const regenerating = ref<Record<ReportType, boolean>>({
  cross_summary: false,
  weekly: false,
  monthly: false,
})

/** レポート種別ごとの degrade 理由（narrative 非表示理由。正常時は null） */
const degradedReason = ref<Record<ReportType, ReportDegradedReason | null>>({
  cross_summary: null,
  weekly: null,
  monthly: null,
})

// -----------------------------------------------------------------------
// per-issue 背景要約の state（FR-V045-004）
//
// IssueDetailDialog は同時に 1 つしか開かないため、useSimilarSearch と同様に
// モジュール単一インスタンスのグローバルステートで保持する。ダイアログを開き直したら
// 呼び出し側でクリアして取り違えを防ぐ。
// -----------------------------------------------------------------------

/** 背景要約テキスト（未取得・コメントなし・degrade 時は空文字） */
const backgroundSummary = ref('')
/** 背景要約の生成中フラグ（スピナー表示用） */
const backgroundSummaryLoading = ref(false)
/** 背景要約を一度でも取得し終えたか（空文字＝「コメントなし」表示の出し分けに使う） */
const backgroundSummaryLoaded = ref(false)

/**
 * `report_summaries.stats_json`（横断サマリ）を `CrossSummaryStat[]` へパースする
 *
 * JSON パース失敗時は空配列へ degrade する（統計テーブルが空表示になるだけで本体は壊さない）。
 *
 * @param statsJson - Rust が `serde_json::to_string` した JSON 文字列（未生成時は null）
 * @returns パース済みの統計配列（失敗・null 時は空配列）
 */
function parseCrossStats(statsJson: string | null): CrossSummaryStat[] {
  if (!statsJson) return []
  try {
    const parsed = JSON.parse(statsJson)
    return Array.isArray(parsed) ? (parsed as CrossSummaryStat[]) : []
  } catch (e) {
    console.error('Failed to parse cross summary stats_json:', e)
    return []
  }
}

/**
 * `report_summaries.stats_json`（週次/月次）を `PeriodActivityStat[]` へパースする
 *
 * @param statsJson - Rust が `serde_json::to_string` した JSON 文字列（未生成時は null）
 * @returns パース済みの統計配列（失敗・null 時は空配列）
 */
function parsePeriodStats(statsJson: string | null): PeriodActivityStat[] {
  if (!statsJson) return []
  try {
    const parsed = JSON.parse(statsJson)
    return Array.isArray(parsed) ? (parsed as PeriodActivityStat[]) : []
  } catch (e) {
    console.error('Failed to parse period activity stats_json:', e)
    return []
  }
}

/**
 * レポート/サマリーの取得・再生成・期間切り替えを管理する Composable（v0.4.5）
 *
 * - グローバルステートパターンを採用し、`/reports` ページの各セクションで状態を共有する
 * - 数値（統計テーブル）は SQL で決定的に集計され常に表示できる一方、narrative は AI 非対応・
 *   未生成のとき例外を投げず `degradedReason` に集約して degrade する（NFR-V045-003）
 * - 出力言語は UI 言語（vue-i18n の locale = 永続化済み language 設定）に追従する
 */
export function useReports() {
  const { locale } = useI18n()
  const { isAiReady } = useAiSettings()

  /**
   * 取得した `ReportSummary` から degrade 理由を判定する
   *
   * - 取得結果が null（未生成）→ `notGenerated`
   * - narrative が空 かつ AI 非対応 → `aiUnavailable`（統計のみ提供）
   * - narrative が空 かつ AI 対応（生成失敗等）→ `notGenerated`（再生成を促す）
   * - narrative あり → degrade なし（null）
   *
   * @param summary - 取得した `ReportSummary`（未生成時は null）
   * @returns degrade 理由（degrade 不要なら null）
   */
  function resolveDegradedReason(summary: ReportSummary | null): ReportDegradedReason | null {
    if (summary === null) return 'notGenerated'
    if (summary.narrative && summary.narrative.trim().length > 0) return null
    return isAiReady.value ? 'notGenerated' : 'aiUnavailable'
  }

  /**
   * 横断サマリ・週次/月次レポートをまとめて読み込む（初期表示用）
   *
   * 1. 横断サマリ（`period_key='latest'`）を取得して state へ反映
   * 2. 週次/月次は期間キー一覧を取得し、最新期間（先頭）を選択してその内容を取得
   *
   * いずれの失敗も例外を投げず `degradedReason` に集約する（既存機能を阻害しない）。
   *
   * @param workspaceId - 対象ワークスペースID（横断は同一ワークスペース内のプロジェクト横断のみ）
   */
  async function loadReports(workspaceId: number) {
    const lang = locale.value
    await Promise.all([
      loadCrossSummary(workspaceId, lang),
      loadPeriodReport(workspaceId, 'weekly', lang),
      loadPeriodReport(workspaceId, 'monthly', lang),
    ])
  }

  /**
   * 横断サマリ（最新1件）を取得して state へ反映する
   *
   * @param workspaceId - 対象ワークスペースID
   * @param lang - 出力言語（UI 言語に追従）
   */
  async function loadCrossSummary(workspaceId: number, lang: string) {
    loadingCross.value = true
    try {
      const summary = await invoke<ReportSummary | null>('get_reports', {
        workspaceId,
        reportType: 'cross_summary',
        periodKey: 'latest',
        lang,
      })
      crossSummary.value = {
        stats: parseCrossStats(summary?.statsJson ?? null),
        headline: summary?.headline ?? null,
        narrative: summary?.narrative ?? null,
        generatedAt: summary?.generatedAt ?? null,
      }
      degradedReason.value.cross_summary = resolveDegradedReason(summary)
    } catch (e) {
      console.error('Failed to load cross summary:', e)
      crossSummary.value = { stats: [], headline: null, narrative: null, generatedAt: null }
      degradedReason.value.cross_summary = 'loadFailed'
    } finally {
      loadingCross.value = false
    }
  }

  /**
   * 週次/月次レポートの期間一覧を取得し、最新期間を選択してその内容を読み込む
   *
   * @param workspaceId - 対象ワークスペースID
   * @param reportType - レポート種別（`weekly` / `monthly`）
   * @param lang - 出力言語（UI 言語に追従）
   */
  async function loadPeriodReport(workspaceId: number, reportType: PeriodReportType, lang: string) {
    const state = reportType === 'weekly' ? weekly : monthly
    const loadingFlag = reportType === 'weekly' ? loadingWeekly : loadingMonthly
    loadingFlag.value = true
    try {
      const periods = await invoke<string[]>('list_report_periods', {
        workspaceId,
        reportType,
      })
      state.value.periods = periods
      // 最新期間（生成日時降順の先頭）を初期選択。期間が無ければ未生成として degrade。
      const latest = periods[0] ?? null
      state.value.selectedPeriod = latest
      if (latest === null) {
        state.value.stats = []
        state.value.narrative = null
        state.value.generatedAt = null
        degradedReason.value[reportType] = 'notGenerated'
        return
      }
      await fetchPeriodContent(workspaceId, reportType, latest, lang)
    } catch (e) {
      console.error(`Failed to load ${reportType} report:`, e)
      state.value.periods = []
      state.value.selectedPeriod = null
      state.value.stats = []
      state.value.narrative = null
      state.value.generatedAt = null
      degradedReason.value[reportType] = 'loadFailed'
    } finally {
      loadingFlag.value = false
    }
  }

  /**
   * 指定期間の週次/月次レポート本体を取得して state へ反映する（内部ヘルパー）
   *
   * 期間一覧に存在する `periodKey` を前提とするため、`get_reports` が null を返すのは
   * 言語不一致など稀なケースのみ。null 時も例外を投げず degrade する。
   *
   * @param workspaceId - 対象ワークスペースID
   * @param reportType - レポート種別（`weekly` / `monthly`）
   * @param periodKey - 取得する期間キー
   * @param lang - 出力言語（UI 言語に追従）
   */
  async function fetchPeriodContent(
    workspaceId: number,
    reportType: PeriodReportType,
    periodKey: string,
    lang: string
  ) {
    const state = reportType === 'weekly' ? weekly : monthly
    const summary = await invoke<ReportSummary | null>('get_reports', {
      workspaceId,
      reportType,
      periodKey,
      lang,
    })
    state.value.stats = parsePeriodStats(summary?.statsJson ?? null)
    state.value.narrative = summary?.narrative ?? null
    state.value.generatedAt = summary?.generatedAt ?? null
    degradedReason.value[reportType] = resolveDegradedReason(summary)
  }

  /**
   * 週次/月次レポートの表示期間を切り替える（期間セレクタ用。FR-V045-003）
   *
   * @param workspaceId - 対象ワークスペースID
   * @param reportType - レポート種別（`weekly` / `monthly`）
   * @param periodKey - 切り替え先の期間キー
   */
  async function selectPeriod(
    workspaceId: number,
    reportType: PeriodReportType,
    periodKey: string
  ) {
    const lang = locale.value
    const state = reportType === 'weekly' ? weekly : monthly
    const loadingFlag = reportType === 'weekly' ? loadingWeekly : loadingMonthly
    state.value.selectedPeriod = periodKey
    loadingFlag.value = true
    try {
      await fetchPeriodContent(workspaceId, reportType, periodKey, lang)
    } catch (e) {
      console.error(`Failed to select ${reportType} period ${periodKey}:`, e)
      state.value.stats = []
      state.value.narrative = null
      state.value.generatedAt = null
      degradedReason.value[reportType] = 'loadFailed'
    } finally {
      loadingFlag.value = false
    }
  }

  /**
   * 指定種別のレポートを手動で即時再生成する（FR-V045-005）
   *
   * `generate_reports` を invoke して統計 + narrative を生成・保存し、保存行で state を更新する。
   * 週次/月次は現在の期間キーで生成されるため、生成後に期間一覧を取り直して最新へ追従する。
   * AI 非対応時も統計のみは生成され、narrative は degrade する（Rust 側で degrade 済み）。
   *
   * @param workspaceId - 対象ワークスペースID
   * @param reportType - 再生成するレポート種別
   */
  async function regenerate(workspaceId: number, reportType: ReportType) {
    const lang = locale.value
    regenerating.value[reportType] = true
    try {
      const summary = await invoke<ReportSummary>('generate_reports', {
        workspaceId,
        reportType,
        lang,
      })
      if (reportType === 'cross_summary') {
        crossSummary.value = {
          stats: parseCrossStats(summary.statsJson),
          headline: summary.headline,
          narrative: summary.narrative,
          generatedAt: summary.generatedAt,
        }
        degradedReason.value.cross_summary = resolveDegradedReason(summary)
      } else {
        const state = reportType === 'weekly' ? weekly : monthly
        // 新しい期間が増えた可能性があるため期間一覧を取り直し、生成した期間を選択状態にする。
        const periods = await invoke<string[]>('list_report_periods', {
          workspaceId,
          reportType,
        })
        state.value.periods = periods
        state.value.selectedPeriod = summary.periodKey
        state.value.stats = parsePeriodStats(summary.statsJson)
        state.value.narrative = summary.narrative
        state.value.generatedAt = summary.generatedAt
        degradedReason.value[reportType] = resolveDegradedReason(summary)
      }
    } catch (e) {
      console.error(`Failed to regenerate ${reportType} report:`, e)
      degradedReason.value[reportType] = 'loadFailed'
    } finally {
      regenerating.value[reportType] = false
    }
  }

  /**
   * 課題の背景・経緯の要約を取得し、per-issue 背景要約 state を更新する（IssueDetailDialog から呼ぶ。FR-V045-004）
   *
   * `get_background_summary` を invoke する。Rust 側はコメントの `source_hash` + `lang` で
   * キャッシュ済みなら再生成せず返す（2 回目以降は即返し）。コメントなし・AI 非対応・生成失敗は
   * **空文字** へ degrade するため、`backgroundSummary` が空文字かつ `backgroundSummaryLoaded` なら
   * UI 側で「コメントなし（要約対象なし）」を表示する。
   *
   * @param workspaceId - 対象課題のワークスペースID
   * @param issueId - 対象課題ID
   * @param lang - 出力言語（省略時は UI 言語に追従）
   * @returns 経緯・決定事項の要点（コメントなし・degrade 時は空文字）
   */
  async function generateBackgroundSummary(
    workspaceId: number,
    issueId: number,
    lang: string = locale.value
  ): Promise<string> {
    backgroundSummaryLoading.value = true
    try {
      const text = await invoke<string>('get_background_summary', {
        workspaceId,
        issueId,
        lang,
      })
      backgroundSummary.value = text
      backgroundSummaryLoaded.value = true
      return text
    } catch (e) {
      console.error('Failed to generate background summary:', e)
      // DB エラー等でも UI を壊さないよう空文字へ degrade する。
      backgroundSummary.value = ''
      backgroundSummaryLoaded.value = true
      return ''
    } finally {
      backgroundSummaryLoading.value = false
    }
  }

  /**
   * per-issue 背景要約 state を初期状態へ戻す（ダイアログを開き直したときに前の課題の要約を出さない）
   */
  function resetBackgroundSummary() {
    backgroundSummary.value = ''
    backgroundSummaryLoading.value = false
    backgroundSummaryLoaded.value = false
  }

  return {
    // state
    crossSummary,
    weekly,
    monthly,
    loadingCross,
    loadingWeekly,
    loadingMonthly,
    regenerating,
    degradedReason,
    backgroundSummary,
    backgroundSummaryLoading,
    backgroundSummaryLoaded,
    // actions
    loadReports,
    selectPeriod,
    regenerate,
    generateBackgroundSummary,
    resetBackgroundSummary,
  }
}
