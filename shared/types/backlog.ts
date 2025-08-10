/**
 * Backlog API完全型定義
 */

import type { BaseEntity, FileInfo } from './common'

// スペース関連
export interface BacklogSpace extends BaseEntity {
  spaceKey: string
  name: string
  ownerId: number
  lang: string
  timezone: string
  reportSendTime: string
  textFormattingRule: 'markdown' | 'backlog'
  created: string
  updated: string
}

// ユーザー関連
export interface BacklogUser extends BaseEntity {
  userId: string
  name: string
  roleType: 1 | 2 | 3 | 4 | 5 // 管理者=1, 一般ユーザー=2, ゲスト=3, レポーター=4, 閲覧者=5
  lang: string
  mailAddress: string
  nulabAccount?: {
    nulabId: string
    name: string
    uniqueId: string
  }
  keyword?: string
  lastLoginTime?: string
}

// プロジェクト関連
export interface BacklogProject extends BaseEntity {
  projectKey: string
  name: string
  chartEnabled: boolean
  subtaskingEnabled: boolean
  projectLeaderCanEditProjectLeader: boolean
  useWiki: boolean
  useFileSharing: boolean
  useDevAttributes: boolean
  useResolvedForChart: boolean
  textFormattingRule: 'markdown' | 'backlog'
  archived: boolean
  displayOrder: number
}

// カテゴリ関連
export interface BacklogCategory extends BaseEntity {
  name: string
  displayOrder: number
}

// バージョン関連
export interface BacklogVersion extends BaseEntity {
  projectId: number
  name: string
  description: string
  startDate?: string
  releaseDueDate?: string
  archived: boolean
  displayOrder: number
}

// マイルストーン関連
export interface BacklogMilestone extends BaseEntity {
  projectId: number
  name: string
  description: string
  startDate?: string
  releaseDueDate?: string
  archived: boolean
  displayOrder: number
}

// イシュータイプ関連
export interface BacklogIssueType extends BaseEntity {
  projectId: number
  name: string
  color: string
  displayOrder: number
  templateSummary?: string
  templateDescription?: string
}

// 優先度関連
export interface BacklogPriority extends BaseEntity {
  name: string
}

// 状態関連
export interface BacklogStatus extends BaseEntity {
  projectId: number
  name: string
  color: string
  displayOrder: number
}

// イシュー関連
export interface BacklogIssue extends BaseEntity {
  issueKey: string
  keyId: number
  issueType: BacklogIssueType
  summary: string
  description: string
  resolution?: {
    id: number
    name: string
  }
  priority: BacklogPriority
  status: BacklogStatus
  assignee?: BacklogUser
  category: BacklogCategory[]
  versions: BacklogVersion[]
  milestone: BacklogMilestone[]
  startDate?: string
  dueDate?: string
  estimatedHours?: number
  actualHours?: number
  parentIssueId?: number
  createdUser: BacklogUser
  created: string
  updatedUser?: BacklogUser
  updated?: string
  customFields: BacklogCustomField[]
  attachments: BacklogAttachment[]
  sharedFiles: BacklogSharedFile[]
  stars: BacklogStar[]
}

// カスタムフィールド関連
export interface BacklogCustomField {
  id: number
  fieldTypeId: number
  name: string
  description?: string
  required: boolean
  applicableIssueTypes?: number[]
  allowAddItem?: boolean
  items?: BacklogCustomFieldItem[]
  value?: any
}

export interface BacklogCustomFieldItem {
  id: number
  name: string
  displayOrder: number
}

// 添付ファイル関連
export interface BacklogAttachment extends FileInfo {
  id: number
  createdUser: BacklogUser
  created: string
}

// 共有ファイル関連
export interface BacklogSharedFile extends FileInfo {
  id: number
  dir: string
  createdUser: BacklogUser
  created: string
  updatedUser?: BacklogUser
  updated?: string
}

// スター関連
export interface BacklogStar extends BaseEntity {
  presenter: BacklogUser
  created: string
}

// コメント関連
export interface BacklogComment extends BaseEntity {
  content: string
  changeLog?: BacklogChangeLog[]
  createdUser: BacklogUser
  created: string
  updatedUser?: BacklogUser
  updated?: string
  stars: BacklogStar[]
  notifications: BacklogNotification[]
}

// 変更ログ関連
export interface BacklogChangeLog {
  field: string
  newValue?: string
  oldValue?: string
  attachmentInfo?: BacklogAttachment
  attributeInfo?: {
    id: number
    typeId: number
  }
  notificationInfo?: BacklogNotification
}

// 通知関連
export interface BacklogNotification {
  id: number
  alreadyRead: boolean
  reason: number
  user: BacklogUser
  resourceAlreadyRead: boolean
}

// Wiki関連
export interface BacklogWiki extends BaseEntity {
  projectId: number
  name: string
  content: string
  tags: BacklogWikiTag[]
  attachments: BacklogAttachment[]
  sharedFiles: BacklogSharedFile[]
  stars: BacklogStar[]
  createdUser: BacklogUser
  created: string
  updatedUser?: BacklogUser
  updated?: string
}

export interface BacklogWikiTag extends BaseEntity {
  name: string
}

// アクティビティ関連
export interface BacklogActivity extends BaseEntity {
  project: BacklogProject
  type: number
  content: {
    id: number
    key_id?: number
    summary?: string
    description?: string
    comment?: {
      id: number
      content: string
    }
    changes?: BacklogChangeLog[]
  }
  notifications: BacklogNotification[]
  createdUser: BacklogUser
  created: string
}

// APIリクエストパラメータ関連
export interface BacklogIssueSearchParams {
  projectId?: number[]
  issueTypeId?: number[]
  categoryId?: number[]
  versionId?: number[]
  milestoneId?: number[]
  statusId?: number[]
  priorityId?: number[]
  assigneeId?: number[]
  createdUserId?: number[]
  resolutionId?: number[]
  parentChild?: number // 0: すべて, 1: 親課題のみ, 2: 子課題のみ, 3: 親課題・子課題以外, 4: 子課題なし
  attachment?: boolean
  sharedFile?: boolean
  sort?: 'issueType' | 'category' | 'version' | 'milestone' | 'summary' | 'status' | 'priority' | 'attachment' | 'sharedFile' | 'created' | 'createdUser' | 'updated' | 'updatedUser' | 'assignee' | 'startDate' | 'dueDate' | 'estimatedHours' | 'actualHours' | 'childIssue'
  order?: 'asc' | 'desc'
  offset?: number
  count?: number
  createdSince?: string
  createdUntil?: string
  updatedSince?: string
  updatedUntil?: string
  startDateSince?: string
  startDateUntil?: string
  dueDateSince?: string
  dueDateUntil?: string
  id?: number[]
  parentIssueId?: number[]
  keyword?: string
}

// Backlog APIクライアント設定
export interface BacklogApiConfig {
  spaceId: string
  apiKey: string
  host?: string // デフォルト: backlog.jp
}

// Backlog接続情報
export interface BacklogConnection {
  id: string
  name: string
  config: BacklogApiConfig
  isActive: boolean
  lastConnected?: string
  user?: BacklogUser
  space?: BacklogSpace
  projects?: BacklogProject[]
}
