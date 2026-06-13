import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { listen } from '@tauri-apps/api/event'
import { useIssues, type Issue } from './useIssues'
import { useIssueFilters } from './useIssueFilters'
import { useAiSettings } from './useAiSettings'
import { parseDueDate, isOverdue } from '../utils/issueHelpers'

/** ダッシュボードで完了扱いとするステータス名 */
const COMPLETED_STATUSES = ['完了', 'Closed', 'Done']
const RESOLVED_STATUSES = ['処理済み', 'Resolved']

/** AI バナーのスキップ済みフラグを保持するローカルストレージキー */
const BANNER_DISMISSED_KEY = 'ai_banner_dismissed'

/**
 * ダッシュボードページのロジックをまとめた Composable
 *
 * - KPI カード集計・チャート集計・フィルター遷移・AI バナー制御を提供する
 * - index.vue をテンプレート専念（50-100 行目安）にするため分離
 */
export function useDashboard() {
  const router = useRouter()
  const { t } = useI18n()
  const { issues, loadIssues } = useIssues()
  const { filters, baseIssues, showOnlyMyIssues } = useIssueFilters(issues)
  const { aiEnabled, availability, loadEnabled, loadAvailability, enableAi } = useAiSettings()

  /** 詳細ダイアログで表示中の課題 */
  const detailIssue = ref<Issue | null>(null)
  /** 詳細ダイアログの開閉状態 */
  const detailDialogOpen = ref(false)

  /** AI バナーのスキップ済みフラグ（sessionStorage ではなく localStorageで永続化） */
  const bannerDismissed = ref(localStorage.getItem(BANNER_DISMISSED_KEY) === 'true')

  /**
   * AI バナーを表示すべきかどうか
   * - AI が利用可能（available）
   * - かつ AI 機能が未有効化
   * - かつバナーを「表示しない」していない
   */
  const showAiBanner = computed(() => {
    return availability.value?.available === true && !aiEnabled.value && !bannerDismissed.value
  })

  /** 自動更新イベントのリスナー解除関数 */
  let unlisten: (() => void) | null = null

  onMounted(async () => {
    await loadIssues()
    await Promise.all([loadEnabled(), loadAvailability()])

    unlisten = await listen('refresh-issues', () => {
      loadIssues()
    })
  })

  onUnmounted(() => {
    if (unlisten) unlisten()
  })

  // ──────────────────────────────────────────────
  // KPI 集計
  // ──────────────────────────────────────────────

  /** 期限切れ件数 */
  const overdueCount = computed(
    () =>
      baseIssues.value.filter(issue => {
        const d = parseDueDate(issue.dueDate)
        return d && isOverdue(d)
      }).length
  )

  /** 期限間近件数（今日〜3日後） */
  const dueSoonCount = computed(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const target = new Date(today)
    target.setDate(target.getDate() + 3)

    return baseIssues.value.filter(issue => {
      const d = parseDueDate(issue.dueDate)
      return d && d >= today && d <= target
    }).length
  })

  /** 放置チケット件数（5日以上更新なし・未完了） */
  const stagnantCount = computed(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const threshold = new Date(today)
    threshold.setDate(threshold.getDate() - 5)

    return baseIssues.value.filter(issue => {
      const updated = parseDueDate(issue.updated)
      if (!updated) return false
      const name = issue.status?.name
      const isCompleted =
        name &&
        (COMPLETED_STATUSES.some(s => name.includes(s)) ||
          RESOLVED_STATUSES.some(s => name.includes(s)))
      return updated < threshold && !isCompleted
    }).length
  })

  /** ステータス別件数 */
  const statusCounts = computed(() => {
    const counts: Record<string, number> = {}
    baseIssues.value.forEach(issue => {
      const key = issue.status?.name || t('dashboard.unknown')
      counts[key] = (counts[key] || 0) + 1
    })
    return counts
  })

  /** 優先度別件数 */
  const priorityCounts = computed(() => {
    const counts: Record<string, number> = {}
    baseIssues.value.forEach(issue => {
      const key = issue.priority?.name || t('dashboard.unknown')
      counts[key] = (counts[key] || 0) + 1
    })
    return counts
  })

  // ──────────────────────────────────────────────
  // フィルター遷移
  // ──────────────────────────────────────────────

  function resetFilters() {
    filters.value.searchQuery = ''
    filters.value.statusFilter = 'all'
    filters.value.dueDateFilter = ''
    filters.value.dueSoonDays = null
    filters.value.stagnantDays = null
    filters.value.minScore = 0
    filters.value.selectedPriorities = []
    filters.value.selectedAssignees = []
    filters.value.selectedProjects = []
  }

  function navigateToOverdue() {
    resetFilters()
    filters.value.dueDateFilter = 'overdue'
    router.push('/issues')
  }

  function navigateToDueSoon() {
    resetFilters()
    filters.value.dueSoonDays = 3
    router.push('/issues')
  }

  function navigateToStagnant() {
    resetFilters()
    filters.value.stagnantDays = 5
    router.push('/issues')
  }

  function navigateToStatus(statusName: string) {
    resetFilters()
    filters.value.statusFilter = statusName
    router.push('/issues')
  }

  function navigateToPriority(priorityName: string) {
    resetFilters()
    filters.value.selectedPriorities = [priorityName]
    router.push('/issues')
  }

  // ──────────────────────────────────────────────
  // 詳細ダイアログ
  // ──────────────────────────────────────────────

  /**
   * 指定した課題の詳細ダイアログを開く
   *
   * @param issue - 詳細表示する課題
   */
  function openDetail(issue: Issue) {
    detailIssue.value = issue
    detailDialogOpen.value = true
  }

  // ──────────────────────────────────────────────
  // AI バナー
  // ──────────────────────────────────────────────

  /** バナーを「後で確認」でスキップする（再表示あり。セッション内のみ非表示） */
  function skipBanner() {
    bannerDismissed.value = true
  }

  /** バナーを「表示しない」で永続的に非表示にする */
  function dismissBanner() {
    bannerDismissed.value = true
    localStorage.setItem(BANNER_DISMISSED_KEY, 'true')
  }

  /** バナーの「AI を有効にする」ボタン押下時の処理 */
  async function handleEnableAi() {
    await enableAi()
    bannerDismissed.value = true
  }

  return {
    issues,
    baseIssues,
    showOnlyMyIssues,
    // KPI
    overdueCount,
    dueSoonCount,
    stagnantCount,
    statusCounts,
    priorityCounts,
    // ナビゲーション
    navigateToOverdue,
    navigateToDueSoon,
    navigateToStagnant,
    navigateToStatus,
    navigateToPriority,
    // 詳細ダイアログ
    detailIssue,
    detailDialogOpen,
    openDetail,
    // AI バナー
    showAiBanner,
    skipBanner,
    dismissBanner,
    handleEnableAi,
  }
}
