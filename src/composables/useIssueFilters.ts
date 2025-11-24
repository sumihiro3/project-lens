import { ref, computed, type Ref } from 'vue'
import type { Issue } from './useIssues'
import { parseDueDate, isOverdue, isToday, isThisWeek, isThisMonth } from '../utils/issueHelpers'

/**
 * フィルター状態を保持するインターフェース
 */
export interface FilterState {
  searchQuery: string
  statusFilter: string
  dueDateFilter: string
  minScore: number
  selectedPriorities: string[]
  selectedAssignees: string[]
  selectedProjects: string[]
}

/**
 * 課題フィルタリング機能を提供するComposable
 */
// グローバルステートとしてフィルター状態を保持（画面遷移しても維持される）
const filters = ref<FilterState>({
  searchQuery: '',
  statusFilter: 'all', // デフォルト：すべて表示（完了はAPIで除外済み）
  dueDateFilter: '',
  minScore: 0,
  selectedPriorities: [],
  selectedAssignees: [],
  selectedProjects: []
})

/**
 * 課題フィルタリング機能を提供するComposable
 */
export function useIssueFilters(issues: Ref<Issue[]>) {
  // フィルター状態（グローバルステートを使用）

  // ステータス定義
  const completedStatuses = ['完了', 'Closed', 'Done']
  const resolvedStatuses = ['処理済み', 'Resolved']
  const inProgressStatuses = ['処理中', 'In Progress', 'Working', '対応中']

  // 利用可能な優先度リスト
  const availablePriorities = computed(() => {
    const priorities = new Set<string>()
    issues.value.forEach(issue => {
      if (issue.priority?.name) {
        priorities.add(issue.priority.name)
      }
    })
    return Array.from(priorities).sort()
  })

  // 利用可能な担当者リスト
  const availableAssignees = computed(() => {
    const assignees = new Set<string>()
    issues.value.forEach(issue => {
      if (issue.assignee?.name) {
        assignees.add(issue.assignee.name)
      }
    })
    return Array.from(assignees).sort()
  })

  // 利用可能なプロジェクトリスト（課題キーのプレフィックスから抽出）
  const availableProjects = computed(() => {
    const projects = new Set<string>()
    issues.value.forEach(issue => {
      if (issue.issueKey) {
        const projectKey = issue.issueKey.split('-')[0]
        if (projectKey) {
          projects.add(projectKey)
        }
      }
    })
    return Array.from(projects).sort()
  })

  // フィルター適用後の課題リスト
  const filteredIssues = computed(() => {
    return issues.value.filter(issue => {
      // ----------------------------------------------------------------
      // 1. ステータスフィルター
      // ----------------------------------------------------------------
      if (filters.value.statusFilter) {
        const statusName = issue.status?.name

        // 'unprocessed': 未処理の課題のみ表示
        // (完了、処理済み、処理中 以外のステータス)
        if (filters.value.statusFilter === 'unprocessed') {
          if (statusName) {
            const isCompleted = completedStatuses.some(status => statusName.includes(status))
            const isResolved = resolvedStatuses.some(status => statusName.includes(status))
            const isInProgress = inProgressStatuses.some(status => statusName.includes(status))

            // 完了、解決済み、進行中のいずれかなら除外
            if (isCompleted || isResolved || isInProgress) {
              return false
            }
          }
        }
        // 'in_progress': 進行中の課題のみ表示
        else if (filters.value.statusFilter === 'in_progress') {
          // ステータス名がない、または進行中リストに含まれていない場合は除外
          if (!statusName || !inProgressStatuses.some(s => statusName.includes(s))) {
            return false
          }
        }
      }

      // ----------------------------------------------------------------
      // 2. 期限フィルター
      // ----------------------------------------------------------------
      if (filters.value.dueDateFilter) {
        const dueDate = parseDueDate(issue.dueDate)

        // 'no_due_date': 期限なし
        if (filters.value.dueDateFilter === 'no_due_date') {
          if (dueDate !== null) return false
        }
        // 'overdue': 期限切れ (今日より前)
        else if (filters.value.dueDateFilter === 'overdue') {
          if (!dueDate || !isOverdue(dueDate)) return false
        }
        // 'today': 今日が期限
        else if (filters.value.dueDateFilter === 'today') {
          if (!dueDate || !isToday(dueDate)) return false
        }
        // 'this_week': 今週が期限
        else if (filters.value.dueDateFilter === 'this_week') {
          if (!dueDate || !isThisWeek(dueDate)) return false
        }
        // 'this_month': 今月が期限
        else if (filters.value.dueDateFilter === 'this_month') {
          if (!dueDate || !isThisMonth(dueDate)) return false
        }
      }

      // ----------------------------------------------------------------
      // 3. スコアフィルター (Relevance Score)
      // ----------------------------------------------------------------
      // 指定された最小スコア未満の課題を除外
      if (issue.relevance_score < filters.value.minScore) {
        return false
      }

      // ----------------------------------------------------------------
      // 4. 優先度フィルター
      // ----------------------------------------------------------------
      // 選択された優先度に含まれない課題を除外
      if (filters.value.selectedPriorities.length > 0) {
        if (!issue.priority?.name || !filters.value.selectedPriorities.includes(issue.priority.name)) {
          return false
        }
      }

      // ----------------------------------------------------------------
      // 5. 担当者フィルター
      // ----------------------------------------------------------------
      // 選択された担当者に含まれない課題を除外
      if (filters.value.selectedAssignees.length > 0) {
        if (!issue.assignee?.name || !filters.value.selectedAssignees.includes(issue.assignee.name)) {
          return false
        }
      }

      // ----------------------------------------------------------------
      // 6. プロジェクトフィルター
      // ----------------------------------------------------------------
      // 選択されたプロジェクトに含まれない課題を除外
      if (filters.value.selectedProjects.length > 0) {
        if (issue.issueKey) {
          const projectKey = issue.issueKey.split('-')[0]
          if (!projectKey || !filters.value.selectedProjects.includes(projectKey)) {
            return false
          }
        }
      }

      // ----------------------------------------------------------------
      // 7. 検索クエリフィルター
      // ----------------------------------------------------------------
      // 課題キー、要約、説明文のいずれかにクエリが含まれているか確認
      if (filters.value.searchQuery) {
        const query = filters.value.searchQuery.toLowerCase()
        const matchesKey = issue.issueKey?.toLowerCase().includes(query)
        const matchesSummary = issue.summary?.toLowerCase().includes(query)
        const matchesDescription = issue.description?.toLowerCase().includes(query)

        // いずれにもマッチしない場合は除外
        if (!matchesKey && !matchesSummary && !matchesDescription) {
          return false
        }
      }

      // すべてのフィルターを通過した課題のみ表示
      return true
    })
  })

  return {
    filters,
    filteredIssues,
    availablePriorities,
    availableAssignees,
    availableProjects
  }
}
