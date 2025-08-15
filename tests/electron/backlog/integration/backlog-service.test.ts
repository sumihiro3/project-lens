/**
 * Backlog Service Integration Tests
 * 
 * テスト範囲:
 * - 基本的な統合動作テスト
 * - 必要最小限のコンポーネント連携
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BacklogApiClient } from '../../../../electron/main/services/backlog/api-client'
import { BacklogRateLimiter } from '../../../../electron/main/services/backlog/rate-limiter'
import { BacklogConnectionManager } from '../../../../electron/main/services/backlog/connection-manager'
import { BacklogRequestQueue } from '../../../../electron/main/services/backlog/request-queue'
import { BacklogErrorHandler } from '../../../../electron/main/services/backlog/error-handler'
import { IntegratedBacklogCacheService } from '../../../../electron/main/services/backlog/cache-manager'
import type { DatabaseManager } from '../../../../electron/main/database/connection'

// Mock fetch API for integration tests
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock Electron safeStorage
vi.mock('electron', () => ({ 
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn().mockImplementation((str: string) => Buffer.from(`encrypted_${str}`)),
    decryptString: vi.fn().mockImplementation((buffer: Buffer) => 
      buffer.toString().replace('encrypted_', ''))
  }
}))

// Mock database
const mockDatabase = {
  insert: vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockResolvedValue({})
    })
  }),
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([])
        })
      })
    })
  }),
  delete: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      run: vi.fn().mockResolvedValue({ changes: 0 })
    })
  }),
  getDrizzle: vi.fn().mockReturnValue({
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue({})
      })
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      })
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        run: vi.fn().mockResolvedValue({ changes: 0 })
      })
    })
  })
} as unknown as DatabaseManager

vi.useFakeTimers()

describe('Backlog Service Integration Tests', () => {
  let apiClient: BacklogApiClient
  let rateLimiter: BacklogRateLimiter
  let connectionManager: BacklogConnectionManager
  let requestQueue: BacklogRequestQueue
  let errorHandler: BacklogErrorHandler
  let cacheService: IntegratedBacklogCacheService

  beforeEach(async () => {
    vi.clearAllMocks()
    mockFetch.mockClear()

    // Initialize services
    apiClient = new BacklogApiClient({
      spaceId: 'test-space',
      apiKey: 'test-api-key',
      host: 'test.backlog.jp'
    })

    rateLimiter = new BacklogRateLimiter(mockDatabase)
    connectionManager = new BacklogConnectionManager(mockDatabase, rateLimiter)
    requestQueue = new BacklogRequestQueue(mockDatabase, rateLimiter, connectionManager)
    errorHandler = new BacklogErrorHandler()
    cacheService = new IntegratedBacklogCacheService({
      l1: { maxSize: 100, ttl: 60000 },
      l2: { enabled: true }
    })

    // Setup basic space configuration
    await connectionManager.addSpaceConfig({
      spaceId: 'test-space',
      name: 'Test Space',
      apiKey: 'test-api-key-12345',
      isActive: true,
      priority: 1
    })
  })

  afterEach(async () => {
    await apiClient.destroy()
    await requestQueue.destroy()
    await cacheService.destroy()
    vi.clearAllTimers()
  })

  describe('Basic Integration', () => {
    it('Basic API client integration', async () => {
      // Mock successful API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/json'
        }),
        json: vi.fn().mockResolvedValue({
          id: 1,
          name: 'Test Space'
        })
      })

      const result = await apiClient.getSpace()
      
      expect(result.success).toBe(true)
      expect(result.data).toBeDefined()
      expect(result.data.id).toBe(1)
    })

    it('Basic error handling integration', async () => {
      // Mock API error
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await apiClient.getSpace()
      
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('Basic connection management', async () => {
      const spaces = await connectionManager.getAllSpaces()
      expect(spaces).toHaveLength(1)
      expect(spaces[0].spaceId).toBe('test-space')
    })

    it('Basic request queue functionality', async () => {
      const requestId = await requestQueue.enqueueHighPriority(
        'test-space',
        '/space'
      )
      
      expect(requestId).toBeDefined()
      
      const stats = requestQueue.getStats()
      expect(stats.totalQueued).toBe(1)
    })
  })

  describe('Health Monitoring', () => {
    it('API client health check', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ id: 1, name: 'Test Space' })
      })

      const healthStatus = await apiClient.healthCheck()
      expect(healthStatus.status).toBe('healthy')
      expect(healthStatus.checks.connection).toBe(true)
    })

    it('Error handler health check', async () => {
      const healthStatus = errorHandler.healthCheck()
      expect(healthStatus.status).toBe('healthy')
    })
  })
})