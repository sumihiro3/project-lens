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
  /** AI生成の1行要約（ai_results.summary から LEFT JOIN） */
  ai_summary?: string
  /** AI判定のリスクレベル（high / medium / low） */
  ai_risk_level?: 'high' | 'medium' | 'low'
  /** AI生成の対応提案（ai_results.suggestion から LEFT JOIN） */
  ai_suggestion?: string
  /** SQL算出の遅延日数（ai_results.delay_days から LEFT JOIN） */
  ai_delay_days?: number
  /** AI処理完了日時（ISO 8601 文字列） */
  ai_processed_at?: string
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
    syncIssues,
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
