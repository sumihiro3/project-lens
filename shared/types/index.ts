/**
 * 型定義の統合エクスポート
 */

// 共通型
export type * from './common'

// Backlog関連型
export type * from './backlog'

// 設定関連型
export type * from './settings'

// データベース関連型
// export type * from './database' // Notification型の競合を避けるためコメントアウト

// AI関連型
export type * from './ai'

// Electron関連型
export type * from './electron'

// ログ関連型
export type * from './logging'

// 再エクスポート（個別インポート用）
// 注意: common.tsとdatabase.tsの両方にNotification型があるため、別名でエクスポート
export * from './backlog'
export * from './settings'
export * from './ai'
export * from './electron'
export * from './logging'

// 競合しない型を個別エクスポート
export type {
  // common.tsから
  ApiResponse,
  PaginationParams,
  PaginatedResponse,
  BaseEntity,
  FileInfo,
  ColorVariant,
  SizeVariant,
  NotificationLevel,
  Notification as CommonNotification,
  NotificationAction,
  FilterOption,
  SortOption,
  ThemeMode,
  Locale,
  AppError,
  LoadingState,
  SearchParams,
  KeyBinding,
  Optional,
  RequiredFields,
  DeepPartial,
} from './common'

export type {
  // database.tsから
  User,
  Project,
  Issue,
  Comment,
  Label,
  IssueLabel,
  Bookmark,
  ActivityLog,
  Notification as DatabaseNotification,
  Setting,
  SyncLog,
  Cache,
  Session,
  File,
  SearchHistory,
  SavedSearch,
  Dashboard,
  DatabaseSchema,
  InsertUser,
  UpdateUser,
  SelectUser,
  InsertProject,
  UpdateProject,
  SelectProject,
  InsertIssue,
  UpdateIssue,
  SelectIssue,
  InsertComment,
  UpdateComment,
  SelectComment,
  IssueWithRelations,
  ProjectWithRelations,
  UserWithRelations,
} from './database'
