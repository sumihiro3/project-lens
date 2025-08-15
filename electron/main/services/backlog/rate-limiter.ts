/**
 * Backlog APIレート制限監視機能
 * 
 * X-RateLimit-*ヘッダーの解析とパース、レート制限状態の追跡、
 * 動的並列数調整ロジック（150req/min × 複数スペース対応）を提供します。
 * Drizzle ORMを使用したデータ永続化とリアルタイム監視機能を実装。
 */

import { eq, and, lt } from 'drizzle-orm'
import Database from '../../database/connection'
import { rateLimits } from '../../database/schema'
import type {
  SelectRateLimit,
  InsertRateLimit,
  // UpdateRateLimit,
} from '../../database/schema'

/**
 * X-RateLimit-*ヘッダー情報
 */
export interface RateLimitHeaders {
  remaining: number
  total: number
  reset: number // Unixタイムスタンプ（秒）
  limit?: number
}

/**
 * レート制限状態情報
 */
export interface RateLimitStatus {
  spaceId: string
  remaining: number
  total: number
  resetTime: Date
  windowStart: Date
  lastUpdated: Date
  isActive: boolean
  endpoint?: string
  method: string
  utilizationPercent: number
  timeToReset: number // ミリ秒
  recommendedDelay: number // 推奨遅延時間（ミリ秒）
}

/**
 * 動的並列数調整設定
 */
export interface ConcurrencyConfig {
  baseRate: number // 基本レート（req/min）
  maxConcurrency: number // 最大並列数
  minConcurrency: number // 最小並列数
  safetyMargin: number // 安全マージン（0.1 = 10%）
  warningThreshold: number // 警告しきい値（0.1 = 残り10%）
}

/**
 * リアルタイム監視イベント
 */
export interface RateLimitEvent {
  type: 'update' | 'warning' | 'limit_reached' | 'reset' | 'cleanup'
  spaceId: string
  status: RateLimitStatus
  timestamp: Date
  metadata?: Record<string, unknown>
}

/**
 * レート制限統計情報
 */
export interface RateLimitStats {
  totalRequests: number
  remainingRequests: number
  utilizationPercent: number
  resetTime: Date
  timeToReset: number
  averageRequestsPerMinute: number
  currentConcurrency: number
  recommendedConcurrency: number
}

/**
 * Backlog APIレート制限監視サービス
 * 
 * スペース毎の個別レート制限管理、動的並列数調整、
 * 予測的リクエスト制御、リアルタイム監視機能を提供します。
 */
export class BacklogRateLimiter {
  private readonly db: DatabaseManager
  private readonly config: ConcurrencyConfig
  private readonly eventListeners: Array<(event: RateLimitEvent) => void> = []
  private readonly activeSpaces = new Map<string, RateLimitStatus>()
  private cleanupInterval: NodeJS.Timeout | null = null

  /**
   * デフォルト設定
   */
  private static readonly DEFAULT_CONFIG: ConcurrencyConfig = {
    baseRate: 150, // Backlogの基本レート制限 150req/min
    maxConcurrency: 10,
    minConcurrency: 1,
    safetyMargin: 0.2, // 20%の安全マージン
    warningThreshold: 0.1, // 残り10%で警告
  }

  /**
   * コンストラクター
   * 
   * @param db - データベース接続インスタンス
   * @param config - 動的並列数調整設定（オプション）
   */
  constructor(db: DatabaseManager, config: Partial<ConcurrencyConfig> = {}) {
    this.db = db
    this.config = { ...BacklogRateLimiter.DEFAULT_CONFIG, ...config }
    
    console.log('Backlog レートリミッターを初期化しました', {
      baseRate: this.config.baseRate,
      maxConcurrency: this.config.maxConcurrency,
      safetyMargin: this.config.safetyMargin,
    })

    // 定期クリーンアップを開始
    this.startCleanupScheduler()
  }

  /**
   * X-RateLimit-*ヘッダーの解析とパース
   * 
   * @param headers - HTTPレスポンスヘッダー
   * @returns パースされたレート制限情報
   */
  public parseRateLimitHeaders(headers: Headers): RateLimitHeaders | null {
    const remaining = headers.get('X-RateLimit-Remaining')
    const total = headers.get('X-RateLimit-Total') || headers.get('X-RateLimit-Limit')
    const reset = headers.get('X-RateLimit-Reset')
    const limit = headers.get('X-RateLimit-Limit')

    if (!remaining || !total || !reset) {
      console.warn('レート制限ヘッダーが不完全です', {
        remaining: !!remaining,
        total: !!total,
        reset: !!reset,
      })
      return null
    }

    try {
      const remainingNum = parseInt(remaining, 10)
      const totalNum = parseInt(total, 10)
      const resetNum = parseInt(reset, 10)
      const limitNum = limit ? parseInt(limit, 10) : undefined

      // 数値の妥当性をチェック
      if (isNaN(remainingNum) || isNaN(totalNum) || isNaN(resetNum) || 
          (limitNum !== undefined && isNaN(limitNum))) {
        console.warn('レート制限ヘッダーに無効な数値が含まれています', {
          remaining, total, reset, limit
        })
        return null
      }

      const parsedHeaders: RateLimitHeaders = {
        remaining: remainingNum,
        total: totalNum,
        reset: resetNum,
        ...(limitNum !== undefined && { limit: limitNum }),
      }

      console.log('レート制限ヘッダーを解析しました', parsedHeaders)
      return parsedHeaders
    } catch (error) {
      console.error('レート制限ヘッダーの解析に失敗しました', {
        error: error instanceof Error ? error.message : String(error),
        headers: { remaining, total, reset, limit },
      })
      return null
    }
  }

  /**
   * レート制限状態を更新
   * 
   * @param spaceId - BacklogスペースID
   * @param headers - レート制限ヘッダー情報
   * @param endpoint - APIエンドポイント（オプション）
   * @param method - HTTPメソッド
   */
  public async updateRateLimit(
    spaceId: string,
    headers: RateLimitHeaders,
    endpoint?: string,
    method: string = 'GET'
  ): Promise<void> {
    try {
      const now = new Date()
      const resetTime = new Date(headers.reset * 1000)
      
      // ウィンドウ開始時間を計算（通常は1分間のウィンドウ）
      const windowDurationMs = 60 * 1000 // 1分
      const windowStart = new Date(resetTime.getTime() - windowDurationMs)

      const rateLimitData: InsertRateLimit = {
        spaceId,
        remaining: headers.remaining,
        total: headers.total,
        resetTime: resetTime.toISOString(),
        windowStart: windowStart.toISOString(),
        lastUpdated: now.toISOString(),
        isActive: true,
        endpoint,
        method,
        updatedAt: now.toISOString(),
      }

      // データベースに挿入または更新
      await this.db.getDrizzle()
        .insert(rateLimits)
        .values(rateLimitData)
        .onConflictDoUpdate({
          target: [rateLimits.spaceId, rateLimits.endpoint, rateLimits.method],
          set: {
            remaining: rateLimitData.remaining,
            total: rateLimitData.total,
            resetTime: rateLimitData.resetTime,
            windowStart: rateLimitData.windowStart,
            lastUpdated: rateLimitData.lastUpdated,
            updatedAt: rateLimitData.updatedAt,
          },
        })

      // メモリ内キャッシュを更新
      const status = this.buildRateLimitStatus(rateLimitData as any, now)
      this.activeSpaces.set(this.getSpaceKey(spaceId, endpoint, method), status)

      // イベントを発火
      await this.emitEvent({
        type: 'update',
        spaceId,
        status,
        timestamp: now,
        metadata: { endpoint, method },
      })

      // 警告チェック
      if (status.utilizationPercent >= (1 - this.config.warningThreshold)) {
        await this.emitEvent({
          type: 'warning',
          spaceId,
          status,
          timestamp: now,
          metadata: { 
            endpoint, 
            method,
            threshold: this.config.warningThreshold,
          },
        })
      }

      // 制限到達チェック
      if (headers.remaining === 0) {
        await this.emitEvent({
          type: 'limit_reached',
          spaceId,
          status,
          timestamp: now,
          metadata: { endpoint, method },
        })
      }

      console.log('レート制限状態を更新しました', {
        spaceId,
        endpoint,
        method,
        remaining: headers.remaining,
        total: headers.total,
        utilizationPercent: status.utilizationPercent,
        timeToReset: status.timeToReset,
      })
    } catch (error) {
      console.error('レート制限状態の更新に失敗しました', {
        spaceId,
        endpoint,
        method,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * スペースのレート制限状態を取得
   * 
   * @param spaceId - BacklogスペースID
   * @param endpoint - APIエンドポイント（オプション）
   * @param method - HTTPメソッド
   * @returns レート制限状態情報
   */
  public async getRateLimitStatus(
    spaceId: string,
    endpoint?: string,
    method: string = 'GET'
  ): Promise<RateLimitStatus | null> {
    try {
      // メモリキャッシュから確認
      const cacheKey = this.getSpaceKey(spaceId, endpoint, method)
      const cachedStatus = this.activeSpaces.get(cacheKey)
      
      if (cachedStatus && this.isStatusValid(cachedStatus)) {
        return cachedStatus
      }

      // データベースから取得
      const condition = endpoint
        ? and(
            eq(rateLimits.spaceId, spaceId),
            eq(rateLimits.endpoint, endpoint),
            eq(rateLimits.method, method),
            eq(rateLimits.isActive, true)
          )
        : and(
            eq(rateLimits.spaceId, spaceId),
            eq(rateLimits.method, method),
            eq(rateLimits.isActive, true)
          )

      const results = await this.db.getDrizzle()
        .select()
        .from(rateLimits)
        .where(condition)
        .orderBy(rateLimits.lastUpdated)
        .limit(1)

      if (results.length === 0) {
        console.log('レート制限情報が見つかりません', { spaceId, endpoint, method })
        return null
      }

      const rateLimitRecord = results[0]
      const now = new Date()
      const status = this.buildRateLimitStatus(rateLimitRecord, now)

      // キャッシュに保存
      this.activeSpaces.set(cacheKey, status)

      return status
    } catch (error) {
      console.error('レート制限状態の取得に失敗しました', {
        spaceId,
        endpoint,
        method,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /**
   * 動的並列数調整ロジック
   * 
   * @param spaceId - BacklogスペースID
   * @param endpoint - APIエンドポイント（オプション）
   * @param method - HTTPメソッド
   * @returns 推奨並列数
   */
  public async calculateOptimalConcurrency(
    spaceId: string,
    endpoint?: string,
    method: string = 'GET'
  ): Promise<number> {
    try {
      const status = await this.getRateLimitStatus(spaceId, endpoint, method)
      
      if (!status) {
        console.log('レート制限情報がないため、最小並列数を返します', { spaceId })
        return this.config.minConcurrency
      }

      // 利用率に基づく動的調整
      const utilizationRate = status.utilizationPercent
      const timeToResetMinutes = status.timeToReset / (60 * 1000)
      const remainingPerMinute = timeToResetMinutes > 0 ? status.remaining / timeToResetMinutes : 0

      // 安全マージンを考慮した並列数計算
      const safeRemainingPerMinute = remainingPerMinute * (1 - this.config.safetyMargin)
      let recommendedConcurrency = Math.floor(safeRemainingPerMinute / 60) // 秒単位に変換

      // 境界値チェック
      recommendedConcurrency = Math.max(this.config.minConcurrency, recommendedConcurrency)
      recommendedConcurrency = Math.min(this.config.maxConcurrency, recommendedConcurrency)

      // 制限が近い場合は大幅に削減
      if (utilizationRate >= (1 - this.config.warningThreshold)) {
        recommendedConcurrency = Math.max(1, Math.floor(recommendedConcurrency * 0.3))
      }

      console.log('動的並列数を計算しました', {
        spaceId,
        endpoint,
        method,
        utilizationRate,
        timeToResetMinutes,
        remainingPerMinute,
        safeRemainingPerMinute,
        recommendedConcurrency,
      })

      return recommendedConcurrency
    } catch (error) {
      console.error('動的並列数の計算に失敗しました', {
        spaceId,
        endpoint,
        method,
        error: error instanceof Error ? error.message : String(error),
      })
      return this.config.minConcurrency
    }
  }

  /**
   * 予測的リクエスト制御
   * リクエスト実行前に制限チェックを行い、推奨遅延時間を計算
   * 
   * @param spaceId - BacklogスペースID
   * @param endpoint - APIエンドポイント（オプション）
   * @param method - HTTPメソッド
   * @returns 推奨遅延時間（ミリ秒）、0は即座に実行可能
   */
  public async checkRequestPermission(
    spaceId: string,
    endpoint?: string,
    method: string = 'GET'
  ): Promise<number> {
    try {
      const status = await this.getRateLimitStatus(spaceId, endpoint, method)
      
      if (!status) {
        console.log('レート制限情報がないため、即座に実行可能とします', { spaceId })
        return 0
      }

      // 制限に到達している場合
      if (status.remaining <= 0) {
        console.log('レート制限に到達しています', {
          spaceId,
          endpoint,
          method,
          timeToReset: status.timeToReset,
        })
        return status.timeToReset
      }

      // 警告しきい値に近い場合は遅延を推奨
      if (status.utilizationPercent >= (1 - this.config.warningThreshold)) {
        const delay = Math.min(5000, status.timeToReset / status.remaining) // 最大5秒の遅延
        console.log('レート制限警告レベルのため遅延を推奨します', {
          spaceId,
          endpoint,
          method,
          utilizationPercent: status.utilizationPercent,
          recommendedDelay: delay,
        })
        return delay
      }

      // 通常の場合は即座に実行可能
      return 0
    } catch (error) {
      console.error('リクエスト許可チェックに失敗しました', {
        spaceId,
        endpoint,
        method,
        error: error instanceof Error ? error.message : String(error),
      })
      return 0 // エラー時は即座に実行を許可
    }
  }

  /**
   * リアルタイム監視イベントリスナーを追加
   * 
   * @param listener - イベントリスナー関数
   */
  public addEventListener(listener: (event: RateLimitEvent) => void): void {
    this.eventListeners.push(listener)
    console.log('レート制限イベントリスナーを追加しました', {
      totalListeners: this.eventListeners.length,
    })
  }

  /**
   * イベントリスナーを削除
   * 
   * @param listener - 削除するイベントリスナー関数
   */
  public removeEventListener(listener: (event: RateLimitEvent) => void): void {
    const index = this.eventListeners.indexOf(listener)
    if (index > -1) {
      this.eventListeners.splice(index, 1)
      console.log('レート制限イベントリスナーを削除しました', {
        totalListeners: this.eventListeners.length,
      })
    }
  }

  /**
   * レート制限統計情報を取得
   * 
   * @param spaceId - BacklogスペースID
   * @returns 統計情報
   */
  public async getStats(spaceId: string): Promise<RateLimitStats | null> {
    try {
      const results = await this.db.getDrizzle()
        .select()
        .from(rateLimits)
        .where(and(
          eq(rateLimits.spaceId, spaceId),
          eq(rateLimits.isActive, true)
        ))
        .orderBy(rateLimits.lastUpdated)

      if (results.length === 0) {
        return null
      }

      // 最新の情報を使用
      const latest = results[results.length - 1]
      const resetTime = new Date(latest.resetTime)
      const windowStart = new Date(latest.windowStart)
      const now = new Date()

      const totalRequests = latest.total
      const remainingRequests = latest.remaining
      const utilizationPercent = ((totalRequests - remainingRequests) / totalRequests) * 100
      const timeToReset = Math.max(0, resetTime.getTime() - now.getTime())
      
      // 平均リクエスト数を計算
      const _windowDuration = resetTime.getTime() - windowStart.getTime()
      const elapsedTime = now.getTime() - windowStart.getTime()
      const requestsMade = totalRequests - remainingRequests
      const averageRequestsPerMinute = (requestsMade / Math.max(elapsedTime, 1)) * (60 * 1000)

      // 現在と推奨並列数
      const currentConcurrency = await this.calculateOptimalConcurrency(spaceId)
      const recommendedConcurrency = currentConcurrency

      const stats: RateLimitStats = {
        totalRequests,
        remainingRequests,
        utilizationPercent,
        resetTime,
        timeToReset,
        averageRequestsPerMinute,
        currentConcurrency,
        recommendedConcurrency,
      }

      console.log('レート制限統計情報を取得しました', {
        spaceId,
        stats,
      })

      return stats
    } catch (error) {
      console.error('レート制限統計情報の取得に失敗しました', {
        spaceId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /**
   * 不要なレート制限データの自動クリーンアップ
   */
  public async cleanup(): Promise<void> {
    try {
      const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000) // 24時間前
      
      const deletedCount = await this.db.getDrizzle()
        .delete(rateLimits)
        .where(
          and(
            lt(rateLimits.resetTime, cutoffTime.toISOString()),
            eq(rateLimits.isActive, false)
          )
        )

      // メモリキャッシュからも古いデータを削除
      const now = new Date()
      for (const [key, status] of this.activeSpaces.entries()) {
        if (!this.isStatusValid(status, now)) {
          this.activeSpaces.delete(key)
        }
      }

      console.log('レート制限データのクリーンアップを実行しました', {
        deletedRecords: deletedCount,
        activeCachedSpaces: this.activeSpaces.size,
      })

      // クリーンアップイベントを発火
      await this.emitEvent({
        type: 'cleanup',
        spaceId: 'system',
        status: this.createDummyStatus(),
        timestamp: now,
        metadata: { deletedRecords: deletedCount },
      })
    } catch (error) {
      console.error('レート制限データのクリーンアップに失敗しました', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * サービスを終了し、リソースをクリーンアップ
   */
  public async destroy(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }

    this.activeSpaces.clear()
    this.eventListeners.length = 0

    console.log('Backlog レートリミッターを終了しました')
  }

  // ===================
  // プライベートメソッド
  // ===================

  /**
   * スペースキーを生成
   */
  private getSpaceKey(spaceId: string, endpoint?: string, method: string = 'GET'): string {
    return `${spaceId}:${endpoint || 'global'}:${method}`
  }

  /**
   * レート制限状態オブジェクトを構築
   */
  private buildRateLimitStatus(data: SelectRateLimit, now: Date): RateLimitStatus {
    const resetTime = new Date(data.resetTime)
    const windowStart = new Date(data.windowStart)
    const lastUpdated = new Date(data.lastUpdated)
    
    const utilizationPercent = ((data.total - data.remaining) / data.total) * 100
    const timeToReset = Math.max(0, resetTime.getTime() - now.getTime())
    
    // 推奨遅延時間を計算
    let recommendedDelay = 0
    if (data.remaining <= 0) {
      recommendedDelay = timeToReset
    } else if (utilizationPercent >= ((1 - this.config.warningThreshold) * 100)) {
      recommendedDelay = Math.min(5000, timeToReset / data.remaining)
    }

    return {
      spaceId: data.spaceId,
      remaining: data.remaining,
      total: data.total,
      resetTime,
      windowStart,
      lastUpdated,
      isActive: !!data.isActive,
      ...(data.endpoint && { endpoint: data.endpoint }),
      method: data.method,
      utilizationPercent,
      timeToReset,
      recommendedDelay,
    }
  }

  /**
   * レート制限状態の有効性をチェック
   */
  private isStatusValid(status: RateLimitStatus, now: Date = new Date()): boolean {
    // リセット時間を過ぎている場合は無効
    if (now.getTime() > status.resetTime.getTime()) {
      return false
    }

    // 最終更新から10分以上経過している場合は無効
    const maxAge = 10 * 60 * 1000 // 10分
    if (now.getTime() - status.lastUpdated.getTime() > maxAge) {
      return false
    }

    return true
  }

  /**
   * イベントを発火
   */
  private async emitEvent(event: RateLimitEvent): Promise<void> {
    for (const listener of this.eventListeners) {
      try {
        listener(event)
      } catch (error) {
        console.error('レート制限イベントリスナーでエラーが発生しました', {
          eventType: event.type,
          spaceId: event.spaceId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  /**
   * 定期クリーンアップスケジューラーを開始
   */
  private startCleanupScheduler(): void {
    // 1時間毎にクリーンアップを実行
    this.cleanupInterval = setInterval(() => {
      this.cleanup().catch(error => {
        console.error('定期クリーンアップでエラーが発生しました', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }, 60 * 60 * 1000) // 1時間

    console.log('定期クリーンアップスケジューラーを開始しました')
  }

  /**
   * ダミーステータスを作成（システムイベント用）
   */
  private createDummyStatus(): RateLimitStatus {
    const now = new Date()
    return {
      spaceId: 'system',
      remaining: 0,
      total: 0,
      resetTime: now,
      windowStart: now,
      lastUpdated: now,
      isActive: false,
      method: 'SYSTEM',
      utilizationPercent: 0,
      timeToReset: 0,
      recommendedDelay: 0,
    }
  }
}

/**
 * レートリミッターファクトリー関数
 * 
 * @param db - データベース接続
 * @param config - 設定（オプション）
 * @returns BacklogRateLimiterインスタンス
 */
export function createBacklogRateLimiter(
  db: Database,
  config: Partial<ConcurrencyConfig> = {}
): BacklogRateLimiter {
  return new BacklogRateLimiter(db, config)
}

/**
 * デフォルトエクスポート
 */
export default BacklogRateLimiter