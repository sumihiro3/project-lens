/**
 * Drizzle ORMスキーマ定義
 * 
 * shared/types/database.tsの型定義を基に、
 * Drizzle ORM用のSQLiteスキーマを定義します。
 */

import { 
  sqliteTable, 
  integer, 
  text, 
  real,
  primaryKey,
  index,
  uniqueIndex
} from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
// 型定義は必要に応じてインポート
// import type {...} from '../../../../shared/types/database'

// ====================
// ユーザーテーブル
// ====================
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  backlogUserId: text('backlog_user_id').notNull().unique(),
  name: text('name').notNull(),
  email: text('email'),
  avatar: text('avatar'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  lastSeen: text('last_seen'),
  preferences: text('preferences', { mode: 'json' }), // JSON数字列として保存
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  backlogUserIdIdx: uniqueIndex('users_backlog_user_id_idx').on(table.backlogUserId),
  emailIdx: index('users_email_idx').on(table.email),
  isActiveIdx: index('users_is_active_idx').on(table.isActive),
  lastSeenIdx: index('users_last_seen_idx').on(table.lastSeen)
}))

// ====================
// プロジェクトテーブル
// ====================
export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  backlogProjectId: integer('backlog_project_id').notNull().unique(),
  projectKey: text('project_key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  isFavorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
  color: text('color'),
  sortOrder: integer('sort_order').notNull().default(0),
  settings: text('settings', { mode: 'json' }),
  lastSyncAt: text('last_sync_at'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  backlogProjectIdIdx: uniqueIndex('projects_backlog_project_id_idx').on(table.backlogProjectId),
  projectKeyIdx: uniqueIndex('projects_project_key_idx').on(table.projectKey),
  isActiveIdx: index('projects_is_active_idx').on(table.isActive),
  isFavoriteIdx: index('projects_is_favorite_idx').on(table.isFavorite),
  sortOrderIdx: index('projects_sort_order_idx').on(table.sortOrder),
  lastSyncAtIdx: index('projects_last_sync_at_idx').on(table.lastSyncAt)
}))

// ====================
// イシューテーブル
// ====================
export const issues = sqliteTable('issues', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  backlogIssueId: integer('backlog_issue_id').notNull().unique(),
  issueKey: text('issue_key').notNull().unique(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull(),
  priority: text('priority').notNull(),
  issueType: text('issue_type').notNull(),
  assigneeId: integer('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  creatorId: integer('creator_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  dueDate: text('due_date'),
  startDate: text('start_date'),
  estimatedHours: real('estimated_hours'),
  actualHours: real('actual_hours'),
  tags: text('tags', { mode: 'json' }).notNull().default('[]'), // JSON配列
  isBookmarked: integer('is_bookmarked', { mode: 'boolean' }).notNull().default(false),
  isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
  customFields: text('custom_fields', { mode: 'json' }),
  backlogData: text('backlog_data', { mode: 'json' }).notNull(), // 元のBacklogデータ
  lastSyncAt: text('last_sync_at'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  backlogIssueIdIdx: uniqueIndex('issues_backlog_issue_id_idx').on(table.backlogIssueId),
  issueKeyIdx: uniqueIndex('issues_issue_key_idx').on(table.issueKey),
  projectIdIdx: index('issues_project_id_idx').on(table.projectId),
  statusIdx: index('issues_status_idx').on(table.status),
  priorityIdx: index('issues_priority_idx').on(table.priority),
  assigneeIdIdx: index('issues_assignee_id_idx').on(table.assigneeId),
  creatorIdIdx: index('issues_creator_id_idx').on(table.creatorId),
  dueDateIdx: index('issues_due_date_idx').on(table.dueDate),
  isBookmarkedIdx: index('issues_is_bookmarked_idx').on(table.isBookmarked),
  isArchivedIdx: index('issues_is_archived_idx').on(table.isArchived),
  lastSyncAtIdx: index('issues_last_sync_at_idx').on(table.lastSyncAt),
  titleSearchIdx: index('issues_title_search_idx').on(table.title),
  // 複合インデックス
  projectStatusIdx: index('issues_project_status_idx').on(table.projectId, table.status),
  assigneeStatusIdx: index('issues_assignee_status_idx').on(table.assigneeId, table.status)
}))

// ====================
// コメントテーブル
// ====================
export const comments = sqliteTable('comments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  backlogCommentId: integer('backlog_comment_id').notNull().unique(),
  issueId: integer('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  isInternal: integer('is_internal', { mode: 'boolean' }).notNull().default(false),
  attachments: text('attachments', { mode: 'json' }).notNull().default('[]'), // ファイルパスの配列
  backlogData: text('backlog_data', { mode: 'json' }).notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  backlogCommentIdIdx: uniqueIndex('comments_backlog_comment_id_idx').on(table.backlogCommentId),
  issueIdIdx: index('comments_issue_id_idx').on(table.issueId),
  userIdIdx: index('comments_user_id_idx').on(table.userId),
  isInternalIdx: index('comments_is_internal_idx').on(table.isInternal),
  createdAtIdx: index('comments_created_at_idx').on(table.createdAt)
}))

// ====================
// ラベルテーブル
// ====================
export const labels = sqliteTable('labels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  color: text('color').notNull(),
  description: text('description'),
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  nameIdx: uniqueIndex('labels_name_idx').on(table.name),
  isSystemIdx: index('labels_is_system_idx').on(table.isSystem)
}))

// ====================
// イシューラベル関連テーブル
// ====================
export const issueLabels = sqliteTable('issue_labels', {
  issueId: integer('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  labelId: integer('label_id').notNull().references(() => labels.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  pk: primaryKey({ columns: [table.issueId, table.labelId] }),
  issueIdIdx: index('issue_labels_issue_id_idx').on(table.issueId),
  labelIdIdx: index('issue_labels_label_id_idx').on(table.labelId)
}))

// ====================
// ブックマークテーブル
// ====================
export const bookmarks = sqliteTable('bookmarks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  issueId: integer('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  note: text('note'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  userIssueIdx: uniqueIndex('bookmarks_user_issue_idx').on(table.userId, table.issueId),
  userIdIdx: index('bookmarks_user_id_idx').on(table.userId),
  issueIdIdx: index('bookmarks_issue_id_idx').on(table.issueId)
}))

// ====================
// 活動ログテーブル
// ====================
export const activityLogs = sqliteTable('activity_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(), // 'issue' | 'project' | 'comment' | 'user' | 'system'
  resourceId: integer('resource_id'),
  details: text('details', { mode: 'json' }),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  userIdIdx: index('activity_logs_user_id_idx').on(table.userId),
  actionIdx: index('activity_logs_action_idx').on(table.action),
  resourceTypeIdx: index('activity_logs_resource_type_idx').on(table.resourceType),
  resourceIdIdx: index('activity_logs_resource_id_idx').on(table.resourceId),
  createdAtIdx: index('activity_logs_created_at_idx').on(table.createdAt),
  // 複合インデックス
  resourceIdx: index('activity_logs_resource_idx').on(table.resourceType, table.resourceId),
  userActionIdx: index('activity_logs_user_action_idx').on(table.userId, table.action)
}))

// ====================
// 通知テーブル
// ====================
export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  data: text('data', { mode: 'json' }),
  isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
  readAt: text('read_at'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  userIdIdx: index('notifications_user_id_idx').on(table.userId),
  typeIdx: index('notifications_type_idx').on(table.type),
  isReadIdx: index('notifications_is_read_idx').on(table.isRead),
  createdAtIdx: index('notifications_created_at_idx').on(table.createdAt),
  // 複合インデックス
  userUnreadIdx: index('notifications_user_unread_idx').on(table.userId, table.isRead)
}))

// ====================
// 設定テーブル
// ====================
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull(),
  value: text('value').notNull(), // JSON文字列で保存
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }), // nullの場合はグローバル設定
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  keyUserIdx: uniqueIndex('settings_key_user_idx').on(table.key, table.userId),
  keyIdx: index('settings_key_idx').on(table.key),
  userIdIdx: index('settings_user_id_idx').on(table.userId)
}))

// ====================
// 同期ログテーブル
// ====================
export const syncLogs = sqliteTable('sync_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  connectionId: text('connection_id').notNull(),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  syncType: text('sync_type').notNull(), // 'full' | 'incremental' | 'manual'
  status: text('status').notNull(), // 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: text('started_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  completedAt: text('completed_at'),
  itemsProcessed: integer('items_processed').notNull().default(0),
  itemsUpdated: integer('items_updated').notNull().default(0),
  itemsCreated: integer('items_created').notNull().default(0),
  itemsDeleted: integer('items_deleted').notNull().default(0),
  errorMessage: text('error_message'),
  errorDetails: text('error_details', { mode: 'json' }),
}, (table) => ({
  connectionIdIdx: index('sync_logs_connection_id_idx').on(table.connectionId),
  projectIdIdx: index('sync_logs_project_id_idx').on(table.projectId),
  syncTypeIdx: index('sync_logs_sync_type_idx').on(table.syncType),
  statusIdx: index('sync_logs_status_idx').on(table.status),
  startedAtIdx: index('sync_logs_started_at_idx').on(table.startedAt),
  completedAtIdx: index('sync_logs_completed_at_idx').on(table.completedAt)
}))

// ====================
// キャッシュテーブル
// ====================
export const cache = sqliteTable('cache', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  value: text('value').notNull(), // JSON文字列
  expiresAt: text('expires_at'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  keyIdx: uniqueIndex('cache_key_idx').on(table.key),
  expiresAtIdx: index('cache_expires_at_idx').on(table.expiresAt)
}))

// ====================
// セッションテーブル
// ====================
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  data: text('data', { mode: 'json' }),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  userIdIdx: index('sessions_user_id_idx').on(table.userId),
  expiresAtIdx: index('sessions_expires_at_idx').on(table.expiresAt)
}))

// ====================
// ファイルテーブル
// ====================
export const files = sqliteTable('files', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  originalName: text('original_name').notNull(),
  path: text('path').notNull().unique(),
  size: integer('size').notNull(),
  mimeType: text('mime_type').notNull(),
  hash: text('hash').notNull(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  issueId: integer('issue_id').references(() => issues.id, { onDelete: 'cascade' }),
  commentId: integer('comment_id').references(() => comments.id, { onDelete: 'cascade' }),
  isTemporary: integer('is_temporary', { mode: 'boolean' }).notNull().default(false),
  expiresAt: text('expires_at'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  pathIdx: uniqueIndex('files_path_idx').on(table.path),
  hashIdx: index('files_hash_idx').on(table.hash),
  userIdIdx: index('files_user_id_idx').on(table.userId),
  issueIdIdx: index('files_issue_id_idx').on(table.issueId),
  commentIdIdx: index('files_comment_id_idx').on(table.commentId),
  isTemporaryIdx: index('files_is_temporary_idx').on(table.isTemporary),
  expiresAtIdx: index('files_expires_at_idx').on(table.expiresAt)
}))

// ====================
// 検索履歴テーブル
// ====================
export const searchHistory = sqliteTable('search_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  query: text('query').notNull(),
  filters: text('filters', { mode: 'json' }),
  resultCount: integer('result_count').notNull(),
  executedAt: text('executed_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  userIdIdx: index('search_history_user_id_idx').on(table.userId),
  queryIdx: index('search_history_query_idx').on(table.query),
  executedAtIdx: index('search_history_executed_at_idx').on(table.executedAt)
}))

// ====================
// 保存された検索テーブル
// ====================
export const savedSearches = sqliteTable('saved_searches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  query: text('query').notNull(),
  filters: text('filters', { mode: 'json' }),
  isGlobal: integer('is_global', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  userNameIdx: uniqueIndex('saved_searches_user_name_idx').on(table.userId, table.name),
  userIdIdx: index('saved_searches_user_id_idx').on(table.userId),
  isGlobalIdx: index('saved_searches_is_global_idx').on(table.isGlobal),
  sortOrderIdx: index('saved_searches_sort_order_idx').on(table.sortOrder)
}))

// ====================
// ダッシュボードテーブル
// ====================
export const dashboards = sqliteTable('dashboards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  layout: text('layout', { mode: 'json' }).notNull(), // ウィジェットのレイアウト情報
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  userNameIdx: uniqueIndex('dashboards_user_name_idx').on(table.userId, table.name),
  userIdIdx: index('dashboards_user_id_idx').on(table.userId),
  isDefaultIdx: index('dashboards_is_default_idx').on(table.isDefault),
  isPublicIdx: index('dashboards_is_public_idx').on(table.isPublic),
  sortOrderIdx: index('dashboards_sort_order_idx').on(table.sortOrder)
}))

// ====================
// スキーマエクスポート
// ====================
export const schema = {
  users,
  projects,
  issues,
  comments,
  labels,
  issueLabels,
  bookmarks,
  activityLogs,
  notifications,
  settings,
  syncLogs,
  cache,
  sessions,
  files,
  searchHistory,
  savedSearches,
  dashboards
}

// ====================
// 型エクスポート（Drizzle ORM用）
// ====================
export type SelectUser = typeof users.$inferSelect
export type InsertUser = typeof users.$inferInsert
export type UpdateUser = Partial<InsertUser>

export type SelectProject = typeof projects.$inferSelect
export type InsertProject = typeof projects.$inferInsert
export type UpdateProject = Partial<InsertProject>

export type SelectIssue = typeof issues.$inferSelect
export type InsertIssue = typeof issues.$inferInsert
export type UpdateIssue = Partial<InsertIssue>

export type SelectComment = typeof comments.$inferSelect
export type InsertComment = typeof comments.$inferInsert
export type UpdateComment = Partial<InsertComment>

export type SelectLabel = typeof labels.$inferSelect
export type InsertLabel = typeof labels.$inferInsert
export type UpdateLabel = Partial<InsertLabel>

export type SelectIssueLabel = typeof issueLabels.$inferSelect
export type InsertIssueLabel = typeof issueLabels.$inferInsert

export type SelectBookmark = typeof bookmarks.$inferSelect
export type InsertBookmark = typeof bookmarks.$inferInsert
export type UpdateBookmark = Partial<InsertBookmark>

export type SelectActivityLog = typeof activityLogs.$inferSelect
export type InsertActivityLog = typeof activityLogs.$inferInsert

export type SelectNotification = typeof notifications.$inferSelect
export type InsertNotification = typeof notifications.$inferInsert
export type UpdateNotification = Partial<InsertNotification>

export type SelectSetting = typeof settings.$inferSelect
export type InsertSetting = typeof settings.$inferInsert
export type UpdateSetting = Partial<InsertSetting>

export type SelectSyncLog = typeof syncLogs.$inferSelect
export type InsertSyncLog = typeof syncLogs.$inferInsert
export type UpdateSyncLog = Partial<InsertSyncLog>

export type SelectCache = typeof cache.$inferSelect
export type InsertCache = typeof cache.$inferInsert
export type UpdateCache = Partial<InsertCache>

export type SelectSession = typeof sessions.$inferSelect
export type InsertSession = typeof sessions.$inferInsert
export type UpdateSession = Partial<InsertSession>

export type SelectFile = typeof files.$inferSelect
export type InsertFile = typeof files.$inferInsert
export type UpdateFile = Partial<InsertFile>

export type SelectSearchHistory = typeof searchHistory.$inferSelect
export type InsertSearchHistory = typeof searchHistory.$inferInsert

export type SelectSavedSearch = typeof savedSearches.$inferSelect
export type InsertSavedSearch = typeof savedSearches.$inferInsert
export type UpdateSavedSearch = Partial<InsertSavedSearch>

export type SelectDashboard = typeof dashboards.$inferSelect
export type InsertDashboard = typeof dashboards.$inferInsert
export type UpdateDashboard = Partial<InsertDashboard>

export default schema
