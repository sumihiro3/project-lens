import { ref, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'

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

  return {
    // state
    aiEnabled,
    availability,
    queueStatus,
    loadingAvailability,
    loadingQueue,
    // computed
    isAiReady,
    totalQueueCount,
    // actions
    loadEnabled,
    loadAvailability,
    loadQueueStatus,
    enableAi,
    disableAi,
    reanalyze,
  }
}
