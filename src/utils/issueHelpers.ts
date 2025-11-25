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

/**
 * プロジェクトキーから一貫した色を生成
 */
export function getProjectColor(issueKey: string | undefined): string {
  if (!issueKey) return '#9E9E9E' // grey

  // プロジェクトキーを抽出（例: "PROJ-123" -> "PROJ"）
  const projectKey = issueKey.split('-')[0]
  if (!projectKey) return '#9E9E9E' // grey

  // プロジェクトキーのハッシュ値を計算
  let hash = 0
  for (let i = 0; i < projectKey.length; i++) {
    hash = projectKey.charCodeAt(i) + ((hash << 5) - hash)
  }

  // 視認性の高い色のパレット
  const colors = [
    '#2196F3', // blue
    '#4CAF50', // green
    '#FF9800', // orange
    '#9C27B0', // purple
    '#F44336', // red
    '#00BCD4', // cyan
    '#FF5722', // deep orange
    '#3F51B5', // indigo
    '#8BC34A', // light green
    '#E91E63', // pink
    '#009688', // teal
    '#FFC107', // amber
  ]

  return colors[Math.abs(hash) % colors.length]!
}

/**
 * プロジェクトキーを抽出
 */
export function extractProjectKey(issueKey: string | undefined): string {
  if (!issueKey) return ''
  const projectKey = issueKey.split('-')[0]
  return projectKey || ''
}

/**
 * 16進カラー文字列から輝度を計算し、文字色のコントラストを決定するヘルパー
 * 明るい背景なら黒文字、暗い背景なら白文字を返す
 */
export function getChipTextColor(bgColor: string): string {
  // 先頭の # を除去し、6桁の RGB に変換
  const hex = bgColor.replace('#', '')
  const r = parseInt(hex.substring(0, 2), 16) / 255
  const g = parseInt(hex.substring(2, 4), 16) / 255
  const b = parseInt(hex.substring(4, 6), 16) / 255

  // sRGB のリニア化（相対輝度計算の前処理）
  const lum = (c: number) => {
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  const L = 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b)

  // コントラスト比が 4.5 以上になるように文字色を選択（WCAG 推奨）
  return L > 0.5 ? '#000000' : '#ffffff'
}

/**
 * 更新日時を相対時間で表示（例: "たった今", "1分前", "1時間前"）
 */
export function formatRelativeTime(dateStr: string | undefined): string {
  if (!dateStr) return ''

  const date = parseDueDate(dateStr)
  if (!date) return ''

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) {
    return 'たった今'
  } else if (diffMin < 60) {
    return `${diffMin}分前`
  } else if (diffHour < 24) {
    return `${diffHour}時間前`
  } else if (diffDay < 7) {
    return `${diffDay}日前`
  } else {
    // 1週間以上前は日付を表示
    return formatDate(dateStr)
  }
}
