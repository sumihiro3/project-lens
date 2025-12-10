import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useIssueFilters } from './useIssueFilters'
import { ref } from 'vue'

// Mock invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd) => {
    if (cmd === 'get_settings') return Promise.resolve(null)
    if (cmd === 'get_workspaces') return Promise.resolve([])
    return Promise.resolve(null)
  })
}))

describe('useIssueFilters (課題フィルター)', () => {
  // Setup dummy issues
  const issues = ref<any[]>([
    {
      id: 1,
      issueKey: 'PROJ-1',
      summary: 'Issue One',
      relevance_score: 10,
      priority: { name: 'Low' },
      status: { name: 'Open' },
      assignee: { name: 'User1' },
      workspace_id: 1,
      dueDate: '2023-01-20'
    },
    {
      id: 2,
      issueKey: 'PROJ-2',
      summary: 'Issue Two',
      relevance_score: 90,
      priority: { name: 'High' },
      status: { name: 'In Progress' },
      assignee: { name: 'User2' },
      workspace_id: 1,
      dueDate: '2023-01-21'
    },
    {
      id: 3,
      issueKey: 'PROJ-3',
      summary: 'Issue Three',
      relevance_score: 50,
      priority: { name: 'Normal' },
      status: { name: 'Done' }, // Changed from 'Completed' to 'Done' to match filter logic
      assignee: { name: 'User1' },
      workspace_id: 1,
      dueDate: null
    }
  ])

  const { filters, filteredIssues } = useIssueFilters(issues)

  beforeEach(() => {
    // Reset filters
    filters.value = {
      searchQuery: '',
      statusFilter: 'all',
      dueDateFilter: '',
      dueSoonDays: null,
      stagnantDays: null,
      minScore: 0,
      selectedPriorities: [],
      selectedAssignees: [],
      selectedProjects: [],
      sortKey: 'relevance_score',
      sortOrder: 'desc'
    }
  })

  it('デフォルトでは全ての課題を返すこと', () => {
    expect(filteredIssues.value.length).toBe(3)
  })

  it('検索クエリでフィルタリングできること', () => {
    filters.value.searchQuery = 'One'
    expect(filteredIssues.value.length).toBe(1)
    expect(filteredIssues.value[0].issueKey).toBe('PROJ-1')
  })

  it('未処理ステータスでフィルタリングできること', () => {
    filters.value.statusFilter = 'unprocessed'
    // unprocessed means NOT (completed OR resolved OR in_progress)
    // PROJ-1: Open (matches unprocessed)
    // PROJ-2: In Progress (excluded)
    // PROJ-3: Done (excluded)
    expect(filteredIssues.value.length).toBe(1)
    expect(filteredIssues.value[0].issueKey).toBe('PROJ-1')
  })

  it('最小スコアでフィルタリングできること', () => {
    filters.value.minScore = 60
    expect(filteredIssues.value.length).toBe(1)
    expect(filteredIssues.value[0].issueKey).toBe('PROJ-2')
  })

  it('デフォルトでスコア降順にソートされること', () => {
    expect(filteredIssues.value[0].issueKey).toBe('PROJ-2') // 90
    expect(filteredIssues.value[1].issueKey).toBe('PROJ-3') // 50
    expect(filteredIssues.value[2].issueKey).toBe('PROJ-1') // 10
  })

  it('優先度でソートされること', () => {
    filters.value.sortKey = 'priority'
    filters.value.sortOrder = 'desc'
    // High > Normal > Low
    expect(filteredIssues.value[0].issueKey).toBe('PROJ-2') // High
    expect(filteredIssues.value[1].issueKey).toBe('PROJ-3') // Normal
    expect(filteredIssues.value[2].issueKey).toBe('PROJ-1') // Low
  })
})
