/**
 * データベーススキーマ型（Drizzle ORM用）
 */

import type { BacklogIssue, BacklogComment } from './backlog'
// import type { BacklogProject, BacklogUser } from './backlog' // 将来使用するためコメントアウト
// import type { AppSettings } from './settings' // 将来使用するためコメントアウト

// ユーザーテーブル
export interface User {
  id: number
  backlogUserId: string
  name: string
  email?: string
  avatar?: string
  isActive: boolean
  lastSeen?: Date
  preferences?: UserPreferences
  createdAt: Date
  updatedAt: Date
}

// プロジェクトテーブル
export interface Project {
  id: number
  backlogProjectId: number
  projectKey: string
  name: string
  description?: string
  isActive: boolean
  isFavorite: boolean
  color?: string
  sortOrder: number
  settings?: ProjectSettings
  lastSyncAt?: Date
  createdAt: Date
  updatedAt: Date
}

// イシューテーブル
export interface Issue {
  id: number
  backlogIssueId: number
  issueKey: string
  projectId: number
  title: string
  description?: string
  status: string
  priority: string
  issueType: string
  assigneeId?: number
  creatorId: number
  dueDate?: Date
  startDate?: Date
  estimatedHours?: number
  actualHours?: number
  tags: string[]
  isBookmarked: boolean
  isArchived: boolean
  customFields?: Record<string, unknown>
  backlogData: BacklogIssue // 元のBacklogデータをJSONで保存
  lastSyncAt?: Date
  createdAt: Date
  updatedAt: Date
}

// コメントテーブル
export interface Comment {
  id: number
  backlogCommentId: number
  issueId: number
  userId: number
  content: string
  isInternal: boolean
  attachments: string[] // ファイルパスの配列
  backlogData: BacklogComment // 元のBacklogデータをJSONで保存
  createdAt: Date
  updatedAt: Date
}

// ラベルテーブル
export interface Label {
  id: number
  name: string
  color: string
  description?: string
  isSystem: boolean
  createdAt: Date
  updatedAt: Date
}

// イシューラベル関連テーブル
export interface IssueLabel {
  issueId: number
  labelId: number
  createdAt: Date
}

// ブックマークテーブル
export interface Bookmark {
  id: number
  userId: number
  issueId: number
  note?: string
  createdAt: Date
  updatedAt: Date
}

// 活動ログテーブル
export interface ActivityLog {
  id: number
  userId: number
  action: string
  resourceType: 'issue' | 'project' | 'comment' | 'user' | 'system'
  resourceId?: number
  details?: ActivityLogDetails
  ipAddress?: string
  userAgent?: string
  createdAt: Date
}

// 通知テーブル
export interface Notification {
  id: number
  userId: number
  type: string
  title: string
  message: string
  data?: NotificationData
  isRead: boolean
  readAt?: Date
  createdAt: Date
  updatedAt: Date
}

// 設定テーブル
export interface Setting {
  id: number
  key: string
  value: string // JSON文字列で保存
  userId?: number // nullの場合はグローバル設定
  createdAt: Date
  updatedAt: Date
}

// 同期ログテーブル
export interface SyncLog {
  id: number
  connectionId: string
  projectId?: number
  syncType: 'full' | 'incremental' | 'manual'
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: Date
  completedAt?: Date
  itemsProcessed: number
  itemsUpdated: number
  itemsCreated: number
  itemsDeleted: number
  errorMessage?: string
  errorDetails?: Record<string, unknown>
}

// キャッシュテーブル
export interface Cache {
  id: number
  key: string
  value: string // JSON文字列
  expiresAt?: Date
  createdAt: Date
  updatedAt: Date
}

// セッションテーブル
export interface Session {
  id: string
  userId: number
  data?: Record<string, unknown>
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}

// ファイルテーブル
export interface File {
  id: number
  name: string
  originalName: string
  path: string
  size: number
  mimeType: string
  hash: string
  userId: number
  issueId?: number
  commentId?: number
  isTemporary: boolean
  expiresAt?: Date
  createdAt: Date
  updatedAt: Date
}

// 検索履歴テーブル
export interface SearchHistory {
  id: number
  userId: number
  query: string
  filters?: SearchFilters
  resultCount: number
  executedAt: Date
}

// 保存された検索テーブル
export interface SavedSearch {
  id: number
  userId: number
  name: string
  description?: string
  query: string
  filters?: SearchFilters
  isGlobal: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

// ダッシュボードテーブル
export interface Dashboard {
  id: number
  userId: number
  name: string
  description?: string
  layout: DashboardLayout // ウィジェットのレイアウト情報
  isDefault: boolean
  isPublic: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

// データベーススキーマ全体
export interface DatabaseSchema {
  users: User[]
  projects: Project[]
  issues: Issue[]
  comments: Comment[]
  labels: Label[]
  issueLabels: IssueLabel[]
  bookmarks: Bookmark[]
  activityLogs: ActivityLog[]
  notifications: Notification[]
  settings: Setting[]
  syncLogs: SyncLog[]
  cache: Cache[]
  sessions: Session[]
  files: File[]
  searchHistory: SearchHistory[]
  savedSearches: SavedSearch[]
  dashboards: Dashboard[]
}

// Drizzle ORM用の型ユーティリティ
export type InsertUser = Omit<User, 'id' | 'createdAt' | 'updatedAt'>
export type UpdateUser = Partial<InsertUser>
export type SelectUser = User

export type InsertProject = Omit<Project, 'id' | 'createdAt' | 'updatedAt'>
export type UpdateProject = Partial<InsertProject>
export type SelectProject = Project

export type InsertIssue = Omit<Issue, 'id' | 'createdAt' | 'updatedAt'>
export type UpdateIssue = Partial<InsertIssue>
export type SelectIssue = Issue

export type InsertComment = Omit<Comment, 'id' | 'createdAt' | 'updatedAt'>
export type UpdateComment = Partial<InsertComment>
export type SelectComment = Comment

// クエリ用の型
export interface IssueWithRelations extends Issue {
  project?: Project
  assignee?: User
  creator?: User
  comments?: Comment[]
  labels?: Label[]
  bookmarks?: Bookmark[]
}

export interface ProjectWithRelations extends Project {
  issues?: Issue[]
  issueCount?: number
  lastActivity?: Date
}

export interface UserWithRelations extends User {
  assignedIssues?: Issue[]
  createdIssues?: Issue[]
  bookmarks?: Bookmark[]
  notifications?: Notification[]
}

// データベース関連の追加型定義

/**
 * ユーザー設定
 */
export interface UserPreferences {
  /** テーマ設定 */
  theme?: 'light' | 'dark' | 'system'
  /** 言語設定 */
  language?: 'ja' | 'en'
  /** 通知設定 */
  notifications?: {
    email?: boolean
    desktop?: boolean
    sound?: boolean
  }
  /** ダッシュボード設定 */
  dashboard?: {
    defaultView?: string
    refreshInterval?: number
  }
  /** その他の設定 */
  [key: string]: unknown
}

/**
 * プロジェクト設定
 */
export interface ProjectSettings {
  /** 自動同期設定 */
  autoSync?: {
    enabled: boolean
    interval: number // minutes
  }
  /** ラベル設定 */
  labels?: {
    colors: Record<string, string>
    autoAssign: boolean
  }
  /** 通知設定 */
  notifications?: {
    newIssues: boolean
    statusChanges: boolean
    comments: boolean
  }
  /** その他の設定 */
  [key: string]: unknown
}

/**
 * アクティビティログの詳細情報
 */
export interface ActivityLogDetails {
  /** 変更前の値 */
  before?: Record<string, unknown>
  /** 変更後の値 */
  after?: Record<string, unknown>
  /** 変更理由 */
  reason?: string
  /** 関連するID */
  relatedIds?: number[]
  /** その他の詳細 */
  [key: string]: unknown
}

/**
 * 通知データ
 */
export interface NotificationData {
  /** 関連するリソース */
  resource?: {
    type: string
    id: number
    name?: string
  }
  /** アクション情報 */
  action?: {
    type: string
    url?: string
    label?: string
  }
  /** その他のデータ */
  [key: string]: unknown
}

/**
 * 検索フィルター
 */
export interface SearchFilters {
  /** プロジェクトフィルター */
  projects?: number[]
  /** ステータスフィルター */
  statuses?: string[]
  /** 優先度フィルター */
  priorities?: string[]
  /** 担当者フィルター */
  assignees?: number[]
  /** 作成者フィルター */
  creators?: number[]
  /** 期間フィルター */
  dateRange?: {
    start?: string
    end?: string
    field?: 'createdAt' | 'updatedAt' | 'dueDate'
  }
  /** ラベルフィルター */
  labels?: number[]
  /** その他のフィルター */
  [key: string]: unknown
}

/**
 * ダッシュボードレイアウト
 */
export interface DashboardLayout {
  /** ウィジェットの配置 */
  widgets: {
    id: string
    type: string
    x: number
    y: number
    width: number
    height: number
    config?: Record<string, unknown>
  }[]
  /** グリッド設定 */
  grid?: {
    columns: number
    rowHeight: number
    margin: [number, number]
  }
  /** その他の設定 */
  [key: string]: unknown
}
