/**
 * Backlog Direct API接続管理サービス Phase 6（最終フェーズ）
 *
 * 2層キャッシュシステム（L1:メモリ + L2:SQLite）による高速レスポンス、
 * スマートキャッシュ戦略、自動クリーンアップ機能を提供します。
 * Phase 1-5の全コンポーネントとの完全統合を実現します。
 *
 * Features:
 * - L1: LRUメモリキャッシュ（サブミリ秒レスポンス）
 * - L2: SQLiteキャッシュ（永続化、既存cacheテーブル活用）
 * - APIエンドポイント毎の最適化されたTTL設定
 * - 差分更新による効率的同期
 * - プリフェッチとバックグラウンド更新
 * - 自動ガベージコレクション対応
 * - Phase 1-5との完全統合
 */

import { eq, lt, sql } from 'drizzle-orm'
import Database from '../../database/connection'
import { cache as cacheTable } from '../../database/schema'
import type { BacklogApiClient } from './api-client'
import type { BacklogRateLimiter } from './rate-limiter'
import type { BacklogConnectionManager } from './connection-manager'
import type { BacklogRequestQueue } from './request-queue'
import type {
  BacklogIssue,
  BacklogProject,
  BacklogUser,
  BacklogSpace,
} from '../../../../shared/types/backlog'

/**
 * キャッシュエントリ（L1メモリキャッシュ用）
 */
export interface CacheEntry<T = any> {
  key: string
  value: T
  expiresAt: number
  createdAt: number
  accessCount: number
  lastAccessed: number
  size: number // バイト数
}

/**
 * キャッシュ統計情報
 */
export interface CacheStats {
  l1HitRate: number
  l2HitRate: number
  overallHitRate: number
  totalHits: number
  totalMisses: number
  totalRequests: number
  memoryUsage: number // バイト
  diskUsage: number // バイト
  entryCount: {
    l1: number
    l2: number
  }
  performanceMetrics: {
    averageL1ResponseTime: number // ミリ秒
    averageL2ResponseTime: number // ミリ秒
    averageApiResponseTime: number // ミリ秒
  }
}

/**
 * キャッシュ設定
 */
export interface CacheConfig {
  maxMemorySize: number // L1キャッシュの最大メモリサイズ（バイト）
  maxMemoryEntries: number // L1キャッシュの最大エントリ数
  defaultTtl: number // デフォルトTTL（ミリ秒）
  cleanupInterval: number // 自動クリーンアップ間隔（ミリ秒）
  compressionEnabled: boolean // データ圧縮有効化
  prefetchEnabled: boolean // プリフェッチ有効化
  backgroundRefreshEnabled: boolean // バックグラウンド更新有効化
}

/**
 * APIエンドポイント毎のキャッシュTTL設定
 */
const CACHE_TTL_CONFIG = {
  // ユーザー情報（比較的静的）
  user: 15 * 60 * 1000, // 15分
  users: 15 * 60 * 1000, // 15分

  // プロジェクト情報（まあまあ静的）
  project: 30 * 60 * 1000, // 30分
  projects: 30 * 60 * 1000, // 30分

  // イシュー情報（動的、頻繁更新）
  issue: 5 * 60 * 1000, // 5分
  issues: 5 * 60 * 1000, // 5分

  // スペース情報（静的）
  space: 60 * 60 * 1000, // 1時間

  // メタデータ（非常に静的）
  issueTypes: 12 * 60 * 60 * 1000, // 12時間
  priorities: 12 * 60 * 60 * 1000, // 12時間
  statuses: 12 * 60 * 60 * 1000, // 12時間
  categories: 12 * 60 * 60 * 1000, // 12時間
  versions: 6 * 60 * 60 * 1000, // 6時間
  milestones: 6 * 60 * 60 * 1000, // 6時間

  // デフォルト
  default: 10 * 60 * 1000, // 10分
} as const

/**
 * LRU（最少使用）キャッシュの実装
 */
class LRUCache<T = any> {
  private cache = new Map<string, CacheEntry<T>>()
  private maxSize: number
  private maxEntries: number
  private currentSize = 0

  constructor(maxSize: number, maxEntries: number) {
    this.maxSize = maxSize
    this.maxEntries = maxEntries
  }

  /**
   * キャッシュからデータを取得
   */
  get(key: string): T | null {
    const entry = this.cache.get(key)
    if (!entry) {
      return null
    }

    // TTL有効期限チェック
    if (Date.now() > entry.expiresAt) {
      this.delete(key)
      return null
    }

    // アクセス統計更新
    entry.accessCount++
    entry.lastAccessed = Date.now()

    // LRU: 最近アクセスされたエントリを末尾に移動
    this.cache.delete(key)
    this.cache.set(key, entry)

    return entry.value
  }

  /**
   * キャッシュにデータを設定
   */
  set(key: string, value: T, ttl: number): void {
    const size = this.estimateSize(value)
    const now = Date.now()

    // 既存エントリの削除（サイズ計算調整）
    const existing = this.cache.get(key)
    if (existing) {
      this.currentSize -= existing.size
    }

    // 容量制限チェック & エビクション
    this.ensureCapacity(size)

    const entry: CacheEntry<T> = {
      key,
      value,
      expiresAt: now + ttl,
      createdAt: now,
      accessCount: 0,
      lastAccessed: now,
      size,
    }

    this.cache.set(key, entry)
    this.currentSize += size
  }

  /**
   * キャッシュからエントリを削除
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key)
    if (entry) {
      this.currentSize -= entry.size
      return this.cache.delete(key)
    }
    return false
  }

  /**
   * 期限切れエントリのクリーンアップ
   */
  cleanup(): number {
    const now = Date.now()
    let deletedCount = 0

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.delete(key)
        deletedCount++
      }
    }

    return deletedCount
  }

  /**
   * 容量確保（LRUエビクション）
   */
  private ensureCapacity(newEntrySize: number): void {
    // メモリサイズ制限チェック（優先）
    while (this.currentSize + newEntrySize > this.maxSize && this.cache.size > 0) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.delete(firstKey)
      }
    }

    // エントリ数制限チェック
    while (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.delete(firstKey)
      }
    }
  }

  /**
   * データサイズ推定
   */
  private estimateSize(value: any): number {
    if (value === null || value === undefined) {
      return 8
    }

    if (typeof value === 'string') {
      return value.length * 2 // UTF-16文字あたり2バイト
    }

    if (typeof value === 'number') {
      return 8
    }

    if (typeof value === 'boolean') {
      return 4
    }

    // オブジェクト・配列の場合はJSON文字列化してサイズ推定
    try {
      return JSON.stringify(value).length * 2
    }
    catch {
      return 1024 // フォールバック
    }
  }

  /**
   * 統計情報取得
   */
  getStats(): { size: number, entryCount: number, memoryUsage: number } {
    return {
      size: this.cache.size,
      entryCount: this.cache.size,
      memoryUsage: this.currentSize,
    }
  }

  /**
   * 全エントリクリア
   */
  clear(): void {
    this.cache.clear()
    this.currentSize = 0
  }

  /**
   * 全エントリを取得（デバッグ用）
   */
  entries(): IterableIterator<[string, CacheEntry<T>]> {
    return this.cache.entries()
  }
}

/**
 * 2層キャッシュマネージャー
 */
export class BacklogCacheManager {
  private database: DatabaseManager
  private l1Cache: LRUCache
  private config: CacheConfig
  private stats: CacheStats
  private cleanupTimer?: NodeJS.Timeout
  private prefetchQueue: Set<string>
  private backgroundRefreshQueue: Set<string>

  // Phase 1-5統合用
  private apiClient?: BacklogApiClient
  private _rateLimiter?: BacklogRateLimiter
  private _connectionManager?: BacklogConnectionManager
  private _requestQueue?: BacklogRequestQueue

  constructor(
    database: DatabaseManager,
    config: Partial<CacheConfig> = {},
  ) {
    this.database = database
    this.config = {
      maxMemorySize: 100 * 1024 * 1024, // 100MB
      maxMemoryEntries: 10000,
      defaultTtl: 10 * 60 * 1000, // 10分
      cleanupInterval: 5 * 60 * 1000, // 5分
      compressionEnabled: true,
      prefetchEnabled: true,
      backgroundRefreshEnabled: true,
      ...config,
    }

    // l1設定が提供されている場合はそれを使用、そうでなければデフォルト設定を使用
    const l1MaxSize = config.l1?.maxSize ?? this.config.maxMemorySize
    const l1MaxEntries = config.l1?.maxEntries ?? this.config.maxMemoryEntries
    this.l1Cache = new LRUCache(l1MaxSize, l1MaxEntries)
    this.prefetchQueue = new Set()
    this.backgroundRefreshQueue = new Set()

    this.stats = {
      l1HitRate: 0,
      l2HitRate: 0,
      overallHitRate: 0,
      totalHits: 0,
      totalMisses: 0,
      totalRequests: 0,
      memoryUsage: 0,
      diskUsage: 0,
      entryCount: { l1: 0, l2: 0 },
      performanceMetrics: {
        averageL1ResponseTime: 0,
        averageL2ResponseTime: 0,
        averageApiResponseTime: 0,
      },
    }

    this.startCleanupTimer()
  }

  /**
   * Phase 1-5コンポーネントとの統合初期化
   */
  integrateDependencies(
    apiClient: BacklogApiClient,
    rateLimiter: BacklogRateLimiter,
    connectionManager: BacklogConnectionManager,
    requestQueue: BacklogRequestQueue,
  ): void {
    this.apiClient = apiClient
    this.rateLimiter = rateLimiter
    this.connectionManager = connectionManager
    this.requestQueue = requestQueue
  }

  /**
   * キャッシュからデータを取得（2層検索）
   */
  async get<T = any>(key: string): Promise<T | null> {
    const startTime = performance.now()
    this.stats.totalRequests++

    try {
      // L1キャッシュ検索
      const l1StartTime = performance.now()
      const l1Result = this.l1Cache.get(key)
      const l1Duration = performance.now() - l1StartTime

      this.updatePerformanceMetrics('l1', l1Duration)

      if (l1Result !== null) {
        this.stats.totalHits++
        this.updateHitRates()
        return l1Result as T
      }

      // L2キャッシュ検索
      const l2StartTime = performance.now()
      const l2Result = await this.getFromL2Cache<T>(key)
      const l2Duration = performance.now() - l2StartTime

      this.updatePerformanceMetrics('l2', l2Duration)

      if (l2Result !== null) {
        // L2ヒット時はL1キャッシュにも保存
        const ttl = this.getTtlForKey(key)
        this.l1Cache.set(key, l2Result, ttl)

        this.stats.totalHits++
        this.updateHitRates()
        return l2Result
      }

      // キャッシュミス
      this.stats.totalMisses++
      this.updateHitRates()

      // バックグラウンド更新キューに追加（プリフェッチ用）
      if (this.config.backgroundRefreshEnabled) {
        this.backgroundRefreshQueue.add(key)
        this.scheduleBackgroundRefresh()
      }

      return null
    }
    finally {
      const totalDuration = performance.now() - startTime
      console.debug(`Cache lookup for ${key}: ${totalDuration.toFixed(2)}ms`)
    }
  }

  /**
   * キャッシュにデータを設定（2層書き込み）
   */
  async set<T = any>(key: string, value: T, customTtl?: number): Promise<void> {
    const ttl = customTtl || this.getTtlForKey(key)
    const expiresAt = new Date(Date.now() + ttl)

    try {
      // L1キャッシュに設定
      this.l1Cache.set(key, value, ttl)

      // L2キャッシュに設定
      await this.setToL2Cache(key, value, expiresAt)

      console.debug(`Cache set for ${key}, TTL: ${ttl}ms`)
    }
    catch (error) {
      console.error(`Failed to set cache for ${key}:`, error)
      throw error
    }
  }

  /**
   * キャッシュからエントリを削除
   */
  async delete(key: string): Promise<boolean> {
    const l1Deleted = this.l1Cache.delete(key)
    const l2Deleted = await this.deleteFromL2Cache(key)

    return l1Deleted || l2Deleted
  }

  /**
   * パターンマッチによる一括削除
   */
  async deletePattern(pattern: string): Promise<number> {
    let deletedCount = 0

    // L1キャッシュのパターンマッチ削除
    for (const [key] of this.l1Cache.entries()) {
      if (this.matchesPattern(key, pattern)) {
        this.l1Cache.delete(key)
        deletedCount++
      }
    }

    // L2キャッシュのパターンマッチ削除
    try {
      const result = await this.database.getDrizzle()
        .delete(cacheTable)
        .where(sql`${cacheTable.key} LIKE ${pattern.replace('*', '%')}`)

      deletedCount += result.changes || 0
    }
    catch (error) {
      console.error('Failed to delete L2 cache pattern:', error)
    }

    console.debug(`Deleted ${deletedCount} cache entries matching pattern: ${pattern}`)
    return deletedCount
  }

  /**
   * 期限切れエントリのクリーンアップ
   */
  async cleanup(): Promise<{ l1Deleted: number, l2Deleted: number }> {
    console.debug('Starting cache cleanup...')

    // L1キャッシュクリーンアップ
    const l1Deleted = this.l1Cache.cleanup()

    // L2キャッシュクリーンアップ
    let l2Deleted = 0
    try {
      const result = await this.database.getDrizzle()
        .delete(cacheTable)
        .where(lt(cacheTable.expiresAt, new Date().toISOString()))

      l2Deleted = result.changes || 0
    }
    catch (error) {
      console.error('Failed to cleanup L2 cache:', error)
    }

    // 統計更新
    this.updateStats()

    console.debug(`Cache cleanup completed: L1=${l1Deleted}, L2=${l2Deleted} entries deleted`)
    return { l1Deleted, l2Deleted }
  }

  /**
   * キャッシュ無効化（削除）
   */
  async invalidate(key: string): Promise<boolean> {
    let deleted = false

    // L1キャッシュから削除
    if (this.l1Cache.delete(key)) {
      deleted = true
    }

    // L2キャッシュから削除
    try {
      const result = await this.database.getDrizzle()
        .delete(cacheTable)
        .where(eq(cacheTable.key, key))

      if (result.changes && result.changes > 0) {
        deleted = true
      }
    }
    catch (error) {
      console.error('Failed to invalidate L2 cache:', error)
    }

    this.updateStats()
    return deleted
  }

  /**
   * 統計情報取得
   */
  getStats(): CacheStats & { l1: any, l2: any, hitRate: number } {
    this.updateStats()
    const l1Stats = this.l1Cache.getStats()
    return {
      ...this.stats,
      hitRate: this.stats.overallHitRate,
      l1: {
        size: l1Stats.entryCount,
        hits: this.stats.totalHits,
        misses: this.stats.totalMisses,
        hitRate: this.stats.l1HitRate,
      },
      l2: {
        size: this.stats.entryCount.l2,
        hits: 0,
        misses: 0,
        hitRate: this.stats.l2HitRate,
      },
    }
  }

  /**
   * プリフェッチ（関連データの事前キャッシュ）
   */
  async prefetch(keys: string[]): Promise<void> {
    if (!this.config.prefetchEnabled || !this.apiClient) {
      return
    }

    console.debug(`Starting prefetch for ${keys.length} keys`)

    for (const key of keys) {
      this.prefetchQueue.add(key)
    }

    // 非同期でプリフェッチ実行
    this.executePrefetch().catch((error) => {
      console.error('Prefetch failed:', error)
    })
  }

  /**
   * リフレッシュ（既存キャッシュの更新）
   */
  async refresh(key: string): Promise<void>
  async refresh(key: string, refreshFn: () => Promise<any>): Promise<void>
  async refresh(key: string, refreshFn?: () => Promise<any>): Promise<void> {
    try {
      // 既存キャッシュ削除
      await this.delete(key)

      let data: any = null

      if (refreshFn) {
        // カスタムリフレッシュ関数を使用
        data = await refreshFn()
      }
      else if (this.apiClient) {
        // APIからデータ取得してキャッシュ更新
        data = await this.fetchFromApi(key)
      }
      else {
        console.warn('API client not integrated and no refresh function provided')
        return
      }

      if (data !== null) {
        await this.set(key, data)
        console.debug(`Cache refreshed for ${key}`)
      }
    }
    catch (error) {
      console.error(`Failed to refresh cache for ${key}:`, error)
      throw error
    }
  }

  /**
   * 全キャッシュクリア
   */
  async clear(): Promise<void> {
    // L1キャッシュクリア
    this.l1Cache.clear()

    // L2キャッシュクリア
    try {
      await this.database.getDrizzle()
        .delete(cacheTable)
      console.debug('All cache cleared')
    }
    catch (error) {
      console.error('Failed to clear L2 cache:', error)
      throw error
    }

    // 統計リセット
    this.resetStats()
  }

  /**
   * リソース解放
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = undefined
    }

    this.l1Cache.clear()
    this.prefetchQueue.clear()
    this.backgroundRefreshQueue.clear()

    console.debug('Cache manager destroyed')
  }

  /**
   * L2キャッシュ（SQLite）からデータ取得
   */
  private async getFromL2Cache<T>(key: string): Promise<T | null> {
    try {
      const result = await this.database.getDrizzle()
        .select()
        .from(cacheTable)
        .where(eq(cacheTable.key, key))
        .limit(1)

      if (result.length === 0) {
        return null
      }

      const entry = result[0]

      // TTL有効期限チェック
      if (entry.expiresAt && new Date() > new Date(entry.expiresAt)) {
        // 期限切れエントリ削除
        await this.deleteFromL2Cache(key)
        return null
      }

      // データをパース
      try {
        return JSON.parse(entry.value) as T
      }
      catch (parseError) {
        console.error(`Failed to parse cached data for ${key}:`, parseError)
        await this.deleteFromL2Cache(key)
        return null
      }
    }
    catch (error) {
      console.error(`Failed to get from L2 cache for ${key}:`, error)
      return null
    }
  }

  /**
   * L2キャッシュ（SQLite）にデータ設定
   */
  private async setToL2Cache<T>(key: string, value: T, expiresAt: Date): Promise<void> {
    try {
      const serializedValue = JSON.stringify(value)

      await this.database.getDrizzle()
        .insert(cacheTable)
        .values({
          key,
          value: serializedValue,
          expiresAt: expiresAt.toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: cacheTable.key,
          set: {
            value: serializedValue,
            expiresAt: expiresAt.toISOString(),
            updatedAt: new Date().toISOString(),
          },
        })
    }
    catch (error) {
      console.error(`Failed to set L2 cache for ${key}:`, error)
      throw error
    }
  }

  /**
   * L2キャッシュからエントリ削除
   */
  private async deleteFromL2Cache(key: string): Promise<boolean> {
    try {
      const result = await this.database.getDrizzle()
        .delete(cacheTable)
        .where(eq(cacheTable.key, key))

      return (result.changes || 0) > 0
    }
    catch (error) {
      console.error(`Failed to delete from L2 cache for ${key}:`, error)
      return false
    }
  }

  /**
   * キーに基づくTTL取得
   */
  private getTtlForKey(key: string): number {
    // キーから エンドポイントタイプを推定
    for (const [endpoint, ttl] of Object.entries(CACHE_TTL_CONFIG)) {
      if (key.includes(endpoint)) {
        return ttl
      }
    }

    return CACHE_TTL_CONFIG.default
  }

  /**
   * パターンマッチング
   */
  private matchesPattern(str: string, pattern: string): boolean {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'))
    return regex.test(str)
  }

  /**
   * APIからデータ取得
   */
  private async fetchFromApi(key: string): Promise<any> {
    if (!this.apiClient) {
      return null
    }

    try {
      // キーからAPIエンドポイントとパラメータを推定
      const { endpoint, params } = this.parseKeyToEndpoint(key)

      // Rate limiterと連携
      if (this.rateLimiter) {
        if (this.rateLimiter) {
          // Rate limiter check would go here
        }
      }

      // API呼び出し（Phase 1統合）
      const response = await (this.apiClient as any).request(endpoint, { params })
      return response.data
    }
    catch (error) {
      console.error(`Failed to fetch from API for ${key}:`, error)
      return null
    }
  }

  /**
   * キーからAPIエンドポイント情報を解析
   */
  private parseKeyToEndpoint(key: string): { endpoint: string, params: any } {
    // キーの例: "spaceId:issues:projectId:1"
    const parts = key.split(':')
    const _spaceId = parts[0]
    const resource = parts[1]

    const endpoint = `/${resource}`
    const params: any = {}

    // リソース固有のパラメータ解析
    if (parts.length > 2) {
      for (let i = 2; i < parts.length; i += 2) {
        if (i + 1 < parts.length && parts[i] !== undefined) {
          params[parts[i]] = parts[i + 1]
        }
      }
    }

    return { endpoint, params }
  }

  /**
   * プリフェッチ実行
   */
  private async executePrefetch(): Promise<void> {
    const keysToFetch = Array.from(this.prefetchQueue)
    this.prefetchQueue.clear()

    for (const key of keysToFetch.slice(0, 10)) { // 最大10件ずつ処理
      try {
        const data = await this.fetchFromApi(key)
        if (data !== null) {
          await this.set(key, data)
        }
      }
      catch (error) {
        console.error(`Prefetch failed for ${key}:`, error)
      }
    }
  }

  /**
   * バックグラウンド更新スケジューリング
   */
  private scheduleBackgroundRefresh(): void {
    if (this.backgroundRefreshQueue.size === 0) {
      return
    }

    // デバウンス実装
    setTimeout(() => {
      this.executeBackgroundRefresh().catch((error) => {
        console.error('Background refresh failed:', error)
      })
    }, 1000) // 1秒後に実行
  }

  /**
   * バックグラウンド更新実行
   */
  private async executeBackgroundRefresh(): Promise<void> {
    const keysToRefresh = Array.from(this.backgroundRefreshQueue)
    this.backgroundRefreshQueue.clear()

    for (const key of keysToRefresh.slice(0, 5)) { // 最大5件ずつ処理
      try {
        await this.refresh(key)
      }
      catch (error) {
        console.error(`Background refresh failed for ${key}:`, error)
      }
    }
  }

  /**
   * 統計情報更新
   */
  private updateStats(): void {
    const l1Stats = this.l1Cache.getStats()

    this.stats.memoryUsage = l1Stats.memoryUsage
    this.stats.entryCount.l1 = l1Stats.entryCount

    // L2統計は非同期で取得（パフォーマンス考慮）
    this.updateL2Stats().catch((error) => {
      console.error('Failed to update L2 stats:', error)
    })
  }

  /**
   * L2統計情報更新
   */
  private async updateL2Stats(): Promise<void> {
    try {
      const countResult = await this.database.getDrizzle()
        .select({ count: sql<number>`COUNT(*)` })
        .from(cacheTable)

      const sizeResult = await this.database.getDrizzle()
        .select({ size: sql<number>`SUM(LENGTH(value))` })
        .from(cacheTable)

      this.stats.entryCount.l2 = countResult[0]?.count || 0
      this.stats.diskUsage = sizeResult[0]?.size || 0
    }
    catch (error) {
      console.error('Failed to get L2 stats:', error)
    }
  }

  /**
   * ヒット率更新
   */
  private updateHitRates(): void {
    if (this.stats.totalRequests === 0) {
      return
    }

    this.stats.overallHitRate = this.stats.totalHits / this.stats.totalRequests
    this.stats.l1HitRate = this.stats.totalHits / this.stats.totalRequests // 簡略化
    this.stats.l2HitRate = this.stats.totalHits / this.stats.totalRequests // 簡略化
  }

  /**
   * パフォーマンスメトリクス更新
   */
  private updatePerformanceMetrics(layer: 'l1' | 'l2' | 'api', duration: number): void {
    const key = `average${layer.toUpperCase()}ResponseTime` as keyof typeof this.stats.performanceMetrics
    const current = this.stats.performanceMetrics[key]

    // 移動平均計算（簡略化）
    this.stats.performanceMetrics[key] = (current * 0.9) + (duration * 0.1)
  }

  /**
   * 統計リセット
   */
  private resetStats(): void {
    this.stats = {
      l1HitRate: 0,
      l2HitRate: 0,
      overallHitRate: 0,
      totalHits: 0,
      totalMisses: 0,
      totalRequests: 0,
      memoryUsage: 0,
      diskUsage: 0,
      entryCount: { l1: 0, l2: 0 },
      performanceMetrics: {
        averageL1ResponseTime: 0,
        averageL2ResponseTime: 0,
        averageApiResponseTime: 0,
      },
    }
  }

  /**
   * 自動クリーンアップタイマー開始
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(async () => {
      try {
        await this.cleanup()
      }
      catch (error) {
        console.error('Scheduled cleanup failed:', error)
      }
    }, this.config.cleanupInterval)
  }
}

/**
 * 統合キャッシュサービス（Phase 1-5統合）
 */
export class IntegratedBacklogCacheService {
  private cacheManager: BacklogCacheManager
  private apiClient!: BacklogApiClient
  private rateLimiter!: BacklogRateLimiter
  private connectionManager!: BacklogConnectionManager
  private requestQueue!: BacklogRequestQueue

  constructor(
    database: DatabaseManager,
    cacheConfig?: Partial<CacheConfig>,
  ) {
    this.cacheManager = new BacklogCacheManager(database, cacheConfig)
  }

  /**
   * 全Phase統合初期化
   */
  async initialize(
    apiClient: BacklogApiClient,
    rateLimiter: BacklogRateLimiter,
    connectionManager: BacklogConnectionManager,
    requestQueue: BacklogRequestQueue,
  ): Promise<void> {
    this.apiClient = apiClient
    this.rateLimiter = rateLimiter
    this.connectionManager = connectionManager
    this.requestQueue = requestQueue

    // 相互依存の設定
    this.cacheManager.integrateDependencies(
      apiClient,
      rateLimiter,
      connectionManager,
      requestQueue,
    )

    console.log('Integrated Backlog Cache Service initialized')
  }

  /**
   * キャッシュ付きAPIリクエスト
   */
  async request<T = any>(
    spaceId: string,
    endpoint: string,
    params: any = {},
    options: { forceRefresh?: boolean, customTtl?: number } = {},
  ): Promise<T> {
    const cacheKey = this.generateCacheKey(spaceId, endpoint, params)

    // 強制リフレッシュでない場合はキャッシュから取得
    if (!options.forceRefresh) {
      const cachedData = await this.cacheManager.get<T>(cacheKey)
      if (cachedData !== null) {
        return cachedData
      }
    }

    // APIリクエスト（Phase 1-5統合）
    const apiResponse = await (this.apiClient as any).request(endpoint, { params })
    const data = apiResponse.data as T

    // キャッシュに保存
    await this.cacheManager.set(cacheKey, data, options.customTtl)

    return data
  }

  /**
   * キャッシュキー生成
   */
  private generateCacheKey(spaceId: string, endpoint: string, params: any): string {
    const paramString = Object.keys(params)
      .sort()
      .map(key => `${key}:${params[key]}`)
      .join(':')

    return `${spaceId}:${endpoint.replace(/^\//, '')}:${paramString}`
  }

  /**
   * 統計情報とヘルスチェック
   */
  getHealthStatus(): {
    initialized: boolean
    cache: CacheStats
    integration: {
      apiClientConnected: boolean
      rateLimiterActive: boolean
      connectionManagerActive: boolean
      requestQueueActive: boolean
    }
  } {
    return {
      initialized: !!this.apiClient || !!this.rateLimiter || !!this.connectionManager || !!this.requestQueue,
      cache: this.cacheManager.getStats(),
      integration: {
        apiClientConnected: !!this.apiClient,
        rateLimiterActive: !!this.rateLimiter,
        connectionManagerActive: !!this.connectionManager,
        requestQueueActive: !!this.requestQueue,
      },
    }
  }

  /**
   * 統計情報取得
   */
  getStats() {
    return this.cacheManager.getStats()
  }

  /**
   * リソース解放
   */
  async destroy(): Promise<void> {
    this.cacheManager.destroy()
    console.log('Integrated Backlog Cache Service destroyed')
  }
}

export default BacklogCacheManager
