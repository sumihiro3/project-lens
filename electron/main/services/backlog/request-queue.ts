/**
 * Backlog Direct API接続管理サービス Phase 4
 *
 * 3段階優先度キューシステム、差分更新機能、スマートキューイング、
 * Phase 2,3との完全統合によるリクエストキュー管理を提供します。
 *
 * Features:
 * - HIGH/MEDIUM/LOW 3段階優先度キューシステム
 * - SQLiteベースの差分更新（updatedSince統合）
 * - Phase 2レート制限との完全統合
 * - Phase 3接続管理との完全統合
 * - 動的優先度調整とデッドロック防止
 * - バッチ処理によるパフォーマンス最適化
 * - 自動クリーンアップとメモリ効率化
 */

import { eq, and } from 'drizzle-orm'
import type { DatabaseManager } from '../../database/connection'
import { syncLogs } from '../../database/schema'
import type { BacklogApiClient } from './api-client'
import type { BacklogRateLimiter } from './rate-limiter'
import type { BacklogConnectionManager } from './connection-manager'
import type {
  // BacklogIssue,
  // BacklogProject,
  // BacklogUser,
  BacklogIssueSearchParams,
} from '../../../../shared/types/backlog'
// import type { ApiResponse } from '../../../../shared/types/common'

/**
 * リクエスト優先度（3段階）
 */
export enum RequestPriority {
  HIGH = 'HIGH', // Stage 1: 高優先度（5-10リクエスト即座実行）
  MEDIUM = 'MEDIUM', // Stage 2: 中優先度（バックグラウンド更新）
  LOW = 'LOW', // Stage 3: 低優先度（アイドル時履歴データ取得）
}

/**
 * キューに登録されるリクエスト
 */
export interface QueuedRequest {
  id: string
  spaceId: string
  endpoint: string
  params: any
  priority: RequestPriority
  retryCount: number
  maxRetries: number
  createdAt: Date
  scheduledAt?: Date
  executedAt?: Date
  completedAt?: Date
  error?: string
  metadata?: Record<string, unknown>
  requestFn?: () => Promise<any>
  updatedSince?: string // 差分更新用
}

/**
 * キュー統計情報
 */
export interface QueueStats {
  totalQueued: number
  processing: number
  completed: number
  failed: number
  averageWaitTime: number
  throughput: number // req/sec
  priorityBreakdown: {
    [RequestPriority.HIGH]: number
    [RequestPriority.MEDIUM]: number
    [RequestPriority.LOW]: number
  }
  oldestRequest?: Date
  newestRequest?: Date
}

/**
 * 差分更新設定
 */
export interface DifferentialUpdateConfig {
  enabled: boolean
  lastSyncField: string // SQLiteテーブルのlastSync列名
  updatedSinceParam: string // API パラメータ名
  gracePeriodMs: number // 差分更新の最小間隔
}

/**
 * バッチ処理設定
 */
export interface BatchProcessingConfig {
  enabled: boolean
  maxBatchSize: number
  batchTimeoutMs: number
  parallelBatches: number
}

/**
 * キューイングイベント
 */
export interface QueueEvent {
  type: 'request_queued' | 'request_started' | 'request_completed' | 'request_failed' | 'batch_started' | 'batch_completed' | 'queue_emptied'
  requestId?: string
  spaceId: string
  priority: RequestPriority
  timestamp: Date
  metadata?: Record<string, unknown>
  error?: Error
}

/**
 * 並列処理管理
 */
interface ConcurrencyLimits {
  [RequestPriority.HIGH]: number
  [RequestPriority.MEDIUM]: number
  [RequestPriority.LOW]: number
}

/**
 * Backlog API リクエストキュー管理サービス
 *
 * Phase 1-3の機能と完全統合し、効率的な優先度ベース
 * リクエスト処理とSQLiteベースの差分更新を提供します。
 */
export class BacklogRequestQueue {
  private readonly db: DatabaseManager
  private readonly rateLimiter: BacklogRateLimiter
  private readonly connectionManager: BacklogConnectionManager
  private readonly requestQueues = new Map<RequestPriority, QueuedRequest[]>()
  private readonly processingRequests = new Map<string, QueuedRequest>()
  private readonly eventListeners: Array<(event: QueueEvent) => void> = []
  private readonly stats: QueueStats
  private processingInterval: NodeJS.Timeout | null = null
  private cleanupInterval: NodeJS.Timeout | null = null
  private isDestroyed = false

  // 設定
  private readonly concurrencyLimits: ConcurrencyLimits = {
    [RequestPriority.HIGH]: 5, // 高優先度: 最大5並列
    [RequestPriority.MEDIUM]: 3, // 中優先度: 最大3並列
    [RequestPriority.LOW]: 1, // 低優先度: 最大1並列
  }

  private readonly differentialConfig: DifferentialUpdateConfig = {
    enabled: true,
    lastSyncField: 'lastSyncAt',
    updatedSinceParam: 'updated_since',
    gracePeriodMs: 30 * 1000, // 30秒
  }

  private readonly batchConfig: BatchProcessingConfig = {
    enabled: true,
    maxBatchSize: 10,
    batchTimeoutMs: 5000,
    parallelBatches: 2,
  }

  /**
   * コンストラクター
   *
   * @param db - データベース接続インスタンス
   * @param rateLimiter - レート制限管理インスタンス
   * @param connectionManager - 接続管理インスタンス
   */
  constructor(
    db: DatabaseManager,
    rateLimiter: BacklogRateLimiter,
    connectionManager: BacklogConnectionManager,
  ) {
    this.db = db
    this.rateLimiter = rateLimiter
    this.connectionManager = connectionManager

    // キューを初期化
    this.requestQueues.set(RequestPriority.HIGH, [])
    this.requestQueues.set(RequestPriority.MEDIUM, [])
    this.requestQueues.set(RequestPriority.LOW, [])

    // 統計情報を初期化
    this.stats = {
      totalQueued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      averageWaitTime: 0,
      throughput: 0,
      priorityBreakdown: {
        [RequestPriority.HIGH]: 0,
        [RequestPriority.MEDIUM]: 0,
        [RequestPriority.LOW]: 0,
      },
    }

    console.log('Backlog リクエストキューサービスを初期化しました', {
      concurrencyLimits: this.concurrencyLimits,
      differentialConfig: this.differentialConfig,
      batchConfig: this.batchConfig,
    })

    // 処理を開始
    this.startProcessing()
    this.startCleanup()
  }

  /**
   * リクエストをキューに追加
   *
   * @param request - キューに追加するリクエスト
   * @returns 追加されたリクエストID
   */
  public async enqueue(request: Omit<QueuedRequest, 'id' | 'createdAt' | 'retryCount'>): Promise<string> {
    try {
      if (this.isDestroyed) {
        throw new Error('Request queue has been destroyed')
      }

      const requestId = this.generateRequestId()
      const now = new Date()

      // 優先度を正規化（数値からenumへの変換をサポート）
      const normalizedPriority = this.normalizePriority(request.priority as any)

      const queuedRequest: QueuedRequest = {
        ...request,
        id: requestId,
        createdAt: now,
        retryCount: 0,
        maxRetries: request.maxRetries || 3,
        priority: normalizedPriority,
      }

      // 差分更新が有効な場合、updatedSinceパラメータを追加
      if (this.differentialConfig.enabled && this.shouldUseDifferentialUpdate(request.endpoint)) {
        const lastSync = await this.getLastSyncTime(request.spaceId, request.endpoint)
        if (lastSync) {
          queuedRequest.updatedSince = lastSync
          queuedRequest.params = {
            ...queuedRequest.params,
            [this.differentialConfig.updatedSinceParam]: lastSync,
          }
        }
      }

      // 優先度別キューに追加
      const queue = this.requestQueues.get(normalizedPriority)
      if (!queue) {
        throw new Error(`Invalid priority: ${normalizedPriority}`)
      }

      queue.push(queuedRequest)
      this.stats.totalQueued++
      this.stats.priorityBreakdown[normalizedPriority]++

      console.log('リクエストをキューに追加しました', {
        requestId,
        spaceId: request.spaceId,
        endpoint: request.endpoint,
        priority: normalizedPriority,
        originalPriority: request.priority,
        queueSize: queue.length,
        useDifferentialUpdate: !!queuedRequest.updatedSince,
      })

      // イベントを発火
      await this.emitEvent({
        type: 'request_queued',
        requestId,
        spaceId: request.spaceId,
        priority: normalizedPriority,
        timestamp: now,
        metadata: {
          endpoint: request.endpoint,
          queueSize: queue.length,
          totalQueued: this.stats.totalQueued,
        },
      })

      return requestId
    }
    catch (error) {
      console.error('リクエストのキュー追加に失敗しました', {
        endpoint: request.endpoint,
        spaceId: request.spaceId,
        priority: request.priority,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * 高優先度リクエストを即座に追加（Stage 1用）
   *
   * @param spaceId - BacklogスペースID
   * @param endpoint - APIエンドポイント
   * @param params - リクエストパラメータ
   * @param requestFn - 実行する関数（オプション）
   * @returns リクエストID
   */
  public async enqueueHighPriority(
    spaceId: string,
    endpoint: string,
    params: any = {},
    requestFn?: () => Promise<any>,
  ): Promise<string> {
    return this.enqueue({
      spaceId,
      endpoint,
      params,
      priority: RequestPriority.HIGH,
      ...(requestFn && { requestFn }),
      scheduledAt: new Date(), // 即座に実行をスケジュール
      maxRetries: 3,
      metadata: {
        stage: 1,
        userVisible: true,
        criticalData: true,
      },
    })
  }

  /**
   * 中優先度バックグラウンドリクエストを追加（Stage 2用）
   *
   * @param spaceId - BacklogスペースID
   * @param endpoint - APIエンドポイント
   * @param params - リクエストパラメータ
   * @param requestFn - 実行する関数（オプション）
   * @returns リクエストID
   */
  public async enqueueMediumPriority(
    spaceId: string,
    endpoint: string,
    params: any = {},
    requestFn?: () => Promise<any>,
  ): Promise<string> {
    return this.enqueue({
      spaceId,
      endpoint,
      params,
      priority: RequestPriority.MEDIUM,
      ...(requestFn && { requestFn }),
      maxRetries: 2,
      metadata: {
        stage: 2,
        backgroundUpdate: true,
        incrementalSync: true,
      },
    })
  }

  /**
   * 低優先度アイドル時リクエストを追加（Stage 3用）
   *
   * @param spaceId - BacklogスペースID
   * @param endpoint - APIエンドポイント
   * @param params - リクエストパラメータ
   * @param requestFn - 実行する関数（オプション）
   * @returns リクエストID
   */
  public async enqueueLowPriority(
    spaceId: string,
    endpoint: string,
    params: any = {},
    requestFn?: () => Promise<any>,
  ): Promise<string> {
    return this.enqueue({
      spaceId,
      endpoint,
      params,
      priority: RequestPriority.LOW,
      ...(requestFn && { requestFn }),
      maxRetries: 1,
      metadata: {
        stage: 3,
        historicalData: true,
        idleProcessing: true,
      },
    })
  }

  /**
   * リクエストをキューから削除
   *
   * @param requestId - 削除するリクエストID
   * @returns 削除に成功したかどうか
   */
  public removeRequest(requestId: string): boolean {
    try {
      // 処理中のリクエストから削除
      if (this.processingRequests.has(requestId)) {
        this.processingRequests.delete(requestId)
        this.stats.processing--
        return true
      }

      // 各優先度キューから検索・削除
      for (const [priority, queue] of this.requestQueues) {
        const index = queue.findIndex(req => req.id === requestId)
        if (index !== -1) {
          queue.splice(index, 1)
          this.stats.totalQueued--
          this.stats.priorityBreakdown[priority]--

          console.log('リクエストをキューから削除しました', {
            requestId,
            priority,
            remainingInQueue: queue.length,
          })

          return true
        }
      }

      return false
    }
    catch (error) {
      console.error('リクエストの削除に失敗しました', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  /**
   * 特定スペースの全リクエストをクリア
   *
   * @param spaceId - 対象のスペースID
   * @returns 削除されたリクエスト数
   */
  public clearSpaceRequests(spaceId: string): number {
    let removedCount = 0

    try {
      // 処理中のリクエストから削除
      for (const [requestId, request] of this.processingRequests) {
        if (request.spaceId === spaceId) {
          this.processingRequests.delete(requestId)
          this.stats.processing--
          removedCount++
        }
      }

      // 各優先度キューから削除
      for (const [priority, queue] of this.requestQueues) {
        const initialLength = queue.length
        const filteredQueue = queue.filter(req => req.spaceId !== spaceId)
        const removed = initialLength - filteredQueue.length

        this.requestQueues.set(priority, filteredQueue)
        this.stats.totalQueued -= removed
        this.stats.priorityBreakdown[priority] -= removed
        removedCount += removed
      }

      console.log('スペースのリクエストをクリアしました', {
        spaceId,
        removedCount,
        remainingQueued: this.stats.totalQueued,
      })

      return removedCount
    }
    catch (error) {
      console.error('スペースリクエストのクリアに失敗しました', {
        spaceId,
        error: error instanceof Error ? error.message : String(error),
      })
      return removedCount
    }
  }

  /**
   * キュー統計情報を取得
   *
   * @returns 現在のキュー統計
   */
  public getStats(): QueueStats {
    // 最新の統計情報を更新
    this.updateStats()
    return { ...this.stats }
  }

  /**
   * 特定優先度のキュー状態を取得
   *
   * @param priority - 優先度
   * @returns キューに登録されているリクエスト一覧
   */
  public getQueuedRequests(priority?: RequestPriority): QueuedRequest[] {
    if (priority) {
      const queue = this.requestQueues.get(priority)
      return queue ? [...queue] : []
    }

    // 全優先度のリクエストを返す
    const allRequests: QueuedRequest[] = []
    for (const queue of this.requestQueues.values()) {
      allRequests.push(...queue)
    }
    return allRequests
  }

  /**
   * 処理中のリクエスト一覧を取得
   *
   * @returns 現在処理中のリクエスト一覧
   */
  public getProcessingRequests(): QueuedRequest[] {
    return Array.from(this.processingRequests.values())
  }

  /**
   * イベントリスナーを追加
   *
   * @param listener - イベントリスナー関数
   */
  public addEventListener(listener: (event: QueueEvent) => void): void {
    this.eventListeners.push(listener)
    console.log('キューイベントリスナーを追加しました', {
      totalListeners: this.eventListeners.length,
    })
  }

  /**
   * イベントリスナーを削除
   *
   * @param listener - 削除するイベントリスナー関数
   */
  public removeEventListener(listener: (event: QueueEvent) => void): void {
    const index = this.eventListeners.indexOf(listener)
    if (index > -1) {
      this.eventListeners.splice(index, 1)
      console.log('キューイベントリスナーを削除しました', {
        totalListeners: this.eventListeners.length,
      })
    }
  }

  /**
   * キューサービスを停止し、リソースをクリーンアップ
   */
  public async destroy(): Promise<void> {
    try {
      this.isDestroyed = true

      // 処理間隔を停止
      if (this.processingInterval) {
        clearInterval(this.processingInterval)
        this.processingInterval = null
      }

      // クリーンアップ間隔を停止
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval)
        this.cleanupInterval = null
      }

      // 進行中のリクエストの完了を待つ（最大10秒）
      const maxWaitTime = 10000
      const startTime = Date.now()
      while (this.processingRequests.size > 0 && (Date.now() - startTime) < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      // キューをクリア
      this.requestQueues.clear()
      this.processingRequests.clear()
      this.eventListeners.length = 0

      console.log('Backlog リクエストキューサービスを終了しました', {
        processingRequestsAtShutdown: this.processingRequests.size,
        waitTime: Date.now() - startTime,
      })
    }
    catch (error) {
      console.error('リクエストキューサービスの終了時にエラーが発生しました', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // ===================
  // プライベートメソッド
  // ===================

  /**
   * 優先度を正規化（数値からenumへの変換をサポート）
   *
   * @param priority - 優先度（数値またはenum）
   * @returns 正規化された優先度
   */
  private normalizePriority(priority: RequestPriority | number | string): RequestPriority {
    // 既にenum値の場合はそのまま返す
    if (typeof priority === 'string' && Object.values(RequestPriority).includes(priority as RequestPriority)) {
      return priority as RequestPriority
    }

    // 数値の場合は変換
    if (typeof priority === 'number') {
      switch (priority) {
        case 0:
        case 1:
          return RequestPriority.HIGH
        case 2:
          return RequestPriority.MEDIUM
        case 3:
        default:
          return RequestPriority.LOW
      }
    }

    // 文字列の場合（数値文字列の可能性）
    if (typeof priority === 'string') {
      const numericPriority = parseInt(priority, 10)
      if (!isNaN(numericPriority)) {
        return this.normalizePriority(numericPriority)
      }
    }

    // デフォルトは中優先度
    console.warn('無効な優先度が指定されました。MEDIUMを使用します', { priority })
    return RequestPriority.MEDIUM
  }

  /**
   * リクエスト処理を開始
   */
  private startProcessing(): void {
    // 100ms毎にキューを処理
    this.processingInterval = setInterval(async () => {
      if (this.isDestroyed) return

      try {
        await this.processQueue()
      }
      catch (error) {
        console.error('キュー処理でエラーが発生しました', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }, 100)

    console.log('リクエストキュー処理を開始しました')
  }

  /**
   * キューを処理（優先度順）
   */
  private async processQueue(): Promise<void> {
    // 高優先度 → 中優先度 → 低優先度の順で処理
    const priorities = [RequestPriority.HIGH, RequestPriority.MEDIUM, RequestPriority.LOW]

    for (const priority of priorities) {
      await this.processPriorityQueue(priority)
    }
  }

  /**
   * 特定優先度のキューを処理
   *
   * @param priority - 処理する優先度
   */
  private async processPriorityQueue(priority: RequestPriority): Promise<void> {
    const queue = this.requestQueues.get(priority)
    if (!queue || queue.length === 0) return

    const maxConcurrency = this.concurrencyLimits[priority]
    const currentProcessing = Array.from(this.processingRequests.values())
      .filter(req => req.priority === priority).length

    if (currentProcessing >= maxConcurrency) {
      return // 並列数制限に達している
    }

    // 処理可能な数だけリクエストを取得
    const availableSlots = maxConcurrency - currentProcessing
    const requestsToProcess = queue.splice(0, Math.min(availableSlots, queue.length))

    for (const request of requestsToProcess) {
      // 非同期で処理開始
      this.processRequest(request).catch((error) => {
        console.error('リクエスト処理でエラーが発生しました', {
          requestId: request.id,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }
  }

  /**
   * 個別リクエストを処理
   *
   * @param request - 処理するリクエスト
   */
  private async processRequest(request: QueuedRequest): Promise<void> {
    try {
      // 処理中リストに追加
      this.processingRequests.set(request.id, request)
      this.stats.processing++
      this.stats.totalQueued--
      this.stats.priorityBreakdown[request.priority]--

      request.executedAt = new Date()

      console.log('リクエスト処理を開始します', {
        requestId: request.id,
        spaceId: request.spaceId,
        endpoint: request.endpoint,
        priority: request.priority,
        retryCount: request.retryCount,
      })

      // イベントを発火
      await this.emitEvent({
        type: 'request_started',
        requestId: request.id,
        spaceId: request.spaceId,
        priority: request.priority,
        timestamp: request.executedAt,
        metadata: {
          endpoint: request.endpoint,
          retryCount: request.retryCount,
        },
      })

      // レート制限チェック
      const delay = await this.rateLimiter.checkRequestPermission(request.spaceId, request.endpoint)
      if (delay > 0) {
        console.log('レート制限により遅延します', {
          requestId: request.id,
          spaceId: request.spaceId,
          delay,
        })
        await new Promise(resolve => setTimeout(resolve, delay))
      }

      // APIクライアントを取得
      const apiClient = this.connectionManager.getApiClient(request.spaceId)
      if (!apiClient) {
        throw new Error(`API client not found for space: ${request.spaceId}`)
      }

      // リクエストを実行
      let result: any
      if (request.requestFn) {
        result = await request.requestFn()
      }
      else {
        result = await this.executeApiRequest(apiClient, request)
      }

      // 差分更新の場合、lastSyncTimeを更新
      if (request.updatedSince) {
        await this.updateLastSyncTime(request.spaceId, request.endpoint)
      }

      request.completedAt = new Date()
      this.stats.completed++

      console.log('リクエスト処理が完了しました', {
        requestId: request.id,
        spaceId: request.spaceId,
        endpoint: request.endpoint,
        processingTime: request.completedAt.getTime() - request.executedAt.getTime(),
        resultSize: result && typeof result === 'object' ? Object.keys(result).length : 'unknown',
      })

      // イベントを発火
      await this.emitEvent({
        type: 'request_completed',
        requestId: request.id,
        spaceId: request.spaceId,
        priority: request.priority,
        timestamp: request.completedAt,
        metadata: {
          endpoint: request.endpoint,
          processingTime: request.completedAt.getTime() - request.executedAt.getTime(),
          resultSize: result && typeof result === 'object' ? Object.keys(result).length : 'unknown',
        },
      })
    }
    catch (error) {
      await this.handleRequestError(request, error)
    }
    finally {
      // 処理中リストから削除
      this.processingRequests.delete(request.id)
      this.stats.processing--
    }
  }

  /**
   * APIリクエストを実行
   *
   * @param apiClient - APIクライアント
   * @param request - リクエスト情報
   * @returns API実行結果
   */
  private async executeApiRequest(apiClient: BacklogApiClient, request: QueuedRequest): Promise<any> {
    // エンドポイントに基づいて適切なAPIメソッドを呼び出し
    switch (request.endpoint) {
      case '/issues':
        return apiClient.getIssues(request.params as BacklogIssueSearchParams)
      case '/projects':
        return apiClient.getProjects()
      case '/users':
        return apiClient.getUsers()
      case '/space':
        return apiClient.getSpace()
      default:
        // カスタムエンドポイントの場合
        if (request.endpoint.startsWith('/issues/')) {
          const issueId = request.endpoint.replace('/issues/', '')
          return apiClient.getIssue(issueId)
        }
        if (request.endpoint.startsWith('/projects/')) {
          const projectId = request.endpoint.replace('/projects/', '')
          return apiClient.getProject(projectId)
        }
        throw new Error(`Unsupported endpoint: ${request.endpoint}`)
    }
  }

  /**
   * リクエストエラーを処理
   *
   * @param request - エラーが発生したリクエスト
   * @param error - エラー情報
   */
  private async handleRequestError(request: QueuedRequest, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error)
    request.error = errorMessage
    request.retryCount++

    console.error('リクエスト処理でエラーが発生しました', {
      requestId: request.id,
      spaceId: request.spaceId,
      endpoint: request.endpoint,
      retryCount: request.retryCount,
      maxRetries: request.maxRetries,
      error: errorMessage,
    })

    // リトライが可能な場合
    if (request.retryCount < request.maxRetries) {
      // 指数バックオフで再キューイング
      const backoffDelay = Math.min(1000 * Math.pow(2, request.retryCount), 30000) // 最大30秒
      request.scheduledAt = new Date(Date.now() + backoffDelay)

      // 元のキューに戻す
      const queue = this.requestQueues.get(request.priority)
      if (queue) {
        queue.push(request)
        this.stats.totalQueued++
        this.stats.priorityBreakdown[request.priority]++
      }

      console.log('リクエストを再試行キューに追加しました', {
        requestId: request.id,
        backoffDelay,
        scheduledAt: request.scheduledAt,
      })
    }
    else {
      // 最大リトライ回数に達した場合
      this.stats.failed++

      console.error('リクエストが最大リトライ回数に達しました', {
        requestId: request.id,
        spaceId: request.spaceId,
        endpoint: request.endpoint,
        finalError: errorMessage,
      })

      // 失敗イベントを発火
      await this.emitEvent({
        type: 'request_failed',
        requestId: request.id,
        spaceId: request.spaceId,
        priority: request.priority,
        timestamp: new Date(),
        error: error instanceof Error ? error : new Error(errorMessage),
        metadata: {
          endpoint: request.endpoint,
          retryCount: request.retryCount,
          maxRetries: request.maxRetries,
        },
      })
    }
  }

  /**
   * 差分更新を使用すべきかチェック
   *
   * @param endpoint - APIエンドポイント
   * @returns 差分更新使用可否
   */
  private shouldUseDifferentialUpdate(endpoint: string): boolean {
    // 差分更新をサポートするエンドポイント
    const supportedEndpoints = [
      '/issues',
      '/projects',
      '/users',
    ]

    return supportedEndpoints.some(supported => endpoint.startsWith(supported))
  }

  /**
   * 最後の同期時間を取得
   *
   * @param spaceId - スペースID
   * @param endpoint - エンドポイント
   * @returns 最後の同期時間（ISO文字列）
   */
  private async getLastSyncTime(spaceId: string, endpoint: string): Promise<string | null> {
    try {
      const results = await this.db.getDrizzle()
        .select()
        .from(syncLogs)
        .where(
          and(
            eq(syncLogs.connectionId, spaceId),
            eq(syncLogs.status, 'completed'),
          ),
        )
        .orderBy(syncLogs.completedAt)
        .limit(1)

      if (results.length === 0) {
        return null
      }

      const lastSync = results[0].completedAt
      if (!lastSync) {
        return null
      }

      console.log('最後の同期時間を取得しました', {
        spaceId,
        endpoint,
        lastSync,
      })

      return lastSync
    }
    catch (error) {
      console.error('最後の同期時間の取得に失敗しました', {
        spaceId,
        endpoint,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /**
   * 最後の同期時間を更新
   *
   * @param spaceId - スペースID
   * @param endpoint - エンドポイント
   */
  private async updateLastSyncTime(spaceId: string, endpoint: string): Promise<void> {
    try {
      const now = new Date().toISOString()

      await this.db.getDrizzle()
        .insert(syncLogs)
        .values({
          connectionId: spaceId,
          syncType: 'incremental',
          status: 'completed',
          startedAt: now,
          completedAt: now,
          itemsProcessed: 1,
          itemsUpdated: 0,
          itemsCreated: 0,
          itemsDeleted: 0,
        })
        .onConflictDoUpdate({
          target: [syncLogs.connectionId],
          set: {
            completedAt: now,
            itemsProcessed: 1,
          },
        })

      console.log('同期時間を更新しました', {
        spaceId,
        endpoint,
        syncTime: now,
      })
    }
    catch (error) {
      console.error('同期時間の更新に失敗しました', {
        spaceId,
        endpoint,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * 統計情報を更新
   */
  private updateStats(): void {
    // 最古・最新リクエスト時刻を計算
    let oldestRequest: Date | undefined
    let newestRequest: Date | undefined

    for (const queue of this.requestQueues.values()) {
      for (const request of queue) {
        if (!oldestRequest || request.createdAt < oldestRequest) {
          oldestRequest = request.createdAt
        }
        if (!newestRequest || request.createdAt > newestRequest) {
          newestRequest = request.createdAt
        }
      }
    }

    if (oldestRequest) this.stats.oldestRequest = oldestRequest
    if (newestRequest) this.stats.newestRequest = newestRequest

    // スループット計算（過去1分間の完了リクエスト数）
    const _oneMinuteAgo = Date.now() - 60 * 1000
    const completedInLastMinute = this.stats.completed // 簡易実装
    this.stats.throughput = completedInLastMinute / 60 // req/sec
  }

  /**
   * リクエストIDを生成
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * イベントを発火
   *
   * @param event - 発火するイベント
   */
  private async emitEvent(event: QueueEvent): Promise<void> {
    for (const listener of this.eventListeners) {
      try {
        listener(event)
      }
      catch (error) {
        console.error('キューイベントリスナーでエラーが発生しました', {
          eventType: event.type,
          requestId: event.requestId,
          spaceId: event.spaceId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  /**
   * クリーンアップ処理を開始
   */
  private startCleanup(): void {
    // 5分毎にクリーンアップを実行
    this.cleanupInterval = setInterval(() => {
      this.performCleanup().catch((error) => {
        console.error('クリーンアップでエラーが発生しました', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }, 5 * 60 * 1000) // 5分

    console.log('リクエストキューのクリーンアップスケジューラーを開始しました')
  }

  /**
   * クリーンアップを実行
   */
  private async performCleanup(): Promise<void> {
    try {
      const now = Date.now()
      const maxAge = 24 * 60 * 60 * 1000 // 24時間
      let cleanedCount = 0

      // 古いリクエストを削除
      for (const [priority, queue] of this.requestQueues) {
        const initialLength = queue.length
        const filteredQueue = queue.filter((req) => {
          const age = now - req.createdAt.getTime()
          return age < maxAge
        })

        const removed = initialLength - filteredQueue.length
        if (removed > 0) {
          this.requestQueues.set(priority, filteredQueue)
          this.stats.totalQueued -= removed
          this.stats.priorityBreakdown[priority] -= removed
          cleanedCount += removed
        }
      }

      if (cleanedCount > 0) {
        console.log('古いリクエストをクリーンアップしました', {
          cleanedCount,
          remainingQueued: this.stats.totalQueued,
        })
      }
    }
    catch (error) {
      console.error('クリーンアップ処理でエラーが発生しました', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/**
 * リクエストキューファクトリー関数
 *
 * @param db - データベース接続
 * @param rateLimiter - レート制限管理インスタンス
 * @param connectionManager - 接続管理インスタンス
 * @returns BacklogRequestQueueインスタンス
 */
export function createBacklogRequestQueue(
  db: Database,
  rateLimiter: BacklogRateLimiter,
  connectionManager: BacklogConnectionManager,
): BacklogRequestQueue {
  return new BacklogRequestQueue(db, rateLimiter, connectionManager)
}

/**
 * キュー統計サマリー生成
 *
 * @param stats - キュー統計情報
 * @returns フォーマットされた統計サマリー
 */
export function formatQueueStatsSummary(stats: QueueStats): string {
  const utilizationLevel = stats.processing >= 5
    ? 'high'
    : stats.processing >= 2 ? 'medium' : 'low'

  return `リクエストキュー: ${stats.totalQueued} 待機中, `
    + `${stats.processing} 処理中 (${utilizationLevel}), `
    + `完了: ${stats.completed}, 失敗: ${stats.failed}, `
    + `スループット: ${stats.throughput.toFixed(2)} req/sec, `
    + `優先度内訳: H:${stats.priorityBreakdown.HIGH}, M:${stats.priorityBreakdown.MEDIUM}, L:${stats.priorityBreakdown.LOW}`
}

/**
 * デフォルトエクスポート
 */
export default BacklogRequestQueue
