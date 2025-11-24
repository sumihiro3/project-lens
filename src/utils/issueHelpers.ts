/**
 * 課題関連のヘルパー関数
 */

/**
 * 優先度に応じた色を取得
 */
export function getPriorityColor(priority: string | undefined): string {
  if (!priority) return 'grey'
  if (priority === 'High' || priority === '高') return 'red'
  if (priority === 'Normal' || priority === '中') return 'blue'
  return 'grey'
}

/**
 * ステータスに応じた色を取得
 */
export function getStatusColor(status: string | undefined): string {
  const completedStatuses = ['完了', 'Closed', 'Done']
  const resolvedStatuses = ['処理済み', 'Resolved']
  const inProgressStatuses = ['処理中', 'In Progress', 'Working', '対応中']

  if (!status) return 'grey'
  if (completedStatuses.some(s => status.includes(s))) return 'green'
  if (resolvedStatuses.some(s => status.includes(s))) return 'green'
  if (inProgressStatuses.some(s => status.includes(s))) return 'orange'
  return 'grey'
}

/**
 * 期限に応じた色を取得
 */
export function getDueDateColor(dueDateStr: string | undefined): string {
  const dueDate = parseDueDate(dueDateStr)
  if (!dueDate) return 'grey'
  if (isOverdue(dueDate)) return 'red'
  if (isToday(dueDate)) return 'orange'
  if (isThisWeek(dueDate)) return 'yellow'
  return 'grey'
}

/**
 * 日付文字列をDateオブジェクトにパース
 */
export function parseDueDate(dueDateStr: string | undefined): Date | null {
  if (!dueDateStr) return null
  try {
    const date = new Date(dueDateStr)
    return isNaN(date.getTime()) ? null : date
  } catch {
    return null
  }
}

/**
 * 日付をフォーマット（MM/DD形式）
 */
export function formatDate(dueDateStr: string | undefined): string {
  if (!dueDateStr) return ''
  const date = parseDueDate(dueDateStr)
  if (!date) return dueDateStr
  return date.toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })
}

/**
 * 期限切れかどうか判定
 */
export function isOverdue(dueDate: Date): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return dueDate < today
}

/**
 * 今日が期限かどうか判定
 */
export function isToday(dueDate: Date): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  return dueDate >= today && dueDate < tomorrow
}

/**
 * 今週が期限かどうか判定
 */
export function isThisWeek(dueDate: Date): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const weekEnd = new Date(today)
  weekEnd.setDate(weekEnd.getDate() + (7 - today.getDay()))
  return dueDate >= today && dueDate <= weekEnd
}

/**
 * 今月が期限かどうか判定
 */
export function isThisMonth(dueDate: Date): boolean {
  const today = new Date()
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0)
  return dueDate >= today && dueDate <= monthEnd
}
