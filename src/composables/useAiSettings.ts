import { ref, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'

/**
 * 埋め込み構築進捗（target: 対象件数, built: 構築済み件数）
 */
export interface EmbeddingStatus {
  target: number
  built: number
}

/**
 * AI 可用性の理由別 enum（Rust 側 AiAvailabilityReason の camelCase シリアライズに対応）
 */
export type AiAvailabilityReason =
  | 'available'
  | 'unsupportedOs'
  | 'appleIntelligenceDisabled'
  | 'modelNotReady'
  | 'deviceNotEligible'
  | 'unavailable'

/**
 * get_ai_availability コマンドの戻り値（Rust 側 AiAvailability の camelCase シリアライズに対応）
 */
export interface AiAvailability {
  available: boolean
  reason: AiAvailabilityReason
  /** 診断・ログ向けの補足コード文字列 */
  detail?: string
  /** 検出した macOS メジャーバージョン（非 macOS / 取得失敗時は null） */
  macosMajor?: number | null
  /** 別バックエンドが利用可能かどうか（v0.3 では常に false） */
  otherBackendAvailable: boolean
}

/**
 * get_ai_queue_status コマンドの戻り値
 * [pending 件数, processing 件数] のタプル
 */
export type AiQueueStatus = [number, number]

// -----------------------------------------------------------------------
// グローバルステート（useIssueFilters の流儀に倣い module スコープに配置）
// -----------------------------------------------------------------------

/** AI 機能の有効化状態 */
const aiEnabled = ref(false)
/** AI 可用性情報 */
const availability = ref<AiAvailability | null>(null)
/** キュー残件数 [pending, processing] */
const queueStatus = ref<AiQueueStatus>([0, 0])
/** 可用性のロード中フラグ */
const loadingAvailability = ref(false)
/** キュー状況のロード中フラグ */
const loadingQueue = ref(false)
/** コーパス取り込み期間（月数。既定 6）*/
const corpusMonths = ref<number>(6)
/** コーパス件数（コーパス専用課題の合計） */
const corpusCount = ref<number | null>(null)
/** 埋め込み構築進捗 */
const embeddingStatus = ref<EmbeddingStatus | null>(null)
/** コーパス件数のロード中フラグ */
const loadingCorpus = ref(false)
/** 埋め込み進捗のロード中フラグ */
const loadingEmbedding = ref(false)

/**
 * AiAvailabilityReason を i18n メッセージキーへマップするヘルパー
 *
 * @param reason - AI 可用性の理由
 * @returns `ai.availability.<reason>` 形式の i18n キー
 */
export function availabilityReasonToMessageKey(reason: AiAvailabilityReason): string {
  const map: Record<AiAvailabilityReason, string> = {
    available: 'ai.availability.available',
    unsupportedOs: 'ai.availability.unsupportedOs',
    appleIntelligenceDisabled: 'ai.availability.appleIntelligenceDisabled',
    modelNotReady: 'ai.availability.modelNotReady',
    deviceNotEligible: 'ai.availability.deviceNotEligible',
    unavailable: 'ai.availability.unavailable',
  }
  return map[reason] ?? 'ai.availability.unavailable'
}

/**
 * AI 設定・可用性・キュー状況を管理する Composable
 *
 * - グローバルステートパターンを採用し、複数コンポーネントからの呼び出しで状態を共有する
 * - AI 非対応環境でも既存機能を阻害しない設計（エラー時は静かに失敗）
 */
export function useAiSettings() {
  /** AI 機能が有効かつ利用可能かどうか */
  const isAiReady = computed(() => aiEnabled.value && (availability.value?.available ?? false))

  /** pending + processing の合計（設定画面のキュー表示用） */
  const totalQueueCount = computed(() => queueStatus.value[0] + queueStatus.value[1])

  /** 埋め込み構築の進捗割合（0〜100。対象 0 件時は 100 とみなす） */
  const embeddingProgressPercent = computed(() => {
    const s = embeddingStatus.value
    if (!s || s.target === 0) return 100
    return Math.round((s.built / s.target) * 100)
  })

  /**
   * AI 機能の有効化状態を DB から読み込む
   */
  async function loadEnabled() {
    try {
      const enabled = await invoke<boolean>('get_ai_settings')
      aiEnabled.value = enabled
    } catch (e) {
      console.error('Failed to load AI settings:', e)
    }
  }

  /**
   * AI 機能の可用性を取得し availability を更新する
   *
   * 可用性問い合わせは Rust 側で sidecar プロセスを起動するため、グローバルステートに
   * 取得済みの結果がある場合は再問い合わせをスキップする（ページ遷移ごとの sidecar 起動を回避）。
   * 設定変更後など最新化したい場合は `force` を指定する。
   *
   * @param force - true のとき既存キャッシュを無視して再取得する（既定 false）
   */
  async function loadAvailability(force = false) {
    if (!force && availability.value !== null) return
    loadingAvailability.value = true
    try {
      const result = await invoke<AiAvailability>('get_ai_availability')
      availability.value = result
    } catch (e) {
      console.error('Failed to load AI availability:', e)
      availability.value = null
    } finally {
      loadingAvailability.value = false
    }
  }

  /**
   * AI ジョブキューの処理状況（残件数・処理中件数）を取得し queueStatus を更新する
   */
  async function loadQueueStatus() {
    loadingQueue.value = true
    try {
      const status = await invoke<AiQueueStatus>('get_ai_queue_status')
      queueStatus.value = status
    } catch (e) {
      console.error('Failed to load AI queue status:', e)
    } finally {
      loadingQueue.value = false
    }
  }

  /**
   * AI 機能を有効化し、設定を保存する
   */
  async function enableAi() {
    try {
      await invoke('save_ai_setting', { enabled: true })
      aiEnabled.value = true
    } catch (e) {
      console.error('Failed to enable AI:', e)
      throw e
    }
  }

  /**
   * AI 機能を無効化し、設定を保存する
   */
  async function disableAi() {
    try {
      await invoke('save_ai_setting', { enabled: false })
      aiEnabled.value = false
    } catch (e) {
      console.error('Failed to disable AI:', e)
      throw e
    }
  }

  /**
   * 課題を手動で再分析キューに投入する
   *
   * @param workspaceId - ワークスペース ID
   * @param issueId - 課題 ID
   * @returns 新規投入件数（pending 重複の場合は 0）
   */
  async function reanalyze(workspaceId: number, issueId: number): Promise<number> {
    try {
      const enqueued = await invoke<number>('reanalyze_issue', {
        workspaceId,
        issueId,
      })
      // キュー状況を再取得して UI に反映
      await loadQueueStatus()
      return enqueued
    } catch (e) {
      console.error('Failed to reanalyze issue:', e)
      throw e
    }
  }

  /**
   * コーパス取り込み期間を DB から読み込む
   *
   * `corpus_months` キーが未設定の場合は既定値 6 を使用する。
   */
  async function loadCorpusMonths() {
    try {
      const val = await invoke<string | null>('get_settings', { key: 'corpus_months' })
      if (val !== null) {
        const n = parseInt(val, 10)
        if (!isNaN(n) && n >= 1 && n <= 24) {
          corpusMonths.value = n
        }
      }
    } catch (e) {
      console.error('Failed to load corpus_months:', e)
    }
  }

  /**
   * コーパス取り込み期間を DB に保存する
   *
   * 保存後は次回 sync でコーパス再取り込みが走る前提。
   *
   * @param months - 取り込み期間（月数。1〜24）
   */
  async function saveCorpusMonths(months: number) {
    try {
      await invoke('save_settings', { key: 'corpus_months', value: String(months) })
      corpusMonths.value = months
    } catch (e) {
      console.error('Failed to save corpus_months:', e)
      throw e
    }
  }

  /**
   * 全ワークスペースのコーパス（完了課題）件数を合算して取得する
   *
   * 各ワークスペースの `get_closed_issues_corpus_count` を並列呼び出しし合算する。
   * 取得失敗時は 0 件扱いとして静かに失敗する。
   */
  async function loadCorpusCount() {
    loadingCorpus.value = true
    try {
      const workspaces = await invoke<{ id: number }[]>('get_workspaces')
      const counts = await Promise.all(
        workspaces.map(ws =>
          invoke<number>('get_closed_issues_corpus_count', { workspaceId: ws.id }).catch(() => 0)
        )
      )
      corpusCount.value = counts.reduce((sum, c) => sum + c, 0)
    } catch (e) {
      console.error('Failed to load corpus count:', e)
      corpusCount.value = 0
    } finally {
      loadingCorpus.value = false
    }
  }

  /**
   * 全ワークスペースの埋め込み構築進捗を合算して取得する
   *
   * 各ワークスペースの `get_embedding_status` を並列呼び出しし合算する。
   * 取得失敗時は {target: 0, built: 0} として静かに失敗する。
   */
  async function loadEmbeddingStatus() {
    loadingEmbedding.value = true
    try {
      const workspaces = await invoke<{ id: number }[]>('get_workspaces')
      const statuses = await Promise.all(
        workspaces.map(ws =>
          invoke<[number, number]>('get_embedding_status', { workspaceId: ws.id }).catch(
            () => [0, 0] as [number, number]
          )
        )
      )
      const total = statuses.reduce(
        (acc, [target, built]) => ({ target: acc.target + target, built: acc.built + built }),
        { target: 0, built: 0 }
      )
      embeddingStatus.value = total
    } catch (e) {
      console.error('Failed to load embedding status:', e)
      embeddingStatus.value = { target: 0, built: 0 }
    } finally {
      loadingEmbedding.value = false
    }
  }

  return {
    // state
    aiEnabled,
    availability,
    queueStatus,
    loadingAvailability,
    loadingQueue,
    corpusMonths,
    corpusCount,
    embeddingStatus,
    loadingCorpus,
    loadingEmbedding,
    // computed
    isAiReady,
    totalQueueCount,
    embeddingProgressPercent,
    // actions
    loadEnabled,
    loadAvailability,
    loadQueueStatus,
    enableAi,
    disableAi,
    reanalyze,
    loadCorpusMonths,
    saveCorpusMonths,
    loadCorpusCount,
    loadEmbeddingStatus,
  }
}
