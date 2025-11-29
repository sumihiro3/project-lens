import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

export interface Issue {
  id: number
  issueKey: string
  summary: string
  description?: string
  priority?: { name: string }
  status?: { name: string }
  issueType?: { name: string }
  assignee?: { name: string }
  dueDate?: string
  updated?: string
  relevance_score: number
  workspace_id: number
}

/**
 * 課題データの取得と管理を行うComposable
 */
export function useIssues() {
  const issues = ref<Issue[]>([])
  const loading = ref(false)

  /**
   * 課題一覧を取得
   */
  async function loadIssues() {
    loading.value = true
    try {
      issues.value = await invoke<Issue[]>('get_issues')
    } catch (e) {
      console.error('Failed to load issues:', e)
    } finally {
      loading.value = false
    }
  }

  return {
    issues,
    loading,
    loadIssues,
    syncIssues
  }

  /**
   * Backlogと同期して課題一覧を更新
   */
  async function syncIssues() {
    loading.value = true
    try {
      await invoke('fetch_issues')
      await loadIssues()
    } catch (e) {
      console.error('Failed to sync issues:', e)
      throw e
    } finally {
      loading.value = false
    }
  }
}
