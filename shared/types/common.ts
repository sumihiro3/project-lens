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

/**
 * 基本エンティティ型
 * すべてのデータベースエンティティが継承する基本構造
 */
export interface BaseEntity {
  /** エンティティの一意識別子 */
  id: number
  /** 作成日時（ISO文字列） */
  createdAt: string
  /** 更新日時（ISO文字列） */
  updatedAt: string
}

/**
 * ファイル情報
 * アップロードファイルや添付ファイルの基本情報
 */
export interface FileInfo {
  /** ファイル名 */
  name: string
  /** ファイルサイズ（バイト） */
  size: number
  /** MIMEタイプ */
  type: string
  /** ファイルのURL（オプション） */
  url?: string
  /** ファイルパス（オプション） */
  path?: string
}

/**
 * UI色バリアント
 * Vuetifyのカラーシステムに対応した色の種類
 */
export type ColorVariant = 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info'

/**
 * UIサイズバリアント
 * コンポーネントサイズの統一的な指定
 */
export type SizeVariant = 'x-small' | 'small' | 'default' | 'large' | 'x-large'

/**
 * 通知レベル
 * 通知メッセージの重要度を表すレベル
 */
export type NotificationLevel = 'info' | 'success' | 'warning' | 'error'

/**
 * 通知メッセージ型
 * アプリケーション内で表示される通知の構造
 */
export interface Notification {
  /** 通知の一意識別子 */
  id: string
  /** 通知レベル（重要度） */
  level: NotificationLevel
  /** 通知のタイトル */
  title: string
  /** 通知のメッセージ内容 */
  message: string
  /** 通知作成日時（ISO文字列） */
  timestamp: string
  /** 既読状態 */
  read: boolean
  /** 通知に対するアクションボタン（オプション） */
  actions?: NotificationAction[]
}

/**
 * 通知アクション設定
 * 通知に表示されるアクションボタンの設定
 */
export interface NotificationAction {
  /** ボタンラベル */
  label: string
  /** クリック時の実行関数 */
  action: () => void | Promise<void>
  /** ボタンの色バリアント（オプション） */
  variant?: ColorVariant
}

/**
 * フィルター選択肢
 * ドロップダウンやセレクトボックスで使用するオプション
 * @template T - オプションの値の型
 */
export interface FilterOption<T = string | number | boolean> {
  /** 表示ラベル */
  label: string
  /** オプションの値 */
  value: T
  /** 無効状態（オプション） */
  disabled?: boolean
}

/**
 * ソート設定
 * データのソート条件を指定するための設定
 */
export interface SortOption {
  /** ソート対象のフィールド名 */
  field: string
  /** 表示用ラベル */
  label: string
  /** ソート方向 */
  direction: 'asc' | 'desc'
}

/**
 * テーマモード
 * アプリケーションの表示テーマ
 */
export type ThemeMode = 'light' | 'dark' | 'system'

/**
 * ロケール設定
 * サポートする言語コード
 */
export type Locale = 'ja' | 'en'

/**
 * アプリケーションエラー型
 * エラーコード、メッセージ、詳細情報を含む標準化されたエラー形式
 */
export interface AppError {
  code: string
  message: string
  details?: Record<string, string | number | boolean>
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
  filters?: Record<string, string | number | boolean | string[]>
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
