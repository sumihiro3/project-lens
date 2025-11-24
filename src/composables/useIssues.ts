import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

export interface Issue {
  id: number
  issueKey: string
  summary: string
  description?: string
  priority?: { name: string }
  status?: { name: string }
  assignee?: { name: string }
  dueDate?: string
  relevance_score: number
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
    loadIssues
  }
}
