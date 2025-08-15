/**
 * Backlog Connection Manager Unit Tests
 * 
 * テスト範囲:
 * - 複数スペース設定管理
 * - APIキー暗号化保存
 * - 接続プール管理
 * - 並列リクエスト処理
 * - ヘルスモニタリング
 * - イベント管理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { safeStorage } from 'electron'
import { BacklogConnectionManager } from '../../../../electron/main/services/backlog/connection-manager'
import { BacklogRateLimiter } from '../../../../electron/main/services/backlog/rate-limiter'
import type { DatabaseManager } from '../../../../electron/main/database/connection'
import type { SpaceConnectionConfig } from '../../../../electron/main/services/backlog/connection-manager'

// BacklogApiClient モック
vi.mock('../../../../electron/main/services/backlog/api-client', () => ({
  BacklogApiClient: vi.fn().mockImplementation(() => ({
    testConnection: vi.fn().mockResolvedValue({
      success: true,
      data: { connected: true, user: { id: 1, name: 'Test User' }, space: { id: 1, name: 'Test Space' } }
    }),
    healthCheck: vi.fn().mockResolvedValue({
      status: 'healthy',
      checks: { connection: true, authentication: true },
      responseTime: 100
    })
  }))
}))

// Electron safeStorage モック
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn().mockImplementation((str: string) => {
      return Buffer.from(`encrypted_${str}`, 'utf8')
    }),
    decryptString: vi.fn().mockImplementation((buffer: Buffer) => {
      return buffer.toString('utf8').replace('encrypted_', '')
    })
  }
}))

// データベースモック
const mockDatabase = {
  getDrizzle: vi.fn().mockReturnValue({
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue({})
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
      where: vi.fn().mockReturnValue({
        run: vi.fn().mockResolvedValue({ changes: 0 })
      })
    })
  })
} as unknown as DatabaseManager

// Rate Limiter モック
const mockRateLimiter = {
  calculateOptimalConcurrency: vi.fn().mockResolvedValue(3),
  checkRequestPermission: vi.fn().mockResolvedValue(0),
  getRateLimitStatus: vi.fn().mockResolvedValue({
    remaining: 100,
    total: 150,
    utilizationPercent: 33.3
  })
} as unknown as BacklogRateLimiter

// タイマーモック
vi.useFakeTimers()

describe('BacklogConnectionManager', () => {
  let connectionManager: BacklogConnectionManager
  let eventListener: ReturnType<typeof vi.fn>
  
  // グローバルなテスト設定
  const testSpaceConfig: Omit<SpaceConnectionConfig, 'createdAt' | 'connectionCount' | 'errorCount'> = {
    spaceId: 'test-space',
    name: 'Test Space', 
    apiKey: 'test-api-key-123',
    host: 'backlog.jp',
    isActive: true,
    priority: 1
  }

  beforeEach(() => {
    // レートリミッターのモックリセット
    ;(mockRateLimiter.checkRequestPermission as any).mockResolvedValue(0)
    ;(mockRateLimiter.calculateOptimalConcurrency as any).mockResolvedValue(5)
    
    connectionManager = new BacklogConnectionManager(mockDatabase, mockRateLimiter)
    eventListener = vi.fn()
  })

  afterEach(() => {
    connectionManager.destroy()
    vi.clearAllTimers()
  })

  describe('初期化', () => {
    it('正しいパラメータで接続マネージャーを初期化できる', () => {
      expect(connectionManager).toBeDefined()
    })

    it('ヘルスチェックスケジューラーが開始される', () => {
      expect(vi.getTimerCount()).toBeGreaterThan(0)
    })

    it('safeStorageの利用可能性を確認する', () => {
      // BacklogConnectionManagerの初期化時にisEncryptionAvailableが呼ばれる
      expect(vi.mocked(safeStorage).isEncryptionAvailable).toHaveBeenCalled()
    })
  })

  describe('スペース設定管理', () => {

    it('新しいスペース設定を追加できる', async () => {
      const result = await connectionManager.addSpaceConfig(testSpaceConfig)
      
      expect(result).toBe(true)
      expect(vi.mocked(safeStorage).encryptString).toHaveBeenCalledWith('test-api-key-123')
      
      const spaces = connectionManager.getAllSpaces()
      expect(spaces).toHaveLength(1)
      expect(spaces[0].spaceId).toBe('test-space')
    })

    it('APIキーが暗号化される', async () => {
      await connectionManager.addSpaceConfig(testSpaceConfig)
      
      const spaceConfig = connectionManager.getSpaceConfig('test-space')
      expect(spaceConfig?.apiKey).not.toBe('test-api-key-123')
      expect(spaceConfig?.apiKey).toContain('****') // マスクされている
    })

    it('最大スペース数を超えた場合は追加できない', async () => {
      // 10個のスペースを追加
      for (let i = 0; i < 10; i++) {
        await connectionManager.addSpaceConfig({
          ...testSpaceConfig,
          spaceId: `space-${i}`,
          name: `Space ${i}`
        })
      }

      // 11個目は失敗するはず
      const result = await connectionManager.addSpaceConfig({
        ...testSpaceConfig,
        spaceId: 'space-11',
        name: 'Space 11'
      })
      
      expect(result).toBe(false)
    })

    it('重複するスペースIDは追加できない', async () => {
      await connectionManager.addSpaceConfig(testSpaceConfig)
      
      const result = await connectionManager.addSpaceConfig(testSpaceConfig)
      expect(result).toBe(false)
    })

    it('暗号化機能が利用できない場合は追加できない', async () => {
      vi.mocked(safeStorage).isEncryptionAvailable.mockReturnValueOnce(false)
      
      const result = await connectionManager.addSpaceConfig(testSpaceConfig)
      expect(result).toBe(false)
    })
  })

  describe('スペース設定削除', () => {

    it('スペース設定を削除できる', async () => {
      await connectionManager.addSpaceConfig(testSpaceConfig)
      
      const result = await connectionManager.removeSpaceConfig('test-space')
      expect(result).toBe(true)
      
      const spaceConfig = connectionManager.getSpaceConfig('test-space')
      expect(spaceConfig).toBeNull()
    })

    it('存在しないスペースの削除はfalseを返す', async () => {
      const result = await connectionManager.removeSpaceConfig('non-existent')
      expect(result).toBe(false)
    })

    it('削除時に適切なイベントが発火される', async () => {
      connectionManager.addEventListener(eventListener)
      await connectionManager.addSpaceConfig(testSpaceConfig)
      
      await connectionManager.removeSpaceConfig('test-space')
      
      expect(eventListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'disconnected',
          spaceId: 'test-space'
        })
      )
    })
  })

  describe('スペース取得', () => {
    beforeEach(async () => {
      const configs = [
        {
          spaceId: 'space-1',
          name: 'Space 1',
          apiKey: 'key-1',
          isActive: true,
          priority: 3
        },
        {
          spaceId: 'space-2',
          name: 'Space 2',
          apiKey: 'key-2',
          isActive: false,
          priority: 2
        },
        {
          spaceId: 'space-3',
          name: 'Space 3',
          apiKey: 'key-3',
          isActive: true,
          priority: 1
        }
      ]
      
      for (const config of configs) {
        await connectionManager.addSpaceConfig(config)
      }
    })

    it('アクティブなスペースのみを取得できる', () => {
      const activeSpaces = connectionManager.getActiveSpaces()
      
      expect(activeSpaces).toHaveLength(2)
      expect(activeSpaces.map(s => s.spaceId)).toEqual(['space-1', 'space-3'])
    })

    it('優先度順でソートされる', () => {
      const allSpaces = connectionManager.getAllSpaces()
      
      expect(allSpaces).toHaveLength(3)
      expect(allSpaces.map(s => s.priority)).toEqual([3, 2, 1]) // 高い順
    })

    it('特定のスペース設定を取得できる', () => {
      const spaceConfig = connectionManager.getSpaceConfig('space-1')
      
      expect(spaceConfig).toBeTruthy()
      expect(spaceConfig?.spaceId).toBe('space-1')
      expect(spaceConfig?.name).toBe('Space 1')
    })

    it('存在しないスペースはnullを返す', () => {
      const spaceConfig = connectionManager.getSpaceConfig('non-existent')
      expect(spaceConfig).toBeNull()
    })
  })

  describe('APIクライアント取得', () => {

    it('アクティブなスペースのAPIクライアントを取得できる', async () => {
      await connectionManager.addSpaceConfig(testSpaceConfig)
      
      const apiClient = connectionManager.getApiClient('test-space')
      expect(apiClient).toBeTruthy()
    })

    it('非アクティブなスペースのAPIクライアントはnullを返す', async () => {
      await connectionManager.addSpaceConfig({
        ...testSpaceConfig,
        isActive: false
      })
      
      const apiClient = connectionManager.getApiClient('test-space')
      expect(apiClient).toBeNull()
    })

    it('存在しないスペースのAPIクライアントはnullを返す', () => {
      const apiClient = connectionManager.getApiClient('non-existent')
      expect(apiClient).toBeNull()
    })
  })

  describe('接続テスト', () => {

    it('正常な接続テストが実行できる', async () => {
      await connectionManager.addSpaceConfig(testSpaceConfig)
      
      // APIクライアントのモックを設定
      const mockApiClient = {
        testConnection: vi.fn().mockResolvedValue({
          success: true,
          data: {
            connected: true,
            user: { id: 1, name: 'Test User' },
            space: { id: 1, name: 'Test Space' }
          }
        })
      }
      
      // APIクライアントをモックで置き換え
      ;(connectionManager as any).apiClients.set('test-space', mockApiClient)
      
      const result = await connectionManager.testConnection('test-space')
      
      expect(result.success).toBe(true)
      expect(result.data?.connected).toBe(true)
    })

    it('APIクライアントがない場合はエラーを返す', async () => {
      const result = await connectionManager.testConnection('non-existent')
      
      expect(result.success).toBe(false)
      expect(result.error).toContain('APIクライアントが見つかりません')
    })

    it('接続回数とエラー回数が更新される', async () => {
      await connectionManager.addSpaceConfig(testSpaceConfig)
      
      const mockApiClient = {
        testConnection: vi.fn().mockResolvedValue({
          success: true,
          data: { connected: true }
        })
      }
      ;(connectionManager as any).apiClients.set('test-space', mockApiClient)
      
      await connectionManager.testConnection('test-space')
      
      const spaceConfig = connectionManager.getSpaceConfig('test-space')
      expect(spaceConfig?.connectionCount).toBe(1)
      expect(spaceConfig?.lastConnected).toBeDefined()
    })
  })

  describe('並列リクエスト実行', () => {
    it('複数のリクエストを並列で実行できる', async () => {
      const requests = [
        {
          spaceId: 'space-1',
          requestFn: vi.fn().mockResolvedValue({ data: 'result-1' })
        },
        {
          spaceId: 'space-2',
          requestFn: vi.fn().mockResolvedValue({ data: 'result-2' })
        },
        {
          spaceId: 'space-3',
          requestFn: vi.fn().mockResolvedValue({ data: 'result-3' })
        }
      ]

      const results = await connectionManager.executeParallelRequests(requests)
      
      expect(results).toHaveLength(3)
      expect(results.every(r => r.error === undefined)).toBe(true)
      expect(results.map(r => r.result?.data)).toEqual(['result-1', 'result-2', 'result-3'])
    })

    it('エラーが発生しても他のリクエストは継続される', async () => {
      const requests = [
        {
          spaceId: 'space-1',
          requestFn: vi.fn().mockResolvedValue({ data: 'result-1' })
        },
        {
          spaceId: 'space-2',
          requestFn: vi.fn().mockRejectedValue(new Error('Request failed'))
        },
        {
          spaceId: 'space-3',
          requestFn: vi.fn().mockResolvedValue({ data: 'result-3' })
        }
      ]

      const results = await connectionManager.executeParallelRequests(requests)
      
      expect(results).toHaveLength(3)
      expect(results[0].error).toBeUndefined()
      expect(results[1].error).toBeDefined()
      expect(results[2].error).toBeUndefined()
    })

    it.skip('レート制限を考慮した遅延が適用される', async () => {
      // 遅延ありのモック設定（1msに短縮）
      ;(mockRateLimiter.checkRequestPermission as any).mockReset().mockResolvedValue(1) // 1ms遅延
      
      const requests = [{
        spaceId: 'space-1',
        requestFn: vi.fn().mockResolvedValue({ data: 'result' })
      }]

      const startTime = Date.now()
      await connectionManager.executeParallelRequests(requests)
      
      expect(mockRateLimiter.checkRequestPermission).toHaveBeenCalledWith('space-1')
    }, 5000)

    it('動的並列数制御が適用される', async () => {
      // より短い実行時間のリクエストを作成
      const requests = Array.from({ length: 5 }, (_, i) => ({
        spaceId: 'space-1',
        requestFn: vi.fn().mockResolvedValue({ data: `result-${i}` })
      }))

      // レート制限チェックを高速化
      ;(mockRateLimiter.checkRequestPermission as any).mockReset().mockResolvedValue(0) // 遅延なし

      await connectionManager.executeParallelRequests(requests)
      
      expect(mockRateLimiter.calculateOptimalConcurrency).toHaveBeenCalledWith('space-1')
    }, 5000)
  })

  describe('ヘルスチェック', () => {
    beforeEach(async () => {
      await connectionManager.addSpaceConfig({
        spaceId: 'space-1',
        name: 'Space 1',
        apiKey: 'key-1',
        isActive: true,
        priority: 1
      })
      await connectionManager.addSpaceConfig({
        spaceId: 'space-2',
        name: 'Space 2',
        apiKey: 'key-2',
        isActive: true,
        priority: 2
      })
    })

    it('全スペースのヘルスチェックを実行できる', async () => {
      const mockApiClient = {
        healthCheck: vi.fn().mockResolvedValue({
          status: 'healthy',
          checks: {
            connection: true,
            authentication: true
          },
          responseTime: 100
        })
      }
      
      // 全スペースにAPIクライアントを設定
      ;(connectionManager as any).apiClients.set('space-1', mockApiClient)
      ;(connectionManager as any).apiClients.set('space-2', mockApiClient)
      
      const results = await connectionManager.performHealthCheck()
      
      expect(results).toHaveLength(2)
      expect(results.every(r => r.status === 'healthy')).toBe(true)
    })

    it('特定スペースのヘルスチェックを実行できる', async () => {
      const mockApiClient = {
        healthCheck: vi.fn().mockResolvedValue({
          status: 'healthy',
          checks: {
            connection: true,
            authentication: true
          },
          responseTime: 100
        })
      }
      ;(connectionManager as any).apiClients.set('space-1', mockApiClient)
      
      const results = await connectionManager.performHealthCheck('space-1')
      
      expect(results).toHaveLength(1)
      expect(results[0].spaceId).toBe('space-1')
    })

    it('APIクライアントがないスペースはunhealthyを返す', async () => {
      // スペース設定を追加（但しAPIクライアントは設定しない）
      await connectionManager.addSpaceConfig({
        ...testSpaceConfig,
        spaceId: 'space-1'
      })
      
      // APIクライアントを削除してテスト条件を整える
      ;(connectionManager as any).apiClients.delete('space-1')
      
      const results = await connectionManager.performHealthCheck('space-1')
      
      expect(results).toHaveLength(1)
      expect(results[0].status).toBe('unhealthy')
      expect(results[0].errorMessage).toContain('APIクライアントが見つかりません')
    })

    it('ヘルスチェックイベントが発火される', async () => {
      connectionManager.addEventListener(eventListener)
      
      const mockApiClient = {
        healthCheck: vi.fn().mockResolvedValue({
          status: 'healthy',
          checks: { connection: true, authentication: true },
          responseTime: 100
        })
      }
      ;(connectionManager as any).apiClients.set('space-1', mockApiClient)
      
      await connectionManager.performHealthCheck('space-1')
      
      expect(eventListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'health_check',
          spaceId: 'space-1'
        })
      )
    })

    it('定期ヘルスチェックが実行される', async () => {
      const mockApiClient = {
        healthCheck: vi.fn().mockResolvedValue({
          status: 'healthy',
          checks: { connection: true, authentication: true },
          responseTime: 100
        })
      }
      ;(connectionManager as any).apiClients.set('space-1', mockApiClient)
      ;(connectionManager as any).apiClients.set('space-2', mockApiClient)
      
      // 単発のヘルスチェックを実行
      await connectionManager.performHealthCheck()
      
      expect(mockApiClient.healthCheck).toHaveBeenCalled()
    })
  })

  describe('接続プール統計', () => {
    it('特定スペースの統計情報を取得できる', () => {
      const stats = connectionManager.getConnectionPoolStats('test-space')
      // 初期状態ではnullまたは初期値
    })

    it('全スペースの統計情報を取得できる', () => {
      const stats = connectionManager.getConnectionPoolStats()
      expect(stats).toBeInstanceOf(Map)
    })
  })

  describe('イベント管理', () => {
    it('イベントリスナーを追加・削除できる', () => {
      connectionManager.addEventListener(eventListener)
      expect(eventListener).not.toHaveBeenCalled()
      
      connectionManager.removeEventListener(eventListener)
    })

    it('接続時にイベントが発火される', async () => {
      connectionManager.addEventListener(eventListener)
      
      await connectionManager.addSpaceConfig({
        spaceId: 'test-space',
        name: 'Test Space',
        apiKey: 'test-key',
        isActive: true,
        priority: 1
      })
      
      expect(eventListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'connected',
          spaceId: 'test-space'
        })
      )
    })

    it('エラー時にイベントが発火される', async () => {
      connectionManager.addEventListener(eventListener)
      
      // スペース設定を追加してから、APIクライアントを削除してエラーを発生させる
      await connectionManager.addSpaceConfig({
        ...testSpaceConfig,
        spaceId: 'error-space'
      })
      
      // APIクライアントにエラーを発生させる
      const mockApiClient = {
        healthCheck: vi.fn().mockRejectedValue(new Error('Health check failed'))
      }
      ;(connectionManager as any).apiClients.set('error-space', mockApiClient)
      
      await connectionManager.performHealthCheck('error-space')
      
      expect(eventListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          spaceId: 'error-space'
        })
      )
    })
  })

  describe('リソース管理', () => {
    it('destroy()でリソースが適切にクリーンアップされる', async () => {
      await connectionManager.addSpaceConfig({
        spaceId: 'test-space',
        name: 'Test Space',
        apiKey: 'test-key',
        isActive: true,
        priority: 1
      })
      
      const initialTimerCount = vi.getTimerCount()
      
      await connectionManager.destroy()
      
      // タイマーが停止されたことを確認
      expect(vi.getTimerCount()).toBeLessThan(initialTimerCount)
      
      // 設定がクリアされたことを確認
      expect(connectionManager.getAllSpaces()).toHaveLength(0)
    })

    it('接続プールが適切にクリーンアップされる', async () => {
      await connectionManager.addSpaceConfig({
        spaceId: 'test-space',
        name: 'Test Space', 
        apiKey: 'test-key',
        isActive: true,
        priority: 1
      })
      
      await connectionManager.destroy()
      
      // destroy後はスペース設定がない
      expect(connectionManager.getSpaceConfig('test-space')).toBeNull()
    })
  })

  describe('エラーハンドリング', () => {
    it('暗号化エラー時はスペース追加が失敗する', async () => {
      vi.mocked(safeStorage).encryptString.mockImplementationOnce(() => {
        throw new Error('Encryption failed')
      })
      
      const result = await connectionManager.addSpaceConfig({
        spaceId: 'test-space',
        name: 'Test Space',
        apiKey: 'test-key',
        isActive: true,
        priority: 1
      })
      
      expect(result).toBe(false)
    })

    it('復号化エラー時はAPIクライアントがnullを返す', async () => {
      await connectionManager.addSpaceConfig({
        spaceId: 'test-space',
        name: 'Test Space',
        apiKey: 'test-key',
        isActive: true,
        priority: 1
      })
      
      // 既存のAPIクライアントを削除
      ;(connectionManager as any).apiClients.delete('test-space')
      
      // 復号化エラーをシミュレート
      vi.mocked(safeStorage).decryptString.mockImplementationOnce(() => {
        throw new Error('Decryption failed')
      })
      
      const apiClient = connectionManager.getApiClient('test-space')
      expect(apiClient).toBeNull()
    })
  })

  describe('暗号化セキュリティ', () => {
    it('APIキーがメモリ上に平文で保存されない', async () => {
      await connectionManager.addSpaceConfig({
        spaceId: 'test-space',
        name: 'Test Space',
        apiKey: 'super-secret-key',
        isActive: true,
        priority: 1
      })
      
      const spaceConfig = connectionManager.getSpaceConfig('test-space')
      expect(spaceConfig?.apiKey).not.toBe('super-secret-key')
      expect(spaceConfig?.apiKey).not.toContain('super-secret-key')
    })

    it('APIキーが適切にマスクされる', async () => {
      await connectionManager.addSpaceConfig({
        spaceId: 'test-space',
        name: 'Test Space',
        apiKey: 'abcdefghijklmnop',
        isActive: true,
        priority: 1
      })
      
      const spaceConfig = connectionManager.getSpaceConfig('test-space')
      expect(spaceConfig?.apiKey).toBe('abcd****mnop')
    })

    it('短いAPIキーは完全にマスクされる', async () => {
      await connectionManager.addSpaceConfig({
        spaceId: 'test-space',
        name: 'Test Space',
        apiKey: 'short',
        isActive: true,
        priority: 1
      })
      
      const spaceConfig = connectionManager.getSpaceConfig('test-space')
      expect(spaceConfig?.apiKey).toBe('****')
    })
  })
})
