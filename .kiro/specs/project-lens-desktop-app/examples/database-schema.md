# データベーススキーマ実装例

## Drizzle ORM スキーマ定義

### database/schema.ts

```typescript
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'

// スペーステーブル
export const spaces = sqliteTable('spaces', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  domain: text('domain').notNull().unique(),
  apiKey: text('api_key').notNull(), // 暗号化されたAPIキー
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  lastSyncAt: integer('last_sync_at', { mode: 'timestamp' }),
  created: integer('created', { mode: 'timestamp' }).notNull(),
  updated: integer('updated', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  domainIdx: index('idx_spaces_domain').on(table.domain),
  activeIdx: index('idx_spaces_active').on(table.isActive),
}))

// チケットテーブル
export const issues = sqliteTable('issues', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  spaceId: integer('space_id').notNull().references(() => spaces.id),
  projectId: integer('project_id').notNull(),
  backlogIssueId: integer('backlog_issue_id').notNull(),
  key: text('key').notNull(),
  summary: text('summary').notNull(),
  description: text('description'),
  statusId: integer('status_id').notNull(),
  priorityId: integer('priority_id').notNull(),
  assigneeId: integer('assignee_id'),
  dueDate: integer('due_date', { mode: 'timestamp' }),
  score: real('score'),
  priority: text('priority', { enum: ['critical', 'important', 'normal'] }),
  created: integer('created', { mode: 'timestamp' }).notNull(),
  updated: integer('updated', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  spaceUpdatedIdx: index('idx_issues_space_updated').on(table.spaceId, table.updated),
  assigneeDueIdx: index('idx_issues_assignee_due').on(table.assigneeId, table.dueDate),
  priorityScoreIdx: index('idx_issues_priority_score').on(table.priority, table.score),
  backlogIssueIdx: index('idx_issues_backlog_issue').on(table.spaceId, table.backlogIssueId),
}))

// コメントテーブル
export const comments = sqliteTable('comments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  issueId: integer('issue_id').notNull().references(() => issues.id),
  backlogCommentId: integer('backlog_comment_id').notNull(),
  content: text('content').notNull(),
  authorId: integer('author_id').notNull(),
  authorName: text('author_name').notNull(),
  created: integer('created', { mode: 'timestamp' }).notNull(),
  updated: integer('updated', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  issueIdx: index('idx_comments_issue').on(table.issueId),
  authorIdx: index('idx_comments_author').on(table.authorId),
  createdIdx: index('idx_comments_created').on(table.created),
}))

// メンションテーブル
export const mentions = sqliteTable('mentions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  commentId: integer('comment_id').notNull().references(() => comments.id),
  mentionedUserId: integer('mentioned_user_id').notNull(),
  mentionedUserName: text('mentioned_user_name').notNull(),
  created: integer('created', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  userIdx: index('idx_mentions_user').on(table.mentionedUserId),
  commentIdx: index('idx_mentions_comment').on(table.commentId),
}))

// AIキャッシュテーブル
export const aiCache = sqliteTable('ai_cache', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  type: text('type', { enum: ['summary', 'advice'] }).notNull(),
  content: text('content').notNull(),
  metadata: text('metadata'), // JSON文字列
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  created: integer('created', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  keyIdx: index('idx_ai_cache_key').on(table.key),
  expiresIdx: index('idx_ai_cache_expires').on(table.expiresAt),
  typeIdx: index('idx_ai_cache_type').on(table.type),
}))

// 設定テーブル
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
  type: text('type', { enum: ['string', 'number', 'boolean', 'json'] }).notNull(),
  updated: integer('updated', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  keyIdx: index('idx_settings_key').on(table.key),
}))

// ユーザープロファイルテーブル
export const userProfiles = sqliteTable('user_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  spaceId: integer('space_id').notNull().references(() => spaces.id),
  backlogUserId: integer('backlog_user_id').notNull(),
  name: text('name').notNull(),
  mailAddress: text('mail_address'),
  iconUrl: text('icon_url'),
  isCurrentUser: integer('is_current_user', { mode: 'boolean' }).notNull().default(false),
  created: integer('created', { mode: 'timestamp' }).notNull(),
  updated: integer('updated', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  spaceUserIdx: index('idx_user_profiles_space_user').on(table.spaceId, table.backlogUserId),
  currentUserIdx: index('idx_user_profiles_current').on(table.isCurrentUser),
}))

// 通知履歴テーブル
export const notificationHistory = sqliteTable('notification_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type', { enum: ['critical', 'important', 'info'] }).notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  issueIds: text('issue_ids'), // JSON配列文字列
  shown: integer('shown', { mode: 'boolean' }).notNull().default(false),
  clicked: integer('clicked', { mode: 'boolean' }).notNull().default(false),
  created: integer('created', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  typeIdx: index('idx_notification_history_type').on(table.type),
  createdIdx: index('idx_notification_history_created').on(table.created),
  shownIdx: index('idx_notification_history_shown').on(table.shown),
}))

// 同期状態テーブル
export const syncStatus = sqliteTable('sync_status', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  spaceId: integer('space_id').notNull().references(() => spaces.id),
  syncType: text('sync_type', { enum: ['full', 'incremental', 'comments'] }).notNull(),
  status: text('status', { enum: ['pending', 'running', 'completed', 'failed'] }).notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  errorMessage: text('error_message'),
  itemsProcessed: integer('items_processed').notNull().default(0),
  totalItems: integer('total_items'),
  created: integer('created', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  spaceTypeIdx: index('idx_sync_status_space_type').on(table.spaceId, table.syncType),
  statusIdx: index('idx_sync_status_status').on(table.status),
}))

// リレーション定義
export const spacesRelations = relations(spaces, ({ many }) => ({
  issues: many(issues),
  userProfiles: many(userProfiles),
  syncStatus: many(syncStatus),
}))

export const issuesRelations = relations(issues, ({ one, many }) => ({
  space: one(spaces, {
    fields: [issues.spaceId],
    references: [spaces.id],
  }),
  comments: many(comments),
  assignee: one(userProfiles, {
    fields: [issues.assigneeId],
    references: [userProfiles.backlogUserId],
  }),
}))

export const commentsRelations = relations(comments, ({ one, many }) => ({
  issue: one(issues, {
    fields: [comments.issueId],
    references: [issues.id],
  }),
  mentions: many(mentions),
  author: one(userProfiles, {
    fields: [comments.authorId],
    references: [userProfiles.backlogUserId],
  }),
}))

export const mentionsRelations = relations(mentions, ({ one }) => ({
  comment: one(comments, {
    fields: [mentions.commentId],
    references: [comments.id],
  }),
  mentionedUser: one(userProfiles, {
    fields: [mentions.mentionedUserId],
    references: [userProfiles.backlogUserId],
  }),
}))

export const userProfilesRelations = relations(userProfiles, ({ one, many }) => ({
  space: one(spaces, {
    fields: [userProfiles.spaceId],
    references: [spaces.id],
  }),
  assignedIssues: many(issues),
  comments: many(comments),
  mentions: many(mentions),
}))

export const syncStatusRelations = relations(syncStatus, ({ one }) => ({
  space: one(spaces, {
    fields: [syncStatus.spaceId],
    references: [spaces.id],
  }),
}))

// 型エクスポート
export type Space = typeof spaces.$inferSelect
export type NewSpace = typeof spaces.$inferInsert
export type Issue = typeof issues.$inferSelect
export type NewIssue = typeof issues.$inferInsert
export type Comment = typeof comments.$inferSelect
export type NewComment = typeof comments.$inferInsert
export type Mention = typeof mentions.$inferSelect
export type NewMention = typeof mentions.$inferInsert
export type AICache = typeof aiCache.$inferSelect
export type NewAICache = typeof aiCache.$inferInsert
export type Setting = typeof settings.$inferSelect
export type NewSetting = typeof settings.$inferInsert
export type UserProfile = typeof userProfiles.$inferSelect
export type NewUserProfile = typeof userProfiles.$inferInsert
export type NotificationHistory = typeof notificationHistory.$inferSelect
export type NewNotificationHistory = typeof notificationHistory.$inferInsert
export type SyncStatus = typeof syncStatus.$inferSelect
export type NewSyncStatus = typeof syncStatus.$inferInsert
```

## データベース接続設定

### database/connection.ts

```typescript
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'
import path from 'path'
import fs from 'fs'

export class DatabaseConnection {
  private static instance: DatabaseConnection | null = null
  private db: ReturnType<typeof drizzle> | null = null
  private sqliteDb: Database.Database | null = null

  private constructor(
    private dbPath: string,
    private logger?: { info: (msg: string) => void; error: (msg: string, error?: any) => void }
  ) {}

  static getInstance(dbPath?: string, logger?: any): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      if (!dbPath) {
        throw new Error('Database path is required for first initialization')
      }
      DatabaseConnection.instance = new DatabaseConnection(dbPath, logger)
    }
    return DatabaseConnection.instance
  }

  async connect(): Promise<ReturnType<typeof drizzle>> {
    if (this.db) {
      return this.db
    }

    try {
      // ディレクトリの作成
      const dbDir = path.dirname(this.dbPath)
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true })
        this.logger?.info(`Created database directory: ${dbDir}`)
      }

      // SQLiteデータベース接続
      this.sqliteDb = new Database(this.dbPath)
      this.sqliteDb.pragma('journal_mode = WAL')
      this.sqliteDb.pragma('synchronous = NORMAL')
      this.sqliteDb.pragma('cache_size = 1000000')
      this.sqliteDb.pragma('foreign_keys = ON')
      this.sqliteDb.pragma('temp_store = MEMORY')

      // Drizzle ORM初期化
      this.db = drizzle(this.sqliteDb, { schema, logger: this.logger ? true : false })

      // マイグレーション実行
      await this.runMigrations()

      this.logger?.info(`Database connected: ${this.dbPath}`)
      return this.db

    } catch (error) {
      this.logger?.error('Database connection failed', error)
      throw error
    }
  }

  private async runMigrations(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized')
    }

    try {
      await migrate(this.db, { migrationsFolder: './src/database/migrations' })
      this.logger?.info('Database migrations completed')
    } catch (error) {
      this.logger?.error('Database migration failed', error)
      throw error
    }
  }

  async close(): Promise<void> {
    if (this.sqliteDb) {
      this.sqliteDb.close()
      this.sqliteDb = null
      this.db = null
      this.logger?.info('Database connection closed')
    }
  }

  getDb(): ReturnType<typeof drizzle> {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first.')
    }
    return this.db
  }

  // トランザクション実行
  async transaction<T>(
    callback: (tx: Parameters<Parameters<ReturnType<typeof drizzle>['transaction']>[0]>[0]) => Promise<T>
  ): Promise<T> {
    const db = this.getDb()
    return await db.transaction(callback)
  }

  // データベース最適化
  async optimize(): Promise<void> {
    if (!this.sqliteDb) {
      throw new Error('Database not connected')
    }

    try {
      this.sqliteDb.pragma('optimize')
      this.sqliteDb.exec('VACUUM')
      this.logger?.info('Database optimization completed')
    } catch (error) {
      this.logger?.error('Database optimization failed', error)
      throw error
    }
  }

  // データベース統計情報
  getStats(): Record<string, any> {
    if (!this.sqliteDb) {
      throw new Error('Database not connected')
    }

    return {
      pageSize: this.sqliteDb.pragma('page_size', { simple: true }),
      pageCount: this.sqliteDb.pragma('page_count', { simple: true }),
      cacheSize: this.sqliteDb.pragma('cache_size', { simple: true }),
      walMode: this.sqliteDb.pragma('journal_mode', { simple: true }),
      foreignKeys: this.sqliteDb.pragma('foreign_keys', { simple: true }),
    }
  }
}

// データベースインスタンス取得用ヘルパー
export const getDatabase = async (dbPath?: string, logger?: any) => {
  const connection = DatabaseConnection.getInstance(dbPath, logger)
  return await connection.connect()
}
```

## 初期マイグレーション

### database/migrations/0000_initial.sql

```sql
-- スペーステーブル
CREATE TABLE `spaces` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `domain` text NOT NULL,
  `api_key` text NOT NULL,
  `is_active` integer DEFAULT 1 NOT NULL,
  `last_sync_at` integer,
  `created` integer NOT NULL,
  `updated` integer NOT NULL,
  UNIQUE(`domain`)
);

-- チケットテーブル
CREATE TABLE `issues` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `space_id` integer NOT NULL,
  `project_id` integer NOT NULL,
  `backlog_issue_id` integer NOT NULL,
  `key` text NOT NULL,
  `summary` text NOT NULL,
  `description` text,
  `status_id` integer NOT NULL,
  `priority_id` integer NOT NULL,
  `assignee_id` integer,
  `due_date` integer,
  `score` real,
  `priority` text CHECK(`priority` IN ('critical', 'important', 'normal')),
  `created` integer NOT NULL,
  `updated` integer NOT NULL,
  FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action
);

-- コメントテーブル
CREATE TABLE `comments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `issue_id` integer NOT NULL,
  `backlog_comment_id` integer NOT NULL,
  `content` text NOT NULL,
  `author_id` integer NOT NULL,
  `author_name` text NOT NULL,
  `created` integer NOT NULL,
  `updated` integer NOT NULL,
  FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action
);

-- メンションテーブル
CREATE TABLE `mentions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `comment_id` integer NOT NULL,
  `mentioned_user_id` integer NOT NULL,
  `mentioned_user_name` text NOT NULL,
  `created` integer NOT NULL,
  FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE no action
);

-- AIキャッシュテーブル
CREATE TABLE `ai_cache` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `key` text NOT NULL,
  `type` text NOT NULL CHECK(`type` IN ('summary', 'advice')),
  `content` text NOT NULL,
  `metadata` text,
  `expires_at` integer NOT NULL,
  `created` integer NOT NULL,
  UNIQUE(`key`)
);

-- 設定テーブル
CREATE TABLE `settings` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `key` text NOT NULL,
  `value` text NOT NULL,
  `type` text NOT NULL CHECK(`type` IN ('string', 'number', 'boolean', 'json')),
  `updated` integer NOT NULL,
  UNIQUE(`key`)
);

-- ユーザープロファイルテーブル
CREATE TABLE `user_profiles` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `space_id` integer NOT NULL,
  `backlog_user_id` integer NOT NULL,
  `name` text NOT NULL,
  `mail_address` text,
  `icon_url` text,
  `is_current_user` integer DEFAULT 0 NOT NULL,
  `created` integer NOT NULL,
  `updated` integer NOT NULL,
  FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action
);

-- 通知履歴テーブル
CREATE TABLE `notification_history` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `type` text NOT NULL CHECK(`type` IN ('critical', 'important', 'info')),
  `title` text NOT NULL,
  `message` text NOT NULL,
  `issue_ids` text,
  `shown` integer DEFAULT 0 NOT NULL,
  `clicked` integer DEFAULT 0 NOT NULL,
  `created` integer NOT NULL
);

-- 同期状態テーブル
CREATE TABLE `sync_status` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `space_id` integer NOT NULL,
  `sync_type` text NOT NULL CHECK(`sync_type` IN ('full', 'incremental', 'comments')),
  `status` text NOT NULL CHECK(`status` IN ('pending', 'running', 'completed', 'failed')),
  `started_at` integer,
  `completed_at` integer,
  `error_message` text,
  `items_processed` integer DEFAULT 0 NOT NULL,
  `total_items` integer,
  `created` integer NOT NULL,
  FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action
);

-- インデックス作成
CREATE INDEX `idx_spaces_domain` ON `spaces` (`domain`);
CREATE INDEX `idx_spaces_active` ON `spaces` (`is_active`);
CREATE INDEX `idx_issues_space_updated` ON `issues` (`space_id`,`updated`);
CREATE INDEX `idx_issues_assignee_due` ON `issues` (`assignee_id`,`due_date`);
CREATE INDEX `idx_issues_priority_score` ON `issues` (`priority`,`score`);
CREATE INDEX `idx_issues_backlog_issue` ON `issues` (`space_id`,`backlog_issue_id`);
CREATE INDEX `idx_comments_issue` ON `comments` (`issue_id`);
CREATE INDEX `idx_comments_author` ON `comments` (`author_id`);
CREATE INDEX `idx_comments_created` ON `comments` (`created`);
CREATE INDEX `idx_mentions_user` ON `mentions` (`mentioned_user_id`);
CREATE INDEX `idx_mentions_comment` ON `mentions` (`comment_id`);
CREATE INDEX `idx_ai_cache_key` ON `ai_cache` (`key`);
CREATE INDEX `idx_ai_cache_expires` ON `ai_cache` (`expires_at`);
CREATE INDEX `idx_ai_cache_type` ON `ai_cache` (`type`);
CREATE INDEX `idx_settings_key` ON `settings` (`key`);
CREATE INDEX `idx_user_profiles_space_user` ON `user_profiles` (`space_id`,`backlog_user_id`);
CREATE INDEX `idx_user_profiles_current` ON `user_profiles` (`is_current_user`);
CREATE INDEX `idx_notification_history_type` ON `notification_history` (`type`);
CREATE INDEX `idx_notification_history_created` ON `notification_history` (`created`);
CREATE INDEX `idx_notification_history_shown` ON `notification_history` (`shown`);
CREATE INDEX `idx_sync_status_space_type` ON `sync_status` (`space_id`,`sync_type`);
CREATE INDEX `idx_sync_status_status` ON `sync_status` (`status`);

-- トリガー作成
CREATE TRIGGER update_issues_timestamp
AFTER UPDATE ON issues
BEGIN
  UPDATE issues SET updated = unixepoch('now') WHERE id = NEW.id;
END;

CREATE TRIGGER update_spaces_timestamp
AFTER UPDATE ON spaces
BEGIN
  UPDATE spaces SET updated = unixepoch('now') WHERE id = NEW.id;
END;

CREATE TRIGGER update_settings_timestamp
AFTER UPDATE ON settings
BEGIN
  UPDATE settings SET updated = unixepoch('now') WHERE id = NEW.id;
END;

-- 初期設定データ挿入
INSERT INTO settings (key, value, type, updated) VALUES
('language', 'ja', 'string', unixepoch('now')),
('theme', 'light', 'string', unixepoch('now')),
('notifications_enabled', 'true', 'boolean', unixepoch('now')),
('ai_enabled', 'true', 'boolean', unixepoch('now')),
('ai_provider', 'openai', 'string', unixepoch('now')),
('sync_interval', '300000', 'number', unixepoch('now')),
('auto_start', 'false', 'boolean', unixepoch('now')),
('minimize_to_tray', 'true', 'boolean', unixepoch('now'));
```

## データアクセスレイヤー

### database/repositories/issueRepository.ts

```typescript
import { eq, desc, and, gte, lte, inArray, isNotNull, or } from 'drizzle-orm'
import type { DatabaseConnection } from '../connection'
import { issues, comments, userProfiles, type Issue, type NewIssue } from '../schema'

export class IssueRepository {
  constructor(private db: ReturnType<DatabaseConnection['getDb']>) {}

  async findById(id: number): Promise<Issue | null> {
    const result = await this.db
      .select()
      .from(issues)
      .where(eq(issues.id, id))
      .limit(1)

    return result[0] || null
  }

  async findBySpaceAndBacklogId(spaceId: number, backlogIssueId: number): Promise<Issue | null> {
    const result = await this.db
      .select()
      .from(issues)
      .where(and(
        eq(issues.spaceId, spaceId),
        eq(issues.backlogIssueId, backlogIssueId)
      ))
      .limit(1)

    return result[0] || null
  }

  async findByPriority(priority: 'critical' | 'important' | 'normal', limit = 50): Promise<Issue[]> {
    return await this.db
      .select()
      .from(issues)
      .where(eq(issues.priority, priority))
      .orderBy(desc(issues.score), desc(issues.updated))
      .limit(limit)
  }

  async findOverdueIssues(): Promise<Issue[]> {
    const now = Date.now()
    return await this.db
      .select()
      .from(issues)
      .where(and(
        isNotNull(issues.dueDate),
        lte(issues.dueDate, new Date(now))
      ))
      .orderBy(desc(issues.priorityId), issues.dueDate)
  }

  async findByAssignee(assigneeId: number, limit = 100): Promise<Issue[]> {
    return await this.db
      .select()
      .from(issues)
      .where(eq(issues.assigneeId, assigneeId))
      .orderBy(desc(issues.score), desc(issues.updated))
      .limit(limit)
  }

  async findRecentlyUpdated(spaceId?: number, since?: Date, limit = 100): Promise<Issue[]> {
    const conditions = []
    
    if (spaceId) {
      conditions.push(eq(issues.spaceId, spaceId))
    }
    
    if (since) {
      conditions.push(gte(issues.updated, since))
    }

    return await this.db
      .select()
      .from(issues)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(issues.updated))
      .limit(limit)
  }

  async create(issue: NewIssue): Promise<Issue> {
    const result = await this.db
      .insert(issues)
      .values(issue)
      .returning()

    return result[0]
  }

  async update(id: number, updates: Partial<NewIssue>): Promise<Issue | null> {
    const result = await this.db
      .update(issues)
      .set({ ...updates, updated: new Date() })
      .where(eq(issues.id, id))
      .returning()

    return result[0] || null
  }

  async updateScore(id: number, score: number, priority: 'critical' | 'important' | 'normal'): Promise<void> {
    await this.db
      .update(issues)
      .set({ 
        score, 
        priority, 
        updated: new Date() 
      })
      .where(eq(issues.id, id))
  }

  async batchUpdateScores(scoreUpdates: Array<{ id: number; score: number; priority: string }>): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const update of scoreUpdates) {
        await tx
          .update(issues)
          .set({ 
            score: update.score, 
            priority: update.priority as any, 
            updated: new Date() 
          })
          .where(eq(issues.id, update.id))
      }
    })
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db
      .delete(issues)
      .where(eq(issues.id, id))
      .returning({ id: issues.id })

    return result.length > 0
  }

  async findWithDetails(id: number) {
    const result = await this.db
      .select({
        issue: issues,
        assignee: userProfiles,
        commentsCount: count(comments.id)
      })
      .from(issues)
      .leftJoin(userProfiles, eq(issues.assigneeId, userProfiles.backlogUserId))
      .leftJoin(comments, eq(issues.id, comments.issueId))
      .where(eq(issues.id, id))
      .groupBy(issues.id)

    return result[0] || null
  }

  async getStatsBySpace(spaceId: number) {
    const result = await this.db
      .select({
        priority: issues.priority,
        count: count(issues.id)
      })
      .from(issues)
      .where(eq(issues.spaceId, spaceId))
      .groupBy(issues.priority)

    return result.reduce((acc, row) => {
      if (row.priority) {
        acc[row.priority] = row.count
      }
      return acc
    }, {} as Record<string, number>)
  }
}
```