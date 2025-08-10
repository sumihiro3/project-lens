/**
 * 基本的な共通型定義
 */

/**
 * APIレスポンスの基本型
 * @template T - レスポンスデータの型
 */
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
  timestamp: string
}

/**
 * ページネーションパラメータ
 */
export interface PaginationParams {
  page: number
  limit: number
  sort?: string
  order?: 'asc' | 'desc'
}

/**
 * ページネーション対応のレスポンス型
 * @template T - アイテムの型
 */
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
export interface FilterOption<T = unknown> {
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

/**
 * アプリケーションエラー型
 * エラーコード、メッセージ、詳細情報を含む標準化されたエラー形式
 */
export interface AppError {
  code: string
  message: string
  details?: Record<string, unknown>
  timestamp: string
}

/**
 * ローディング状態
 * UIコンポーネントでローディング表示を制御するための型
 */
export interface LoadingState {
  isLoading: boolean
  message?: string
}

/**
 * 検索パラメータ
 * 検索クエリ、フィルター、ページネーションを含む汎用的な検索設定
 */
export interface SearchParams {
  query: string
  filters?: Record<string, unknown>
  pagination?: PaginationParams
}

/**
 * キーバインド設定
 * ショートカットキーとアクションの関連付けを定義
 */
export interface KeyBinding {
  key: string
  modifiers?: ('ctrl' | 'cmd' | 'alt' | 'shift')[]
  action: string
  description: string
}

/**
 * ユーティリティ型
 */

/**
 * 指定したフィールドをオプショナルにする
 * @template T - ベース型
 * @template K - オプショナルにするフィールド
 */
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

/**
 * 指定したフィールドを必須にする
 * @template T - ベース型
 * @template K - 必須にするフィールド
 */
export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>

/**
 * 深い部分的型（ネストしたオブジェクトもオプショナルにする）
 * @template T - ベース型
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}
