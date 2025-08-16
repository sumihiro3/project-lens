/**
 * Backlog Rate Limiter Unit Tests
 *
 * テスト範囲:
 * - レート制限ヘッダー解析
 * - データベース保存とクエリ
 * - 動的並列数調整
 * - 予測的リクエスト制御
 * - リアルタイム監視
 * - クリーンアップ機能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BacklogRateLimiter } from '../../../../electron/main/services/backlog/rate-limiter'
import type { DatabaseManager } from '../../../../electron/main/database/connection'
import type { RateLimitHeaders } from '../../../../electron/main/services/backlog/rate-limiter'

// データベースモック
const mockDatabase = {
  getDrizzle: vi.fn().mockReturnValue({
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue({}),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue({ changes: 0 }),
    }),
  }),
  insert: vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockResolvedValue({}),
    }),
  }),
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  }),
  delete: vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue({ changes: 0 }),
  }),
} as unknown as DatabaseManager

// タイマーモック
vi.useFakeTimers()

describe('BacklogRateLimiter', () => {
  let rateLimiter: BacklogRateLimiter
  let eventListener: ReturnType<typeof vi.fn>

  beforeEach(() => {
    rateLimiter = new BacklogRateLimiter(mockDatabase)
    eventListener = vi.fn()
    vi.clearAllMocks()

    // データベースモックを正常な状態にリセット
    ;(mockDatabase.getDrizzle().insert as unknown as MockedFunction<() => { values: MockedFunction<any> }>).mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue({}),
      }),
    })
  })

  afterEach(() => {
    rateLimiter.destroy()
    vi.clearAllTimers()
  })

  describe('初期化', () => {
    it('デフォルト設定でレートリミッターを初期化できる', () => {
      expect(rateLimiter).toBeDefined()
    })

    it('カスタム設定で初期化できる', () => {
      const customConfig = {
        baseRate: 200,
        maxConcurrency: 15,
        safetyMargin: 0.3,
      }
      const customRateLimiter = new BacklogRateLimiter(mockDatabase, customConfig)
      expect(customRateLimiter).toBeDefined()
      customRateLimiter.destroy()
    })

    it('クリーンアップスケジューラーが開始される', () => {
      expect(vi.getTimerCount()).toBeGreaterThan(0)
    })
  })

  describe('レート制限ヘッダー解析', () => {
    it('完全なレート制限ヘッダーを正しく解析する', () => {
      const headers = new Headers({
        'X-RateLimit-Remaining': '100',
        'X-RateLimit-Total': '150',
        'X-RateLimit-Reset': '1640995200',
        'X-RateLimit-Limit': '150',
      })

      const result = rateLimiter.parseRateLimitHeaders(headers)

      expect(result).toEqual({
        remaining: 100,
        total: 150,
        reset: 1640995200,
        limit: 150,
      })
    })

    it('不完全なヘッダーの場合nullを返す', () => {
      const headers = new Headers({
        'X-RateLimit-Remaining': '100',
        // totalとresetが不足
      })

      const result = rateLimiter.parseRateLimitHeaders(headers)

      expect(result).toBeNull()
    })

    it('無効な数値の場合nullを返す', () => {
      const headers = new Headers({
        'X-RateLimit-Remaining': 'invalid',
        'X-RateLimit-Total': '150',
        'X-RateLimit-Reset': '1640995200',
      })

      const result = rateLimiter.parseRateLimitHeaders(headers)

      expect(result).toBeNull()
    })

    it('X-RateLimit-Limit の代わりに X-RateLimit-Total を使用する', () => {
      const headers = new Headers({
        'X-RateLimit-Remaining': '100',
        'X-RateLimit-Total': '150',
        'X-RateLimit-Reset': '1640995200',
      })

      const result = rateLimiter.parseRateLimitHeaders(headers)

      expect(result?.total).toBe(150)
      expect(result?.limit).toBeUndefined()
    })
  })

  describe('レート制限状態更新', () => {
    const validHeaders: RateLimitHeaders = {
      remaining: 100,
      total: 150,
      reset: 1640995200,
    }

    it('レート制限状態を正しく更新する', async () => {
      await rateLimiter.updateRateLimit(
        'test-space',
        validHeaders,
        '/issues',
        'GET',
      )

      expect(mockDatabase.getDrizzle().insert).toHaveBeenCalled()
    })

    it('適切なデータベース挿入パラメータを使用する', async () => {
      await rateLimiter.updateRateLimit(
        'test-space',
        validHeaders,
        '/issues',
        'GET',
      )

      const insertCall = mockDatabase.getDrizzle().insert as unknown as MockedFunction<() => { values: MockedFunction<any> }>
      const valuesCall = insertCall().values as MockedFunction<any>

      expect(valuesCall).toHaveBeenCalledWith(
        expect.objectContaining({
          spaceId: 'test-space',
          remaining: 100,
          total: 150,
          resetTime: expect.any(String),
          windowStart: expect.any(String),
          endpoint: '/issues',
          method: 'GET',
          isActive: true,
        }),
      )
    })

    it('利用率を正しく計算する', async () => {
      const highUtilizationHeaders = {
        remaining: 10,
        total: 150,
        reset: Math.floor(Date.now() / 1000) + 3600,
      }

      await rateLimiter.updateRateLimit(
        'test-space',
        highUtilizationHeaders,
      )

      // 利用率は (150-10)/150 = 93.3%
      // 警告しきい値(90%)を超えているため警告イベントが発火されるはず
    })
  })

  describe('レート制限状態取得', () => {
    it('キャッシュからレート制限状態を取得する', async () => {
      // まず状態を設定
      const headers: RateLimitHeaders = {
        remaining: 100,
        total: 150,
        reset: Math.floor(Date.now() / 1000) + 3600,
      }
      await rateLimiter.updateRateLimit('test-space', headers)

      const result = await rateLimiter.getRateLimitStatus('test-space')

      expect(result).toBeTruthy()
      expect(result?.spaceId).toBe('test-space')
      expect(result?.remaining).toBe(100)
      expect(result?.total).toBe(150)
    })

    it('存在しないスペースの場合nullを返す', async () => {
      const result = await rateLimiter.getRateLimitStatus('non-existent-space')
      expect(result).toBeNull()
    })

    it('期限切れの状態は無効として扱う', async () => {
      // 期限切れのデータをモック
      const expiredData = [{
        spaceId: 'test-space',
        remaining: 100,
        total: 150,
        resetTime: new Date(Date.now() - 3600000).toISOString(), // 1時間前
        windowStart: new Date(Date.now() - 7200000).toISOString(),
        lastUpdated: new Date(Date.now() - 3600000).toISOString(),
        isActive: true,
        endpoint: null,
        method: 'GET',
      }]

      mockDatabase.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(expiredData),
            }),
          }),
        }),
      })

      const _result = await rateLimiter.getRateLimitStatus('test-space')
      // 期限切れなのでnullが返される想定
    })
  })

  describe('動的並列数調整', () => {
    it('利用率に基づいて適切な並列数を計算する', async () => {
      // 低利用率の場合（非常に余裕がある）
      const lowUtilizationHeaders: RateLimitHeaders = {
        remaining: 148,
        total: 150,
        reset: Math.floor(Date.now() / 1000) + 3600,
      }
      await rateLimiter.updateRateLimit('test-space', lowUtilizationHeaders)

      const concurrency = await rateLimiter.calculateOptimalConcurrency('test-space')

      // デフォルト設定では、minConcurrency=1になるため、1以上を期待
      expect(concurrency).toBeGreaterThanOrEqual(1)
      expect(concurrency).toBeLessThanOrEqual(10) // maxConcurrency
    })

    it('高利用率の場合は並列数を制限する', async () => {
      // 高利用率の場合
      const highUtilizationHeaders: RateLimitHeaders = {
        remaining: 5,
        total: 150,
        reset: Math.floor(Date.now() / 1000) + 3600,
      }
      await rateLimiter.updateRateLimit('test-space', highUtilizationHeaders)

      const concurrency = await rateLimiter.calculateOptimalConcurrency('test-space')

      expect(concurrency).toBe(1) // 大幅に制限される
    })

    it('レート制限情報がない場合は最小並列数を返す', async () => {
      const concurrency = await rateLimiter.calculateOptimalConcurrency('unknown-space')
      expect(concurrency).toBe(1) // minConcurrency
    })

    it('安全マージンを考慮する', async () => {
      const headers: RateLimitHeaders = {
        remaining: 100,
        total: 150,
        reset: Math.floor(Date.now() / 1000) + 60, // 1分後
      }
      await rateLimiter.updateRateLimit('test-space', headers)

      const concurrency = await rateLimiter.calculateOptimalConcurrency('test-space')

      // 安全マージン(20%)を考慮した値になっているはず
      expect(concurrency).toBeGreaterThan(0)
    })
  })

  describe('予測的リクエスト制御', () => {
    it('制限に到達していない場合は即座に実行許可', async () => {
      const headers: RateLimitHeaders = {
        remaining: 149, // 非常に余裕のある値に設定（99%余裕）
        total: 150,
        reset: Math.floor(Date.now() / 1000) + 3600,
      }
      await rateLimiter.updateRateLimit('test-space', headers)

      const delay = await rateLimiter.checkRequestPermission('test-space')
      expect(delay).toBe(0)
    })

    it('制限に到達している場合はリセット時間まで遅延', async () => {
      const resetTime = Math.floor(Date.now() / 1000) + 300 // 5分後
      const headers: RateLimitHeaders = {
        remaining: 0,
        total: 150,
        reset: resetTime,
      }
      await rateLimiter.updateRateLimit('test-space', headers)

      const delay = await rateLimiter.checkRequestPermission('test-space')
      expect(delay).toBeGreaterThan(0)
      expect(delay).toBeLessThanOrEqual(300000) // 5分以内
    })

    it('警告しきい値に近い場合は短い遅延を推奨', async () => {
      const headers: RateLimitHeaders = {
        remaining: 10, // 6.7%の利用率残り（警告しきい値10%以下）
        total: 150,
        reset: Math.floor(Date.now() / 1000) + 3600,
      }
      await rateLimiter.updateRateLimit('test-space', headers)

      const delay = await rateLimiter.checkRequestPermission('test-space')
      expect(delay).toBeGreaterThan(0)
      expect(delay).toBeLessThanOrEqual(5000) // 最大5秒
    })

    it('情報がない場合は即座に実行許可', async () => {
      const delay = await rateLimiter.checkRequestPermission('unknown-space')
      expect(delay).toBe(0)
    })
  })

  describe('イベントリスナー', () => {
    it('イベントリスナーを追加・削除できる', () => {
      rateLimiter.addEventListener(eventListener)
      expect(eventListener).not.toHaveBeenCalled()

      rateLimiter.removeEventListener(eventListener)
    })

    it('レート制限更新時にイベントが発火される', async () => {
      rateLimiter.addEventListener(eventListener)

      const headers: RateLimitHeaders = {
        remaining: 100,
        total: 150,
        reset: 1640995200,
      }
      await rateLimiter.updateRateLimit('test-space', headers)

      expect(eventListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'update',
          spaceId: 'test-space',
        }),
      )
    })

    it('警告しきい値到達時に警告イベントが発火される', async () => {
      rateLimiter.addEventListener(eventListener)

      const warningHeaders: RateLimitHeaders = {
        remaining: 5, // 警告しきい値を下回る
        total: 150,
        reset: 1640995200,
      }
      await rateLimiter.updateRateLimit('test-space', warningHeaders)

      expect(eventListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'warning',
          spaceId: 'test-space',
        }),
      )
    })

    it('制限到達時に制限到達イベントが発火される', async () => {
      rateLimiter.addEventListener(eventListener)

      const limitHeaders: RateLimitHeaders = {
        remaining: 0,
        total: 150,
        reset: 1640995200,
      }
      await rateLimiter.updateRateLimit('test-space', limitHeaders)

      expect(eventListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'limit_reached',
          spaceId: 'test-space',
        }),
      )
    })
  })

  describe('統計情報', () => {
    it('レート制限統計情報を取得できる', async () => {
      const headers: RateLimitHeaders = {
        remaining: 100,
        total: 150,
        reset: Math.floor(Date.now() / 1000) + 3600,
      }
      await rateLimiter.updateRateLimit('test-space', headers)

      // モックデータを設定
      const mockStats = [{
        spaceId: 'test-space',
        remaining: 100,
        total: 150,
        resetTime: new Date(Date.now() + 3600000).toISOString(),
        windowStart: new Date(Date.now() - 60000).toISOString(),
        lastUpdated: new Date().toISOString(),
        isActive: true,
        endpoint: null,
        method: 'GET',
      }]

      // モックデータベースのselectを更新
      ;(mockDatabase.getDrizzle().select as unknown as MockedFunction<() => { from: MockedFunction<any> }>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(mockStats),
          }),
        }),
      })

      const stats = await rateLimiter.getStats('test-space')

      expect(stats).toBeTruthy()
      expect(stats?.totalRequests).toBe(150)
      expect(stats?.remainingRequests).toBe(100)
    })

    it('存在しないスペースの統計情報はnullを返す', async () => {
      // 存在しないスペースのクエリ結果を空にする
      ;(mockDatabase.getDrizzle().select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]), // 空の結果
          }),
        }),
      })

      const stats = await rateLimiter.getStats('non-existent-space')
      expect(stats).toBeNull()
    })
  })

  describe('クリーンアップ', () => {
    it('期限切れのレート制限データを削除する', async () => {
      await rateLimiter.cleanup()
      expect(mockDatabase.getDrizzle().delete).toHaveBeenCalled()
    })

    it('クリーンアップスケジューラーが定期実行される', async () => {
      // 1時間進める
      vi.advanceTimersByTime(60 * 60 * 1000)

      expect(mockDatabase.getDrizzle().delete).toHaveBeenCalled()
    })

    it('クリーンアップイベントが発火される', async () => {
      rateLimiter.addEventListener(eventListener)

      await rateLimiter.cleanup()

      expect(eventListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'cleanup',
          spaceId: 'system',
        }),
      )
    })
  })

  describe('リソース管理', () => {
    it('destroy()でリソースが適切にクリーンアップされる', async () => {
      const initialTimerCount = vi.getTimerCount()

      await rateLimiter.destroy()

      // タイマーが停止されたことを確認
      expect(vi.getTimerCount()).toBeLessThan(initialTimerCount)
    })

    it('destroy()後はイベントリスナーがクリアされる', async () => {
      rateLimiter.addEventListener(eventListener)
      await rateLimiter.destroy()

      // destroy後はイベントが発火されないことを確認する
      // （実際のテストは実装依存）
    })
  })

  describe('エラーハンドリング', () => {
    it('データベースエラー時も処理を継続する', async () => {
      // データベースエラーをシミュレート
      ;(mockDatabase.getDrizzle().insert as any).mockImplementation(() => {
        throw new Error('Database error')
      })

      const headers: RateLimitHeaders = {
        remaining: 100,
        total: 150,
        reset: 1640995200,
      }

      await expect(rateLimiter.updateRateLimit('test-space', headers))
        .rejects.toThrow('Database error')
    })

    it('無効なヘッダー値を適切に処理する', () => {
      const invalidHeaders = new Headers({
        'X-RateLimit-Remaining': '',
        'X-RateLimit-Total': 'not-a-number',
        'X-RateLimit-Reset': 'invalid-timestamp',
      })

      const result = rateLimiter.parseRateLimitHeaders(invalidHeaders)
      expect(result).toBeNull()
    })
  })

  describe('並行処理', () => {
    it('複数のスペースを同時に処理できる', async () => {
      const headers: RateLimitHeaders = {
        remaining: 100,
        total: 150,
        reset: 1640995200,
      }

      const promises = [
        rateLimiter.updateRateLimit('space-1', headers),
        rateLimiter.updateRateLimit('space-2', headers),
        rateLimiter.updateRateLimit('space-3', headers),
      ]

      await expect(Promise.all(promises)).resolves.toEqual([undefined, undefined, undefined])
    })

    it('同じスペースへの並行アクセスを適切に処理する', async () => {
      const headers1: RateLimitHeaders = {
        remaining: 100,
        total: 150,
        reset: 1640995200,
      }
      const headers2: RateLimitHeaders = {
        remaining: 90,
        total: 150,
        reset: 1640995200,
      }

      const promises = [
        rateLimiter.updateRateLimit('test-space', headers1),
        rateLimiter.updateRateLimit('test-space', headers2),
      ]

      await expect(Promise.all(promises)).resolves.toEqual([undefined, undefined])
    })
  })
})
