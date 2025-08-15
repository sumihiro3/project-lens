/**
 * Backlog Direct API接続管理サービス - 統合インターフェース
 *
 * Phase 1-6の全コンポーネントを統合したメインエントリーポイント。
 * 複雑な内部実装を隠蔽し、シンプルで使いやすいAPIを提供します。
 *
 * Features:
 * - 単一のエントリーポイントによる統一API
 * - 依存性注入による柔軟な設定管理
 * - ライフサイクル管理とリソースクリーンアップ
 * - 自動ヘルスモニタリングと状態管理
 * - 統合されたエラーハンドリング
 * - パフォーマンス統計とメトリクス
 *
 * @example
 * ```typescript
 * const service = new BacklogService(database)
 * await service.initialize({
 *   maxSpaces: 5,
 *   enableCache: true,
 *   enableQueue: true
 * })
 *
 * // スペース追加
 * const spaceId = await service.addSpace({
 *   name: 'My Project',
 *   apiKey: 'your-api-key',
 *   host: 'mycompany.backlog.jp'
 * })
 *
 * // データ取得（キャッシュ統合）
 * const projects = await service.getProjects(spaceId)
 * const issues = await service.getIssues(spaceId, { projectId: [123] })
 *
 * // ヘルスチェック
 * const health = await service.getHealthStatus()
 * console.log(`Status: ${health.status}, Uptime: ${health.uptime}`)
 *
 * // クリーンアップ
 * await service.dispose()
 * ```
 */

import type { Database } from '../../database/connection'
import { BacklogApiClient } from './api-client'
import { BacklogRateLimiter } from './rate-limiter'
import { BacklogConnectionManager } from './connection-manager'
import { BacklogRequestQueue, RequestPriority } from './request-queue'
import { BacklogErrorHandler, ErrorSeverity } from './error-handler'
import { IntegratedBacklogCacheService } from './cache-manager'
import type {
  BacklogSpace,
  BacklogUser,
  BacklogProject,
  BacklogIssue,
  BacklogIssueSearchParams,
  BacklogApiConfig,
} from '../../../../shared/types/backlog'
import type { ApiResponse } from '../../../../shared/types/common'

// 統合インターフェース用の型定義

/**
 * Backlogサービス設定
 */
export interface BacklogServiceConfig {
  /** 最大管理スペース数 (デフォルト: 10) */
  maxSpaces?: number
  /** キャッシュ機能有効化 (デフォルト: true) */
  enableCache?: boolean
  /** リクエストキュー機能有効化 (デフォルト: true) */
  enableQueue?: boolean
  /** レート制限監視有効化 (デフォルト: true) */
  enableRateLimit?: boolean
  /** エラーハンドリング有効化 (デフォルト: true) */
  enableErrorHandler?: boolean
  /** 自動ヘルスチェック間隔（ミリ秒、デフォルト: 60000） */
  healthCheckInterval?: number
  /** デバッグモード (デフォルト: false) */
  debug?: boolean
}

/**
 * スペース設定
 */
export interface SpaceConfig {
  /** スペース名 */
  name: string
  /** APIキー */
  apiKey: string
  /** ホスト名 (例: company.backlog.jp) */
  host?: string
  /** 優先度 (デフォルト: 1) */
  priority?: number
  /** アクティブ状態 (デフォルト: true) */
  isActive?: boolean
}

/**
 * 検索パラメータ（簡略化）
 */
export interface SearchParams {
  /** プロジェクトID */
  projectId?: number[]
  /** イシュータイプID */
  issueTypeId?: number[]
  /** 担当者ID */
  assigneeId?: number[]
  /** ステータスID */
  statusId?: number[]
  /** 優先度ID */
  priorityId?: number[]
  /** キーワード */
  keyword?: string
  /** 作成日From */
  createdSince?: Date
  /** 更新日From */
  updatedSince?: Date
  /** 並び順 */
  sort?: 'issueType' | 'category' | 'version' | 'milestone' | 'summary' | 'status' | 'priority' | 'attachment' | 'sharedFile' | 'created' | 'createdUser' | 'updated' | 'updatedUser' | 'assignee' | 'startDate' | 'dueDate' | 'estimatedHours' | 'actualHours' | 'childIssue'
  /** 並び順（昇順/降順） */
  order?: 'asc' | 'desc'
  /** 取得数上限 */
  count?: number
  /** オフセット */
  offset?: number
}

/**
 * ヘルス状態
 */
export interface HealthStatus {
  /** 全体ステータス */
  status: 'healthy' | 'degraded' | 'unhealthy'
  /** 稼働時間（ミリ秒） */
  uptime: number
  /** 管理中スペース数 */
  activeSpaces: number
  /** 接続状態（スペース別） */
  spaceHealth: Record<string, {
    status: 'online' | 'offline' | 'error'
    lastConnected?: Date
    errorCount: number
    responseTime?: number
  }>
  /** システムメトリクス */
  metrics: {
    totalRequests: number
    successRate: number
    averageResponseTime: number
    cacheHitRate: number
    queueSize: number
    errorRate: number
  }
  /** 最終チェック時刻 */
  lastCheck: Date
}

/**
 * パフォーマンス統計
 */
export interface PerformanceStats {
  /** API統計 */
  api: {
    totalRequests: number
    successfulRequests: number
    failedRequests: number
    averageResponseTime: number
    medianResponseTime: number
    p95ResponseTime: number
    requestsPerSecond: number
  }
  /** キャッシュ統計 */
  cache: {
    l1HitRate: number
    l2HitRate: number
    totalHits: number
    totalMisses: number
    evictionCount: number
    memoryUsage: number
  }
  /** キュー統計 */
  queue: {
    totalProcessed: number
    currentSize: number
    averageWaitTime: number
    throughput: number
    priorityDistribution: Record<RequestPriority, number>
  }
  /** エラー統計 */
  errors: {
    totalErrors: number
    errorsByType: Record<string, number>
    errorsBySpaceId: Record<string, number>
    lastError?: {
      type: string
      message: string
      timestamp: Date
    }
  }
}

/**
 * Backlog統合サービス
 *
 * Phase 1-6の全コンポーネントを統合し、シンプルなAPIを提供する
 * メインサービスクラス。
 */
export class BacklogService {
  private readonly database: Database
  private readonly config: Required<BacklogServiceConfig>

  // Phase 1-6 コンポーネント
  private apiClient: BacklogApiClient | null = null
  private rateLimiter: BacklogRateLimiter | null = null
  private connectionManager: BacklogConnectionManager | null = null
  private requestQueue: BacklogRequestQueue | null = null
  private errorHandler: BacklogErrorHandler | null = null
  private cacheService: IntegratedBacklogCacheService | null = null

  // 状態管理
  private isInitialized = false
  private isDisposed = false
  private startTime = Date.now()
  private healthCheckTimer: NodeJS.Timeout | null = null
  private lastHealthCheck: Date = new Date()

  constructor(database: Database) {
    this.database = database
    this.config = {
      maxSpaces: 10,
      enableCache: true,
      enableQueue: true,
      enableRateLimit: true,
      enableErrorHandler: true,
      healthCheckInterval: 60000,
      debug: false,
    }
  }

  /**
   * サービスを初期化します
   *
   * @param config 設定オプション
   */
  async initialize(config: BacklogServiceConfig = {}): Promise<void> {
    if (this.isInitialized) {
      throw new Error('BacklogService is already initialized')
    }
    if (this.isDisposed) {
      throw new Error('BacklogService has been disposed')
    }

    // 設定をマージ
    Object.assign(this.config, config)

    try {
      // Phase 1: API Client
      this.apiClient = new BacklogApiClient()

      // Phase 2: Rate Limiter
      if (this.config.enableRateLimit) {
        this.rateLimiter = new BacklogRateLimiter(this.database)
        await this.rateLimiter.initialize()
      }

      // Phase 3: Connection Manager
      this.connectionManager = new BacklogConnectionManager(
        this.database,
        this.rateLimiter || undefined,
      )
      await this.connectionManager.initialize({
        maxConcurrentConnections: this.config.maxSpaces * 2,
        maxSpaces: this.config.maxSpaces,
        enableHealthCheck: true,
        healthCheckInterval: this.config.healthCheckInterval,
      })

      // Phase 4: Request Queue
      if (this.config.enableQueue) {
        this.requestQueue = new BacklogRequestQueue(
          this.database,
          this.apiClient,
          this.rateLimiter || undefined,
          this.connectionManager,
        )
        await this.requestQueue.initialize({
          maxConcurrentRequests: 10,
          enableBatchProcessing: true,
          batchSize: 5,
          processInterval: 1000,
        })
      }

      // Phase 5: Error Handler
      if (this.config.enableErrorHandler) {
        this.errorHandler = new BacklogErrorHandler()
      }

      // Phase 6: Cache Service
      if (this.config.enableCache) {
        this.cacheService = new IntegratedBacklogCacheService(
          this.database,
          this.apiClient,
          this.rateLimiter || undefined,
          this.connectionManager,
          this.requestQueue || undefined,
        )
        await this.cacheService.initialize({
          l1MaxSize: 100,
          l1DefaultTtl: 300000, // 5分
          l2DefaultTtl: 3600000, // 1時間
          enablePrefetch: true,
          enableBackgroundUpdate: true,
          gcInterval: 300000, // 5分
        })
      }

      // 定期ヘルスチェック開始
      this.startHealthCheck()

      this.isInitialized = true

      if (this.config.debug) {
        console.log('[BacklogService] Initialized successfully', {
          config: this.config,
          timestamp: new Date().toISOString(),
        })
      }
    }
    catch (error) {
      // 初期化失敗時のクリーンアップ
      await this.cleanup()
      throw new Error(`Failed to initialize BacklogService: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 新しいスペースを追加します
   *
   * @param config スペース設定
   * @returns スペースID
   */
  async addSpace(config: SpaceConfig): Promise<string> {
    this.ensureInitialized()

    try {
      if (!this.connectionManager) {
        throw new Error('Connection manager not available')
      }

      const spaceId = await this.connectionManager.addSpace({
        spaceId: `space_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: config.name,
        apiKey: config.apiKey,
        host: config.host,
        isActive: config.isActive ?? true,
        priority: config.priority ?? 1,
        createdAt: new Date(),
        connectionCount: 0,
        errorCount: 0,
      })

      if (this.config.debug) {
        console.log('[BacklogService] Space added successfully', {
          spaceId,
          name: config.name,
          timestamp: new Date().toISOString(),
        })
      }

      return spaceId
    }
    catch (error) {
      if (this.errorHandler) {
        await this.errorHandler.handleError(error as Error, {
          operation: 'addSpace',
          spaceConfig: { name: config.name, host: config.host },
        })
      }
      throw error
    }
  }

  /**
   * スペースを削除します
   *
   * @param spaceId スペースID
   */
  async removeSpace(spaceId: string): Promise<void> {
    this.ensureInitialized()

    try {
      if (!this.connectionManager) {
        throw new Error('Connection manager not available')
      }

      await this.connectionManager.removeSpace(spaceId)

      // キャッシュクリア
      if (this.cacheService) {
        await this.cacheService.clearCacheByPattern(`*:${spaceId}:*`)
      }

      if (this.config.debug) {
        console.log('[BacklogService] Space removed successfully', {
          spaceId,
          timestamp: new Date().toISOString(),
        })
      }
    }
    catch (error) {
      if (this.errorHandler) {
        await this.errorHandler.handleError(error as Error, {
          operation: 'removeSpace',
          spaceId,
        })
      }
      throw error
    }
  }

  /**
   * プロジェクト一覧を取得します（キャッシュ統合）
   *
   * @param spaceId スペースID
   * @returns プロジェクト一覧
   */
  async getProjects(spaceId: string): Promise<BacklogProject[]> {
    this.ensureInitialized()

    try {
      // キャッシュが有効な場合はキャッシュサービスを使用
      if (this.cacheService) {
        return await this.cacheService.getProjects(spaceId)
      }

      // キャッシュが無効な場合は直接APIを使用
      if (!this.connectionManager || !this.apiClient) {
        throw new Error('Required services not available')
      }

      const connection = await this.connectionManager.getConnection(spaceId)
      const response = await this.apiClient.request<BacklogProject[]>(
        connection.config,
        'projects',
        { method: 'GET' },
      )

      if (!response.success) {
        throw new Error(`Failed to fetch projects: ${response.error?.message}`)
      }

      return response.data || []
    }
    catch (error) {
      if (this.errorHandler) {
        await this.errorHandler.handleError(error as Error, {
          operation: 'getProjects',
          spaceId,
        })
      }
      throw error
    }
  }

  /**
   * イシュー一覧を取得します（キャッシュ統合）
   *
   * @param spaceId スペースID
   * @param params 検索パラメータ
   * @returns イシュー一覧
   */
  async getIssues(spaceId: string, params: SearchParams = {}): Promise<BacklogIssue[]> {
    this.ensureInitialized()

    try {
      // 検索パラメータを Backlog API 形式に変換
      const backlogParams: BacklogIssueSearchParams = {
        projectId: params.projectId,
        issueTypeId: params.issueTypeId,
        assigneeId: params.assigneeId,
        statusId: params.statusId,
        priorityId: params.priorityId,
        keyword: params.keyword,
        createdSince: params.createdSince?.toISOString(),
        updatedSince: params.updatedSince?.toISOString(),
        sort: params.sort,
        order: params.order,
        count: params.count,
        offset: params.offset,
      }

      // キャッシュが有効な場合はキャッシュサービスを使用
      if (this.cacheService) {
        return await this.cacheService.getIssues(spaceId, backlogParams)
      }

      // キャッシュが無効な場合は直接APIを使用
      if (!this.connectionManager || !this.apiClient) {
        throw new Error('Required services not available')
      }

      const connection = await this.connectionManager.getConnection(spaceId)
      const response = await this.apiClient.request<BacklogIssue[]>(
        connection.config,
        'issues',
        { method: 'GET', params: backlogParams as any },
      )

      if (!response.success) {
        throw new Error(`Failed to fetch issues: ${response.error?.message}`)
      }

      return response.data || []
    }
    catch (error) {
      if (this.errorHandler) {
        await this.errorHandler.handleError(error as Error, {
          operation: 'getIssues',
          spaceId,
          params,
        })
      }
      throw error
    }
  }

  /**
   * ユーザー一覧を取得します
   *
   * @param spaceId スペースID
   * @returns ユーザー一覧
   */
  async getUsers(spaceId: string): Promise<BacklogUser[]> {
    this.ensureInitialized()

    try {
      if (this.cacheService) {
        return await this.cacheService.getUsers(spaceId)
      }

      if (!this.connectionManager || !this.apiClient) {
        throw new Error('Required services not available')
      }

      const connection = await this.connectionManager.getConnection(spaceId)
      const response = await this.apiClient.request<BacklogUser[]>(
        connection.config,
        'users',
        { method: 'GET' },
      )

      if (!response.success) {
        throw new Error(`Failed to fetch users: ${response.error?.message}`)
      }

      return response.data || []
    }
    catch (error) {
      if (this.errorHandler) {
        await this.errorHandler.handleError(error as Error, {
          operation: 'getUsers',
          spaceId,
        })
      }
      throw error
    }
  }

  /**
   * スペース情報を取得します
   *
   * @param spaceId スペースID
   * @returns スペース情報
   */
  async getSpace(spaceId: string): Promise<BacklogSpace> {
    this.ensureInitialized()

    try {
      if (!this.connectionManager || !this.apiClient) {
        throw new Error('Required services not available')
      }

      const connection = await this.connectionManager.getConnection(spaceId)
      const response = await this.apiClient.request<BacklogSpace>(
        connection.config,
        'space',
        { method: 'GET' },
      )

      if (!response.success) {
        throw new Error(`Failed to fetch space: ${response.error?.message}`)
      }

      if (!response.data) {
        throw new Error('Space data not found')
      }

      return response.data
    }
    catch (error) {
      if (this.errorHandler) {
        await this.errorHandler.handleError(error as Error, {
          operation: 'getSpace',
          spaceId,
        })
      }
      throw error
    }
  }

  /**
   * ヘルス状態を取得します
   *
   * @returns ヘルス状態
   */
  async getHealthStatus(): Promise<HealthStatus> {
    this.ensureInitialized()

    const now = new Date()
    const uptime = now.getTime() - this.startTime

    try {
      // スペース別ヘルス状態を取得
      const spaceHealth: Record<string, any> = {}
      let activeSpaces = 0

      if (this.connectionManager) {
        const stats = await this.connectionManager.getStats()
        activeSpaces = stats.activeConnections

        for (const spaceId of Object.keys(stats.spaceStats || {})) {
          const spaceStats = stats.spaceStats[spaceId]
          spaceHealth[spaceId] = {
            status: spaceStats.errorCount > 5
              ? 'error'
              : spaceStats.lastConnected ? 'online' : 'offline',
            lastConnected: spaceStats.lastConnected,
            errorCount: spaceStats.errorCount,
            responseTime: spaceStats.averageResponseTime,
          }
        }
      }

      // システムメトリクスを取得
      const metrics = {
        totalRequests: 0,
        successRate: 1.0,
        averageResponseTime: 0,
        cacheHitRate: 0,
        queueSize: 0,
        errorRate: 0,
      }

      if (this.cacheService) {
        const cacheStats = await this.cacheService.getStats()
        metrics.cacheHitRate = cacheStats.l1HitRate
      }

      if (this.requestQueue) {
        const queueStats = await this.requestQueue.getStats()
        metrics.queueSize = queueStats.currentQueueSize
        metrics.totalRequests = queueStats.totalProcessed
      }

      // 全体ステータス判定
      const errorSpaces = Object.values(spaceHealth).filter(s => s.status === 'error').length
      const totalSpaces = Object.keys(spaceHealth).length
      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy'

      if (totalSpaces > 0) {
        const errorRate = errorSpaces / totalSpaces
        if (errorRate > 0.5) {
          status = 'unhealthy'
        }
        else if (errorRate > 0.2) {
          status = 'degraded'
        }
      }

      this.lastHealthCheck = now

      return {
        status,
        uptime,
        activeSpaces,
        spaceHealth,
        metrics,
        lastCheck: now,
      }
    }
    catch (error) {
      if (this.errorHandler) {
        await this.errorHandler.handleError(error as Error, {
          operation: 'getHealthStatus',
        })
      }

      return {
        status: 'unhealthy',
        uptime,
        activeSpaces: 0,
        spaceHealth: {},
        metrics: {
          totalRequests: 0,
          successRate: 0,
          averageResponseTime: 0,
          cacheHitRate: 0,
          queueSize: 0,
          errorRate: 1.0,
        },
        lastCheck: now,
      }
    }
  }

  /**
   * パフォーマンス統計を取得します
   *
   * @returns パフォーマンス統計
   */
  getPerformanceStats(): PerformanceStats {
    this.ensureInitialized()

    const stats: PerformanceStats = {
      api: {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageResponseTime: 0,
        medianResponseTime: 0,
        p95ResponseTime: 0,
        requestsPerSecond: 0,
      },
      cache: {
        l1HitRate: 0,
        l2HitRate: 0,
        totalHits: 0,
        totalMisses: 0,
        evictionCount: 0,
        memoryUsage: 0,
      },
      queue: {
        totalProcessed: 0,
        currentSize: 0,
        averageWaitTime: 0,
        throughput: 0,
        priorityDistribution: {
          [RequestPriority.HIGH]: 0,
          [RequestPriority.MEDIUM]: 0,
          [RequestPriority.LOW]: 0,
        },
      },
      errors: {
        totalErrors: 0,
        errorsByType: {},
        errorsBySpaceId: {},
      },
    }

    // 各コンポーネントから統計を収集
    // 実装は各コンポーネントのgetStats()メソッドを呼び出し
    // ここでは基本構造のみ定義

    return stats
  }

  /**
   * リソースをクリーンアップし、サービスを破棄します
   */
  async dispose(): Promise<void> {
    if (this.isDisposed) {
      return
    }

    try {
      // ヘルスチェック停止
      this.stopHealthCheck()

      // 各コンポーネントのクリーンアップ
      await this.cleanup()

      this.isDisposed = true
      this.isInitialized = false

      if (this.config.debug) {
        console.log('[BacklogService] Disposed successfully', {
          timestamp: new Date().toISOString(),
        })
      }
    }
    catch (error) {
      console.error('[BacklogService] Error during disposal:', error)
      throw error
    }
  }

  /**
   * 初期化状態をチェックします
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('BacklogService is not initialized. Call initialize() first.')
    }
    if (this.isDisposed) {
      throw new Error('BacklogService has been disposed')
    }
  }

  /**
   * 定期ヘルスチェックを開始します
   */
  private startHealthCheck(): void {
    if (this.healthCheckTimer) {
      return
    }

    this.healthCheckTimer = setInterval(async () => {
      try {
        await this.getHealthStatus()
      }
      catch (error) {
        if (this.config.debug) {
          console.error('[BacklogService] Health check failed:', error)
        }
      }
    }, this.config.healthCheckInterval)
  }

  /**
   * 定期ヘルスチェックを停止します
   */
  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }

  /**
   * 内部コンポーネントをクリーンアップします
   */
  private async cleanup(): Promise<void> {
    const cleanupPromises: Promise<void>[] = []

    if (this.cacheService) {
      cleanupPromises.push(this.cacheService.dispose())
      this.cacheService = null
    }

    if (this.requestQueue) {
      cleanupPromises.push(this.requestQueue.dispose())
      this.requestQueue = null
    }

    if (this.connectionManager) {
      cleanupPromises.push(this.connectionManager.dispose())
      this.connectionManager = null
    }

    if (this.rateLimiter) {
      cleanupPromises.push(this.rateLimiter.dispose())
      this.rateLimiter = null
    }

    this.errorHandler = null
    this.apiClient = null

    await Promise.all(cleanupPromises)
  }
}

// 個別コンポーネントのエクスポート（必要に応じて使用）
export {
  BacklogApiClient,
  BacklogRateLimiter,
  BacklogConnectionManager,
  BacklogRequestQueue,
  BacklogErrorHandler,
  IntegratedBacklogCacheService,
}

// 型定義のエクスポート
export type {
  BacklogServiceConfig,
  SpaceConfig,
  SearchParams,
}

// Phase別のエクスポート
export { RequestPriority } from './request-queue'
export { ErrorSeverity } from './error-handler'
export type { SpaceConnectionConfig } from './connection-manager'
export type { CacheStats } from './cache-manager'
export type { RateLimitStatus } from './rate-limiter'
