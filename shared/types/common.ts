/**
 * 基本的な共通型定義
 */

// APIレスポンスの基本型
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
  timestamp: string
}

// ページネーション関連
export interface PaginationParams {
  page: number
  limit: number
  sort?: string
  order?: 'asc' | 'desc'
}

export interface PaginatedResponse<T> {
  items: T[]
  totalCount: number
  currentPage: number
  totalPages: number
  hasNextPage: boolean
  hasPreviousPage: boolean
}

// 基本的なエンティティ型
export interface BaseEntity {
  id: number
  createdAt: string
  updatedAt: string
}

// ファイル関連
export interface FileInfo {
  name: string
  size: number
  type: string
  url?: string
  path?: string
}

// 色関連
export type ColorVariant = 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info'

// サイズ関連
export type SizeVariant = 'x-small' | 'small' | 'default' | 'large' | 'x-large'

// 通知レベル
export type NotificationLevel = 'info' | 'success' | 'warning' | 'error'

// 通知型
export interface Notification {
  id: string
  level: NotificationLevel
  title: string
  message: string
  timestamp: string
  read: boolean
  actions?: NotificationAction[]
}

export interface NotificationAction {
  label: string
  action: () => void | Promise<void>
  variant?: ColorVariant
}

// フィルター関連
export interface FilterOption<T = any> {
  label: string
  value: T
  disabled?: boolean
}

// ソート関連
export interface SortOption {
  field: string
  label: string
  direction: 'asc' | 'desc'
}

// テーマ関連
export type ThemeMode = 'light' | 'dark' | 'system'

// 言語関連
export type Locale = 'ja' | 'en'

// エラー型
export interface AppError {
  code: string
  message: string
  details?: Record<string, any>
  timestamp: string
}

// ローディング状態
export interface LoadingState {
  isLoading: boolean
  message?: string
}

// 検索関連
export interface SearchParams {
  query: string
  filters?: Record<string, any>
  pagination?: PaginationParams
}

// キーバインド関連
export interface KeyBinding {
  key: string
  modifiers?: ('ctrl' | 'cmd' | 'alt' | 'shift')[]
  action: string
  description: string
}

// ユーティリティ型
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>
export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}
