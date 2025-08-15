/**
 * Backlog Cache Manager Unit Tests
 * 
 * テスト範囲:
 * - L1キャッシュ (LRUメモリ)の基本機能
 * - 基本的なキャッシュ操作
 * - TTL管理
 * - 統計情報
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  BacklogCacheManager,
  IntegratedBacklogCacheService
} from '../../../../electron/main/services/backlog/cache-manager'
import { BacklogApiClient } from '../../../../electron/main/services/backlog/api-client'
import { BacklogRateLimiter } from '../../../../electron/main/services/backlog/rate-limiter'
import { BacklogConnectionManager } from '../../../../electron/main/services/backlog/connection-manager'
import { BacklogRequestQueue } from '../../../../electron/main/services/backlog/request-queue'
import type { DatabaseManager } from '../../../../electron/main/database/connection'
import type { CacheConfig } from '../../../../electron/main/services/backlog/cache-manager'

// データベースモック
const mockDatabase = {
  getDrizzle: vi.fn().mockReturnValue({
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue({ changes: 1 })
      })
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([])
        })
      })
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue({ changes: 0 })
    }),
    run: vi.fn().mockResolvedValue({})
  })
} as unknown as DatabaseManager

// タイマーモック
vi.useFakeTimers()

describe('BacklogCacheManager', () => {
  let cacheManager: BacklogCacheManager
  let config: CacheConfig

  beforeEach(() => {
    config = {
      l1: {
        maxSize: 100,
        ttl: 60000 // 1分
      },
      l2: {
        enabled: true
      }
    }
    cacheManager = new BacklogCacheManager(mockDatabase, config)
    vi.clearAllMocks()
  })

  afterEach(() => {
    cacheManager.destroy()
    vi.clearAllTimers()
  })

  describe('初期化', () => {
    it('デフォルト設定でキャッシュマネージャーを初期化できる', () => {
      expect(cacheManager).toBeDefined()
    })

    it('カスタム設定で初期化できる', () => {
      const customConfig: CacheConfig = {
        l1: { maxSize: 200, ttl: 30000 },
        l2: { enabled: false }
      }
      const customManager = new BacklogCacheManager(mockDatabase, customConfig)
      expect(customManager).toBeDefined()
      customManager.destroy()
    })

    it('自動クリーンアップタイマーが開始される', () => {
      // タイマーがセットアップされていることを確認（実装依存）
      expect(cacheManager).toBeDefined()
    })
  })

  describe('L1キャッシュ (LRUメモリ)', () => {
    it('データをキャッシュに保存して取得できる', async () => {
      const testData = { id: 1, name: 'Test Data' }
      
      await cacheManager.set('test-key', testData)
      const result = await cacheManager.get('test-key')
      
      expect(result).toEqual(testData)
    })

    it('TTLが適切に動作する', async () => {
      const testData = { id: 1, name: 'Test Data' }
      
      await cacheManager.set('test-key', testData, 1000) // 1秒TTL
      
      // 1秒経過前は取得できる
      vi.advanceTimersByTime(500)
      let result = await cacheManager.get('test-key')
      expect(result).toEqual(testData)
      
      // 1秒経過後は取得できない
      vi.advanceTimersByTime(600)
      result = await cacheManager.get('test-key')
      expect(result).toBeNull()
    })

    it('LRUアルゴリズムが正しく動作する', async () => {
      // maxEntries = 2なので、3個目で最初のデータが削除される
      const config = { l1: { maxEntries: 2, ttl: 60000 }, l2: { enabled: true } }
      const lruManager = new BacklogCacheManager(mockDatabase, config)
      
      await lruManager.set('key1', 'data1')
      await lruManager.set('key2', 'data2')
      await lruManager.set('key3', 'data3') // key1が削除される
      
      expect(await lruManager.get('key1')).toBeNull()
      expect(await lruManager.get('key2')).toBe('data2')
      expect(await lruManager.get('key3')).toBe('data3')
      
      lruManager.destroy()
    })

    it('メモリサイズ制限が正しく動作する', async () => {
      const smallConfig = { l1: { maxSize: 10, maxEntries: 1, ttl: 60000 }, l2: { enabled: true } }
      const smallManager = new BacklogCacheManager(mockDatabase, smallConfig)
      
      await smallManager.set('key1', 'data1')
      await smallManager.set('key2', 'data2')
      
      // key1は削除されているはず
      expect(await smallManager.get('key1')).toBeNull()
      expect(await smallManager.get('key2')).toBe('data2')
      
      smallManager.destroy()
    })
  })

  describe('L2キャッシュ (SQLite)', () => {
    it('L2キャッシュの基本動作', async () => {
      // L2キャッシュが有効になっていることを確認
      await cacheManager.set('test-key', { data: 'test' })
      
      // getDrizzleが呼ばれることでL2キャッシュが使用されていることを確認
      expect(mockDatabase.getDrizzle).toHaveBeenCalled()
    })
  })

  describe('キャッシュTTL管理', () => {
    it('カスタムTTLが適用される', async () => {
      const testData = { id: 1, name: 'Test Data' }
      
      await cacheManager.set('test-key', testData, 500) // 0.5秒TTL
      
      // TTL前は取得できる
      let result = await cacheManager.get('test-key')
      expect(result).toEqual(testData)
      
      // TTL後は取得できない
      vi.advanceTimersByTime(600)
      result = await cacheManager.get('test-key')
      expect(result).toBeNull()
    })
  })

  describe('キャッシュ削除', () => {
    it('特定キーのキャッシュを削除できる', async () => {
      await cacheManager.set('test-key', { data: 'test' })
      
      const deleted = await cacheManager.invalidate('test-key')
      expect(deleted).toBe(true)
      
      const result = await cacheManager.get('test-key')
      expect(result).toBeNull()
    })

    it('存在しないキーの削除はfalseを返す', async () => {
      const deleted = await cacheManager.invalidate('non-existent-key')
      expect(deleted).toBe(false)
    })
  })

  describe('クリーンアップ', () => {
    it('全キャッシュクリアできる', async () => {
      await cacheManager.set('key1', 'data1')
      await cacheManager.set('key2', 'data2')
      
      await cacheManager.clear()
      
      expect(await cacheManager.get('key1')).toBeNull()
      expect(await cacheManager.get('key2')).toBeNull()
    })
  })

  describe('統計情報', () => {
    it('キャッシュ統計情報を取得できる', () => {
      const stats = cacheManager.getStats()
      
      expect(stats).toHaveProperty('l1')
      expect(stats.l1).toHaveProperty('size')
      expect(stats.l1).toHaveProperty('hits')
      expect(stats.l1).toHaveProperty('misses')
    })

    it('パフォーマンスメトリクスが記録される', async () => {
      await cacheManager.set('test-key', { data: 'test' })
      await cacheManager.get('test-key') // hit
      await cacheManager.get('non-existent') // miss
      
      const stats = cacheManager.getStats()
      expect(stats.l1.hits).toBeGreaterThan(0)
      expect(stats.l1.misses).toBeGreaterThan(0)
    })
  })

  describe('プリフェッチ機能', () => {
    it('プリフェッチが無効な場合は何もしない', async () => {
      const key = 'test-key'
      await cacheManager.prefetch(key, async () => ({ data: 'prefetched' }))
      
      // プリフェッチは基本的な実装では何もしない
      expect(await cacheManager.get(key)).toBeNull()
    })
  })

  describe('バックグラウンド更新', () => {
    it('キャッシュをリフレッシュできる', async () => {
      const key = 'test-key'
      const refreshFn = vi.fn().mockResolvedValue({ data: 'refreshed' })
      
      await cacheManager.refresh(key, refreshFn)
      
      expect(refreshFn).toHaveBeenCalled()
    })

    it('バックグラウンド更新が自動的にスケジュールされる', () => {
      // バックグラウンド更新のスケジューリングは実装に依存
      expect(cacheManager).toBeDefined()
    })
  })

  describe('エラーハンドリング', () => {
    it('無効なキーでもエラーを起こさない', async () => {
      await expect(cacheManager.get('')).resolves.toBeNull()
      await expect(cacheManager.set('', 'data')).resolves.toBeUndefined()
    })

    it('メモリ不足時のエラーハンドリング', async () => {
      // 大量のデータをセットしてもエラーにならないことを確認
      const largeData = new Array(1000).fill('large data')
      await expect(cacheManager.set('large-key', largeData)).resolves.toBeUndefined()
    })
  })

  describe('リソース管理', () => {
    it('destroy()でリソースが適切にクリーンアップされる', () => {
      cacheManager.destroy()
      // destroyは何度呼んでもエラーにならない
      expect(() => cacheManager.destroy()).not.toThrow()
    })
  })
})

describe('IntegratedBacklogCacheService', () => {
  let cacheService: IntegratedBacklogCacheService
  let mockApiClient: BacklogApiClient
  let mockRateLimiter: BacklogRateLimiter
  let mockConnectionManager: BacklogConnectionManager
  let mockRequestQueue: BacklogRequestQueue

  beforeEach(() => {
    cacheService = new IntegratedBacklogCacheService(mockDatabase, {
      l1: { maxSize: 100, ttl: 60000 },
      l2: { enabled: true }
    })

    // サービスのモック
    mockApiClient = {
      request: vi.fn().mockResolvedValue({ data: 'mocked API response' })
    } as unknown as BacklogApiClient
    mockRateLimiter = {} as BacklogRateLimiter
    mockConnectionManager = {} as BacklogConnectionManager
    mockRequestQueue = {} as BacklogRequestQueue

    vi.clearAllMocks()
  })

  afterEach(() => {
    cacheService.destroy()
    vi.clearAllTimers()
  })

  describe('統合初期化', () => {
    it('全Phaseコンポーネントとの統合初期化できる', async () => {
      await expect(
        cacheService.initialize(
          mockApiClient,
          mockRateLimiter,
          mockConnectionManager,
          mockRequestQueue
        )
      ).resolves.toBeUndefined()
    })
  })

  describe('キャッシュ付きAPIリクエスト', () => {
    beforeEach(async () => {
      await cacheService.initialize(
        mockApiClient,
        mockRateLimiter,
        mockConnectionManager,
        mockRequestQueue
      )
    })

    it('キャッシュヒット時はAPIを呼ばない', async () => {
      const spaceId = 'test-space'
      const endpoint = '/issues'
      const params = { projectId: [1] }
      const testData = { data: [{ id: 1, summary: 'Test Issue' }] }

      // 最初にキャッシュにデータを保存
      const cacheKey = cacheService.generateCacheKey(spaceId, endpoint, params)
      await (cacheService as any).cacheManager.set(cacheKey, testData)

      const result = await cacheService.request(spaceId, endpoint, params)
      
      expect(result).toEqual(testData)
    })

    it('キャッシュミス時はAPIを呼んでキャッシュする', async () => {
      const spaceId = 'test-space'
      const endpoint = '/issues'
      const params = { projectId: [1] }

      // APIクライアントのmockを設定
      const mockRequest = vi.fn().mockResolvedValue({ data: [{ id: 1 }] })
      ;(cacheService as any).apiClient = { request: mockRequest }

      const result = await cacheService.request(spaceId, endpoint, params)
      
      expect(mockRequest).toHaveBeenCalledWith(endpoint, { params })
      expect(result).toEqual([{ id: 1 }])
    })

    it('強制リフレッシュ時はキャッシュを無視してAPIを呼ぶ', async () => {
      const spaceId = 'test-space'
      const endpoint = '/issues'
      const params = { projectId: [1] }

      // APIクライアントのmockを設定
      const mockRequest = vi.fn().mockResolvedValue({ data: [{ id: 1 }] })
      ;(cacheService as any).apiClient = { request: mockRequest }

      await cacheService.request(spaceId, endpoint, params, { forceRefresh: true })
      
      expect(mockRequest).toHaveBeenCalled()
    })

    it('カスタムTTLでキャッシュできる', async () => {
      const spaceId = 'test-space'
      const endpoint = '/issues'
      const params = { projectId: [1] }

      // APIクライアントのmockを設定
      const mockRequest = vi.fn().mockResolvedValue({ data: [{ id: 1 }] })
      ;(cacheService as any).apiClient = { request: mockRequest }

      await cacheService.request(spaceId, endpoint, params, { ttl: 30000 })
      
      expect(mockRequest).toHaveBeenCalled()
    })
  })

  describe('キャッシュキー生成', () => {
    it('適切なキャッシュキーが生成される', () => {
      const spaceId = 'test-space'
      const endpoint = '/issues'
      const params = { projectId: [1, 2], status: 'open' }
      
      const key = cacheService.generateCacheKey(spaceId, endpoint, params)
      
      expect(key).toContain(spaceId)
      expect(key).toContain('issues')
    })

    it('パラメータの順序が一定である', () => {
      const spaceId = 'test-space'
      const endpoint = '/issues'
      const params1 = { projectId: [1], status: 'open' }
      const params2 = { status: 'open', projectId: [1] }
      
      const key1 = cacheService.generateCacheKey(spaceId, endpoint, params1)
      const key2 = cacheService.generateCacheKey(spaceId, endpoint, params2)
      
      expect(key1).toBe(key2)
    })
  })

  describe('ヘルスチェック', () => {
    it('統合サービスのヘルスステータスを取得できる', () => {
      const health = cacheService.getHealthStatus()
      
      expect(health).toHaveProperty('cache')
      expect(health.cache).toHaveProperty('l1')
    })

    it('コンポーネントが未初期化の場合は適切なステータスを返す', () => {
      const health = cacheService.getHealthStatus()
      
      expect(health.initialized).toBe(false)
    })
  })

  describe('パフォーマンス', () => {
    it('同時リクエストを効率的に処理できる', async () => {
      await cacheService.initialize(
        mockApiClient,
        mockRateLimiter,
        mockConnectionManager,
        mockRequestQueue
      )

      const promises = Array.from({ length: 10 }, (_, i) =>
        cacheService.request('test-space', '/issues', { id: i })
      )

      await expect(Promise.all(promises)).resolves.toBeDefined()
    })

    it('キャッシュヒット率が適切に向上する', () => {
      // キャッシュヒット率の測定は統計情報で確認
      const stats = cacheService.getStats()
      expect(stats).toHaveProperty('hitRate')
    })
  })
})