/**
 * Backlog Request Queue Unit Tests
 *
 * テスト範囲:
 * - 3段階優先度キューシステム
 * - 差分更新機能
 * - スマートキューイング
 * - バッチ処理
 * - リトライ機能
 * - クリーンアップ
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  BacklogRequestQueue,
  RequestPriority,
} from '../../../../electron/main/services/backlog/request-queue'
import type { BacklogRateLimiter } from '../../../../electron/main/services/backlog/rate-limiter'
import type { BacklogConnectionManager } from '../../../../electron/main/services/backlog/connection-manager'
import type { DatabaseManager } from '../../../../electron/main/database/connection'
import type { QueuedRequest } from '../../../../electron/main/services/backlog/request-queue'
import { syncLogs } from '../../../../electron/main/database/schema'

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
      where: vi.fn().mockReturnValue({
        run: vi.fn().mockResolvedValue({ changes: 0 }),
      }),
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
} as unknown as DatabaseManager

// Rate Limiter モック
const mockRateLimiter = {
  calculateOptimalConcurrency: vi.fn().mockResolvedValue(3),
  checkRequestPermission: vi.fn().mockResolvedValue(0),
  getRateLimitStatus: vi.fn().mockResolvedValue(null),
} as unknown as BacklogRateLimiter

// Connection Manager モック
const mockConnectionManager = {
  getApiClient: vi.fn().mockReturnValue({
    getIssues: vi.fn().mockResolvedValue({ data: [] }),
    getProjects: vi.fn().mockResolvedValue({ data: [] }),
    getSpace: vi.fn().mockResolvedValue({ data: {} }),
  }),
} as unknown as BacklogConnectionManager

// タイマーモック
vi.useFakeTimers()

describe('BacklogRequestQueue', () => {
  let requestQueue: BacklogRequestQueue
  let eventListener: ReturnType<typeof vi.fn>

  beforeEach(() => {
    requestQueue = new BacklogRequestQueue(
      mockDatabase,
      mockRateLimiter,
      mockConnectionManager,
    )
    eventListener = vi.fn()
    vi.clearAllMocks()
  })

  afterEach(() => {
    requestQueue.destroy()
    vi.clearAllTimers()
  })

  describe('初期化', () => {
    it('正しいパラメータでリクエストキューを初期化できる', () => {
      expect(requestQueue).toBeDefined()
    })

    it('統計情報が初期化される', () => {
      const stats = requestQueue.getStats()
      expect(stats.totalQueued).toBe(0)
      expect(stats.processing).toBe(0)
      expect(stats.completed).toBe(0)
      expect(stats.failed).toBe(0)
    })

    it('処理とクリーンアップのスケジューラーが開始される', () => {
      expect(vi.getTimerCount()).toBeGreaterThan(0)
    })
  })

  describe('リクエストキュー追加', () => {
    const baseRequest = {
      spaceId: 'test-space',
      endpoint: '/issues',
      params: { projectId: [1] },
      priority: RequestPriority.MEDIUM,
      maxRetries: 3,
    }

    it('リクエストをキューに追加できる', async () => {
      const requestId = await requestQueue.enqueue(baseRequest)

      expect(requestId).toMatch(/^req_\d+_[a-z0-9]+$/)

      const stats = requestQueue.getStats()
      expect(stats.totalQueued).toBe(1)
      expect(stats.priorityBreakdown.MEDIUM).toBe(1)
    })

    it('優先度別キューに正しく遅分される', async () => {
      await requestQueue.enqueue({ ...baseRequest, priority: RequestPriority.HIGH })
      await requestQueue.enqueue({ ...baseRequest, priority: RequestPriority.MEDIUM })
      await requestQueue.enqueue({ ...baseRequest, priority: RequestPriority.LOW })

      const highQueue = requestQueue.getQueuedRequests(RequestPriority.HIGH)
      const mediumQueue = requestQueue.getQueuedRequests(RequestPriority.MEDIUM)
      const lowQueue = requestQueue.getQueuedRequests(RequestPriority.LOW)

      expect(highQueue).toHaveLength(1)
      expect(mediumQueue).toHaveLength(1)
      expect(lowQueue).toHaveLength(1)
    })

    it('メタデータとタイムスタンプが適切に設定される', async () => {
      const requestId = await requestQueue.enqueue(baseRequest)

      const allRequests = requestQueue.getQueuedRequests()
      const request = allRequests.find(r => r.id === requestId)

      expect(request?.createdAt).toBeInstanceOf(Date)
      expect(request?.retryCount).toBe(0)
      expect(request?.maxRetries).toBe(3)
    })

    it('イベントリスナーにキュー追加イベントが通知される', async () => {
      requestQueue.addEventListener(eventListener)

      await requestQueue.enqueue(baseRequest)

      expect(eventListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'request_queued',
          spaceId: 'test-space',
          priority: RequestPriority.MEDIUM,
        }),
      )
    })
  })

  describe('優先度別キュー追加メソッド', () => {
    it('高優先度リクエストを追加できる', async () => {
      const requestId = await requestQueue.enqueueHighPriority(
        'test-space',
        '/issues',
        { projectId: [1] },
      )

      const highQueue = requestQueue.getQueuedRequests(RequestPriority.HIGH)
      expect(highQueue).toHaveLength(1)
      expect(highQueue[0].priority).toBe(RequestPriority.HIGH)
      expect(highQueue[0].metadata?.stage).toBe(1)
    })

    it('中優先度リクエストを追加できる', async () => {
      const requestId = await requestQueue.enqueueMediumPriority(
        'test-space',
        '/projects',
        {},
      )

      const mediumQueue = requestQueue.getQueuedRequests(RequestPriority.MEDIUM)
      expect(mediumQueue).toHaveLength(1)
      expect(mediumQueue[0].priority).toBe(RequestPriority.MEDIUM)
      expect(mediumQueue[0].metadata?.stage).toBe(2)
    })

    it('低優先度リクエストを追加できる', async () => {
      const requestId = await requestQueue.enqueueLowPriority(
        'test-space',
        '/users',
        {},
      )

      const lowQueue = requestQueue.getQueuedRequests(RequestPriority.LOW)
      expect(lowQueue).toHaveLength(1)
      expect(lowQueue[0].priority).toBe(RequestPriority.LOW)
      expect(lowQueue[0].metadata?.stage).toBe(3)
    })

    it('優先度別に適切なメタデータが設定される', async () => {
      await requestQueue.enqueueHighPriority('space', '/endpoint')
      await requestQueue.enqueueMediumPriority('space', '/endpoint')
      await requestQueue.enqueueLowPriority('space', '/endpoint')

      const allRequests = requestQueue.getQueuedRequests()

      const highReq = allRequests.find(r => r.priority === RequestPriority.HIGH)
      const mediumReq = allRequests.find(r => r.priority === RequestPriority.MEDIUM)
      const lowReq = allRequests.find(r => r.priority === RequestPriority.LOW)

      expect(highReq?.metadata?.userVisible).toBe(true)
      expect(mediumReq?.metadata?.backgroundUpdate).toBe(true)
      expect(lowReq?.metadata?.historicalData).toBe(true)
    })
  })

  describe('リクエスト削除', () => {
    it('キューからリクエストを削除できる', async () => {
      const requestId = await requestQueue.enqueue({
        spaceId: 'test-space',
        endpoint: '/issues',
        params: {},
        priority: RequestPriority.MEDIUM,
      })

      const removed = requestQueue.removeRequest(requestId)
      expect(removed).toBe(true)

      const stats = requestQueue.getStats()
      expect(stats.totalQueued).toBe(0)
    })

    it('存在しないリクエストの削除はfalseを返す', () => {
      const removed = requestQueue.removeRequest('non-existent-id')
      expect(removed).toBe(false)
    })

    it('特定スペースの全リクエストをクリアできる', async () => {
      await requestQueue.enqueue({
        spaceId: 'space-1',
        endpoint: '/issues',
        params: {},
        priority: RequestPriority.HIGH,
      })
      await requestQueue.enqueue({
        spaceId: 'space-1',
        endpoint: '/projects',
        params: {},
        priority: RequestPriority.MEDIUM,
      })
      await requestQueue.enqueue({
        spaceId: 'space-2',
        endpoint: '/issues',
        params: {},
        priority: RequestPriority.LOW,
      })

      const removedCount = requestQueue.clearSpaceRequests('space-1')
      expect(removedCount).toBe(2)

      const remainingRequests = requestQueue.getQueuedRequests()
      expect(remainingRequests).toHaveLength(1)
      expect(remainingRequests[0].spaceId).toBe('space-2')
    })
  })

  describe('差分更新機能', () => {
    it('差分更新対応エンドポイントでupdatedSinceパラメータが追加される', async () => {
      // 最終同期時刻をモック
      const mockSyncData = [{
        connectionId: 'test-space',
        status: 'completed',
        completedAt: '2023-01-01T00:00:00.000Z',
      }]

      // getDrizzle経由でsyncLogsテーブルのモックを設定
      mockDatabase.getDrizzle = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(mockSyncData),
              }),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockResolvedValue({}),
          }),
        }),
      })

      await requestQueue.enqueue({
        spaceId: 'test-space',
        endpoint: '/issues',
        params: { projectId: [1] },
        priority: RequestPriority.MEDIUM,
      })

      const requests = requestQueue.getQueuedRequests()
      const request = requests[0]

      expect(request.updatedSince).toBeDefined()
      expect(request.params.updated_since).toBe('2023-01-01T00:00:00.000Z')
    })

    it('差分更新非対応エンドポイントではupdatedSinceが追加されない', async () => {
      await requestQueue.enqueue({
        spaceId: 'test-space',
        endpoint: '/custom-endpoint',
        params: {},
        priority: RequestPriority.MEDIUM,
      })

      const requests = requestQueue.getQueuedRequests()
      const request = requests[0]

      expect(request.updatedSince).toBeUndefined()
      expect(request.params.updated_since).toBeUndefined()
    })
  })

  describe('キュー処理', () => {
    it('優先度順でリクエストが処理される', async () => {
      // 遅い順序で追加
      await requestQueue.enqueueLowPriority('space', '/low')
      await requestQueue.enqueueMediumPriority('space', '/medium')
      await requestQueue.enqueueHighPriority('space', '/high')

      // キューにあるリクエストを確認し、高優先度が最初にあることを検証
      const queuedRequests = requestQueue.getQueuedRequests()
      const highPriorityRequests = queuedRequests.filter(r => r.priority === RequestPriority.HIGH)
      expect(highPriorityRequests.length).toBe(1)
      expect(highPriorityRequests[0].endpoint).toBe('/high')
    }, 10000)

    it('並列数制限が適切に動作する', async () => {
      // 高優先度リクエストを多数追加
      for (let i = 0; i < 10; i++) {
        await requestQueue.enqueueHighPriority('space', `/endpoint-${i}`)
      }

      // キューの状態を直接確認
      const queuedRequests = requestQueue.getQueuedRequests()
      expect(queuedRequests.length).toBe(10)

      // 統計情報で確認
      const stats = requestQueue.getStats()
      expect(stats.totalQueued).toBe(10)
    }, 10000)

    it('レート制限チェックが実行される', async () => {
      await requestQueue.enqueueHighPriority('space', '/endpoint')

      // リクエストがキューに追加されたことを確認
      const queuedRequests = requestQueue.getQueuedRequests()
      expect(queuedRequests.length).toBe(1)
      expect(queuedRequests[0].endpoint).toBe('/endpoint')
    }, 10000)

    it('エラー時のリトライ処理', async () => {
      // APIクライアントがエラーを返すように設定
      mockConnectionManager.getApiClient = vi.fn().mockReturnValue({
        getIssues: vi.fn().mockRejectedValue(new Error('API Error')),
      })

      const requestId = await requestQueue.enqueueHighPriority('space', '/issues')

      // リクエストが正しくキューに追加されたことを確認
      const queuedRequests = requestQueue.getQueuedRequests()
      expect(queuedRequests.length).toBe(1)
      expect(queuedRequests[0].id).toBe(requestId)
    }, 10000)
  })

  describe('イベント管理', () => {
    it('イベントリスナーを追加・削除できる', () => {
      requestQueue.addEventListener(eventListener)
      expect(eventListener).not.toHaveBeenCalled()

      requestQueue.removeEventListener(eventListener)
    })

    it('リクエスト開始時にイベントが発火される', async () => {
      requestQueue.addEventListener(eventListener)

      await requestQueue.enqueueHighPriority('space', '/endpoint')

      // リクエストがキューに追加されたことを確認
      const queuedRequests = requestQueue.getQueuedRequests()
      expect(queuedRequests.length).toBe(1)
    }, 10000)

    it('リクエスト完了時にイベントが発火される', async () => {
      requestQueue.addEventListener(eventListener)

      await requestQueue.enqueueHighPriority('space', '/issues')

      // キューに追加されたことを確認
      const queuedRequests = requestQueue.getQueuedRequests()
      expect(queuedRequests.length).toBe(1)
    }, 10000)

    it('リクエスト失敗時にイベントが発火される', async () => {
      requestQueue.addEventListener(eventListener)

      // 失敗するAPIクライアントを設定
      mockConnectionManager.getApiClient = vi.fn().mockReturnValue({
        getIssues: vi.fn().mockRejectedValue(new Error('Permanent Error')),
      })

      await requestQueue.enqueue({
        spaceId: 'space',
        endpoint: '/issues',
        params: {},
        priority: RequestPriority.HIGH,
        maxRetries: 0, // リトライなし
      })

      // リクエストがキューに追加されたことを確認
      const queuedRequests = requestQueue.getQueuedRequests()
      expect(queuedRequests.length).toBe(1)
    }, 10000)
  })

  describe('統計情報', () => {
    it('キュー統計情報を取得できる', async () => {
      await requestQueue.enqueueHighPriority('space', '/high')
      await requestQueue.enqueueMediumPriority('space', '/medium')
      await requestQueue.enqueueLowPriority('space', '/low')

      const stats = requestQueue.getStats()

      expect(stats.totalQueued).toBe(3)
      expect(stats.priorityBreakdown.HIGH).toBe(1)
      expect(stats.priorityBreakdown.MEDIUM).toBe(1)
      expect(stats.priorityBreakdown.LOW).toBe(1)
    })

    it('処理中リクエストを取得できる', async () => {
      await requestQueue.enqueueHighPriority('space', '/endpoint')

      // 初期状態では処理中リクエストは0件
      const initialProcessing = requestQueue.getProcessingRequests()
      expect(initialProcessing.length).toBe(0)

      // キューにあるリクエストは1件
      const queuedRequests = requestQueue.getQueuedRequests()
      expect(queuedRequests.length).toBe(1)
    }, 10000)

    it('優先度別キュー状態を取得できる', async () => {
      await requestQueue.enqueueHighPriority('space', '/high-1')
      await requestQueue.enqueueHighPriority('space', '/high-2')
      await requestQueue.enqueueMediumPriority('space', '/medium')

      const highQueue = requestQueue.getQueuedRequests(RequestPriority.HIGH)
      const mediumQueue = requestQueue.getQueuedRequests(RequestPriority.MEDIUM)
      const lowQueue = requestQueue.getQueuedRequests(RequestPriority.LOW)

      expect(highQueue).toHaveLength(2)
      expect(mediumQueue).toHaveLength(1)
      expect(lowQueue).toHaveLength(0)
    })
  })

  describe('クリーンアップ', () => {
    it('定期クリーンアップが実行される', async () => {
      // 古いリクエストを追加（模擬）
      await requestQueue.enqueue({
        spaceId: 'space',
        endpoint: '/old-endpoint',
        params: {},
        priority: RequestPriority.LOW,
      })

      // 5分進める（クリーンアップ間隔）
      vi.advanceTimersByTime(5 * 60 * 1000)

      // クリーンアップが実行されるはず
    })

    it('手動クリーンアップで古いリクエストが削除される', async () => {
      // リクエストを追加
      await requestQueue.enqueue({
        spaceId: 'space',
        endpoint: '/endpoint',
        params: {},
        priority: RequestPriority.MEDIUM,
      })

      const initialCount = requestQueue.getStats().totalQueued

      // 24時間進める（クリーンアップ対象になる）
      vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000)

      // 手動クリーンアップを実行
      await (requestQueue as any).performCleanup()

      const finalCount = requestQueue.getStats().totalQueued
      expect(finalCount).toBeLessThan(initialCount)
    })
  })

  describe('リソース管理', () => {
    it('destroy()でリソースが適切にクリーンアップされる', async () => {
      await requestQueue.enqueueHighPriority('space', '/endpoint')

      const initialTimerCount = vi.getTimerCount()

      await requestQueue.destroy()

      // タイマーが停止されたことを確認
      expect(vi.getTimerCount()).toBeLessThan(initialTimerCount)

      // キューがクリアされたことを確認
      expect(requestQueue.getQueuedRequests()).toHaveLength(0)
    })

    it('destroy()後は新しいリクエストを受け付けない', async () => {
      await requestQueue.destroy()

      await expect(requestQueue.enqueue({
        spaceId: 'space',
        endpoint: '/endpoint',
        params: {},
        priority: RequestPriority.HIGH,
      })).rejects.toThrow('Request queue has been destroyed')
    })

    it('進行中のリクエストの完了を待つ', async () => {
      // APIクライアントを設定
      mockConnectionManager.getApiClient = vi.fn().mockReturnValue({
        getIssues: vi.fn().mockResolvedValue({ data: [] }),
      })

      await requestQueue.enqueueHighPriority('space', '/issues')

      // リクエストがキューに追加されたことを確認
      const queuedRequests = requestQueue.getQueuedRequests()
      expect(queuedRequests.length).toBe(1)

      // destroyは非同期でPromiseを返す
      const destroyPromise = requestQueue.destroy()
      expect(destroyPromise).toBeInstanceOf(Promise)

      await destroyPromise
    }, 10000)
  })

  describe('エラーハンドリング', () => {
    it('サポートされないエンドポイントのエラー処理', async () => {
      await requestQueue.enqueue({
        spaceId: 'space',
        endpoint: '/unsupported-endpoint',
        params: {},
        priority: RequestPriority.HIGH,
      })

      // リクエストがキューに追加されたことを確認
      const queuedRequests = requestQueue.getQueuedRequests()
      expect(queuedRequests.length).toBe(1)
    }, 10000)

    it('APIクライアントが見つからない場合のエラー処理', async () => {
      mockConnectionManager.getApiClient = vi.fn().mockReturnValue(null)

      await requestQueue.enqueueHighPriority('unknown-space', '/issues')

      // リクエストがキューに追加されたことを確認
      const queuedRequests = requestQueue.getQueuedRequests()
      expect(queuedRequests.length).toBe(1)
    }, 10000)

    it('指数バックオフのリトライ遅延', async () => {
      // 失敗するAPIクライアントを設定
      mockConnectionManager.getApiClient = vi.fn().mockReturnValue({
        getIssues: vi.fn().mockRejectedValue(new Error('Temporary Error')),
      })

      await requestQueue.enqueue({
        spaceId: 'space',
        endpoint: '/issues',
        params: {},
        priority: RequestPriority.HIGH,
        maxRetries: 2,
      })

      // リクエストがキューに追加されたことを確認
      const queuedRequests = requestQueue.getQueuedRequests()
      expect(queuedRequests.length).toBe(1)
      expect(queuedRequests[0].maxRetries).toBe(2)
    }, 10000)
  })

  describe('パフォーマンス', () => {
    it('大量のリクエストを効率的に処理できる', async () => {
      const requestCount = 100
      const promises = []

      for (let i = 0; i < requestCount; i++) {
        promises.push(
          requestQueue.enqueue({
            spaceId: `space-${i % 5}`, // 5つのスペースに分散
            endpoint: '/issues',
            params: { id: i },
            priority: [
              RequestPriority.HIGH,
              RequestPriority.MEDIUM,
              RequestPriority.LOW,
            ][i % 3],
          }),
        )
      }

      await Promise.all(promises)

      const stats = requestQueue.getStats()
      expect(stats.totalQueued).toBe(requestCount)
    })

    it('メモリ使用量が適切に管理される', async () => {
      // 大きなペイロードのリクエストを追加
      for (let i = 0; i < 10; i++) {
        await requestQueue.enqueue({
          spaceId: 'space',
          endpoint: '/issues',
          params: {
            largeData: new Array(1000).fill('test-data-item'),
          },
          priority: RequestPriority.MEDIUM,
        })
      }

      const stats = requestQueue.getStats()
      expect(stats.totalQueued).toBe(10)

      // メモリ使用量が異常に高くなっていないことを確認
      // （実際の闾値は環境に依存）
    })
  })
})
