import { ref, computed, type Ref } from 'vue'
import type { Issue } from './useIssues'
import { parseDueDate, isOverdue, isToday, isThisWeek, isThisMonth } from '../utils/issueHelpers'

export interface FilterState {
  searchQuery: string
  statusFilter: string
  dueDateFilter: string
  minScore: number
  selectedPriorities: string[]
  selectedAssignees: string[]
}

/**
 * 課題フィルタリング機能を提供するComposable
 */
export function useIssueFilters(issues: Ref<Issue[]>) {
  // フィルター状態
  const filters = ref<FilterState>({
    searchQuery: '',
    statusFilter: 'hide_completed', // デフォルト：完了を非表示
    dueDateFilter: '',
    minScore: 0,
    selectedPriorities: [],
    selectedAssignees: []
  })

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

  // フィルター適用後の課題リスト
  const filteredIssues = computed(() => {
    return issues.value.filter(issue => {
      // ステータスフィルター
      if (filters.value.statusFilter === 'unprocessed') {
        if (issue.status?.name) {
          const statusName = issue.status.name
          const isCompleted = completedStatuses.some(status => statusName.includes(status))
          const isResolved = resolvedStatuses.some(status => statusName.includes(status))
          const isInProgress = inProgressStatuses.some(status => statusName.includes(status))

          if (isCompleted || isResolved || isInProgress) {
            return false
          }
        }
      } else if (filters.value.statusFilter === 'in_progress') {
        const statusName = issue.status?.name
        if (!statusName || !inProgressStatuses.some(s => statusName.includes(s))) {
          return false
        }

      } else if (filters.value.statusFilter === 'hide_completed') {
        const statusName = issue.status?.name
        if (statusName && completedStatuses.some(status => statusName.includes(status))) {
          return false
        }


        // 期限フィルター
        if (filters.value.dueDateFilter) {
          const dueDate = parseDueDate(issue.dueDate)

          if (filters.value.dueDateFilter === 'no_due_date') {
            if (dueDate !== null) return false
          } else if (filters.value.dueDateFilter === 'overdue') {
            if (!dueDate || !isOverdue(dueDate)) return false
          } else if (filters.value.dueDateFilter === 'today') {
            if (!dueDate || !isToday(dueDate)) return false
          } else if (filters.value.dueDateFilter === 'this_week') {
            if (!dueDate || !isThisWeek(dueDate)) return false
          } else if (filters.value.dueDateFilter === 'this_month') {
            if (!dueDate || !isThisMonth(dueDate)) return false
          }
        }

        // スコアフィルター
        if (issue.relevance_score < filters.value.minScore) {
          return false
        }

        // 優先度フィルター
        if (filters.value.selectedPriorities.length > 0) {
          if (!issue.priority?.name || !filters.value.selectedPriorities.includes(issue.priority.name)) {
            return false
          }
        }

        // 担当者フィルター
        if (filters.value.selectedAssignees.length > 0) {
          if (!issue.assignee?.name || !filters.value.selectedAssignees.includes(issue.assignee.name)) {
            return false
          }
        }

        // 検索クエリフィルター
        if (filters.value.searchQuery) {
          const query = filters.value.searchQuery.toLowerCase()
          const matchesKey = issue.issueKey?.toLowerCase().includes(query)
          const matchesSummary = issue.summary?.toLowerCase().includes(query)
          const matchesDescription = issue.description?.toLowerCase().includes(query)

          if (!matchesKey && !matchesSummary && !matchesDescription) {
            return false
          }
        }

        return true
      }
    })
  })

  return {
    filters,
    filteredIssues,
    availablePriorities,
    availableAssignees
  }
}
