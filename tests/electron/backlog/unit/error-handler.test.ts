/**
 * Backlog Error Handler Unit Tests
 * 
 * テスト範囲:
 * - カスタムエラー分類
 * - 指数バックオフリトライ
 * - Pinoログ統合
 * - エラー回復機能
 * - アラート機能
 * - サーキットブレーカー
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  BacklogErrorHandler,
  BacklogApiError,
  ErrorType,
  ErrorSeverity
} from '../../../../electron/main/services/backlog/error-handler'
import type { ErrorContext } from '../../../../electron/main/services/backlog/error-handler'
import { Logger } from '../../../../electron/main/utils/logger'

// Logger モック
vi.mock('../../../../electron/main/utils/logger', () => ({
  Logger: {
    getInstance: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn()
    }),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  }
}))

// fetch API モック (アラートwebhook用)
const mockFetch = vi.fn()
global.fetch = mockFetch

// タイマーモック
vi.useFakeTimers()

describe('BacklogErrorHandler', () => {
  let errorHandler: BacklogErrorHandler
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorHandler = new BacklogErrorHandler()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    
    // sleepモックを追加（即座に完了）
    vi.spyOn(errorHandler as any, 'sleep').mockResolvedValue()
    
    vi.clearAllMocks()
  })

  afterEach(() => {
    errorHandler.reset()
    consoleErrorSpy.mockRestore()
    consoleLogSpy.mockRestore()
    vi.clearAllTimers()
  })

  describe('初期化', () => {
    it('デフォルト設定でエラーハンドラーを初期化できる', () => {
      expect(errorHandler).toBeDefined()
    })

    it('カスタムアラート設定で初期化できる', () => {
      const customConfig = {
        enabled: false,
        thresholds: {
          errorRate: 5,
          criticalErrorCount: 3,
          responseTimeMs: 3000
        },
        channels: ['log', 'webhook'] as const,
        webhookUrl: 'https://example.com/webhook'
      }
      
      const customHandler = new BacklogErrorHandler(customConfig)
      expect(customHandler).toBeDefined()
      
      const healthStatus = customHandler.healthCheck()
      expect(healthStatus.details.alertsEnabled).toBe(false)
    })
  })

  describe('エラー分類', () => {
    const testContext: ErrorContext = {
      spaceId: 'test-space',
      endpoint: '/issues',
      requestId: 'req-123',
      timestamp: new Date()
    }

    it('ネットワークエラーを正しく分類する', () => {
      const networkError = new Error('fetch failed')
      
      const classified = errorHandler.classifyError(networkError, testContext)
      
      expect(classified.type).toBe(ErrorType.NETWORK_ERROR)
      expect(classified.severity).toBe(ErrorSeverity.HIGH)
      expect(classified.recoverable).toBe(true)
      expect(classified.retryable).toBe(true)
    })

    it('タイムアウトエラーを正しく分類する', () => {
      const timeoutError = new Error('Request timeout')
      
      const classified = errorHandler.classifyError(timeoutError, testContext)
      
      expect(classified.type).toBe(ErrorType.CONNECTION_TIMEOUT)
      expect(classified.severity).toBe(ErrorSeverity.MEDIUM)
      expect(classified.retryable).toBe(true)
    })

    it('DNS解決エラーを正しく分類する', () => {
      const dnsError = new Error('ENOTFOUND api.example.com')
      
      const classified = errorHandler.classifyError(dnsError, testContext)
      
      expect(classified.type).toBe(ErrorType.DNS_RESOLUTION_ERROR)
      expect(classified.severity).toBe(ErrorSeverity.HIGH)
      expect(classified.recoverable).toBe(false)
      expect(classified.retryable).toBe(false)
    })

    it('HTTPステータスコードでエラーを分類する', () => {
      const error = new Error('HTTP Error')
      const contextWithStatus = { ...testContext, statusCode: 401 }
      
      const classified = errorHandler.classifyError(error, contextWithStatus)
      
      expect(classified.type).toBe(ErrorType.AUTH_ERROR)
      expect(classified.httpStatus).toBe(401)
      expect(classified.severity).toBe(ErrorSeverity.HIGH)
    })

    it('レート制限エラーを正しく分類する', () => {
      const error = new Error('Rate limit exceeded')
      const contextWithStatus = { ...testContext, statusCode: 429 }
      
      const classified = errorHandler.classifyError(error, contextWithStatus)
      
      expect(classified.type).toBe(ErrorType.RATE_LIMIT_ERROR)
      expect(classified.severity).toBe(ErrorSeverity.MEDIUM)
      expect(classified.retryable).toBe(true)
    })

    it('設定エラーを正しく分類する', () => {
      const configError = new Error('Invalid configuration')
      
      const classified = errorHandler.classifyError(configError, testContext)
      
      expect(classified.type).toBe(ErrorType.CONFIGURATION_ERROR)
      expect(classified.severity).toBe(ErrorSeverity.CRITICAL)
      expect(classified.recoverable).toBe(false)
    })

    it('不明なエラーをデフォルト分類する', () => {
      const unknownError = new Error('Something went wrong')
      
      const classified = errorHandler.classifyError(unknownError, testContext)
      
      expect(classified.type).toBe(ErrorType.UNKNOWN_ERROR)
      expect(classified.severity).toBe(ErrorSeverity.MEDIUM)
    })

    it('非Errorオブジェクトを適切に処理する', () => {
      const stringError = 'Something failed'
      
      const classified = errorHandler.classifyError(stringError, testContext)
      
      expect(classified.type).toBe(ErrorType.UNKNOWN_ERROR)
      expect(classified.message).toBe('Something failed')
    })
  })

  describe('リトライ機能', () => {
    it('指数バックオフでリトライを実行する', async () => {
      let attemptCount = 0
      const operation = vi.fn().mockImplementation(() => {
        attemptCount++
        if (attemptCount < 3) {
          throw new Error('Temporary failure')
        }
        return Promise.resolve('success')
      })

      const result = await errorHandler.retryWithBackoff(
        operation,
        ErrorType.NETWORK_ERROR,
        { spaceId: 'test-space', timestamp: new Date() }
      )

      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(3)
    }, 5000)

    it('最大リトライ回数に達した場合はエラーを投げる', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Permanent failure'))

      await expect(
        errorHandler.retryWithBackoff(
          operation,
          ErrorType.NETWORK_ERROR,
          { spaceId: 'test-space', timestamp: new Date() }
        )
      ).rejects.toThrow()

      expect(operation).toHaveBeenCalledTimes(6) // 最初 + 5回リトライ
    })

    it('リトライ不可なエラーは即座に失敗する', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('DNS error'))

      await expect(
        errorHandler.retryWithBackoff(
          operation,
          ErrorType.DNS_RESOLUTION_ERROR,
          { spaceId: 'test-space', timestamp: new Date() }
        )
      ).rejects.toThrow()

      expect(operation).toHaveBeenCalledTimes(1) // リトライなし
    })

    it('カスタムリトライ戦略を使用できる', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Network error'))
      const customStrategy = {
        maxRetries: 2,
        baseDelayMs: 100,
        retryableErrors: [ErrorType.NETWORK_ERROR]
      }

      await expect(
        errorHandler.retryWithBackoff(
          operation,
          ErrorType.NETWORK_ERROR,
          { spaceId: 'test-space', timestamp: new Date() },
          customStrategy
        )
      ).rejects.toThrow()

      expect(operation).toHaveBeenCalledTimes(3) // 最初 + 2回リトライ
    })

    it('遅延時間が正しく計算される', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Network error'))
      const sleepSpy = vi.spyOn(errorHandler as any, 'sleep').mockResolvedValue()

      await expect(
        errorHandler.retryWithBackoff(
          operation,
          ErrorType.NETWORK_ERROR,
          { spaceId: 'test-space', timestamp: new Date() }
        )
      ).rejects.toThrow()

      // 遅延が実行されたことを確認
      expect(sleepSpy).toHaveBeenCalled()
    })
  })

  describe('エラー回復', () => {
    it('自動回復が有効なエラーで回復を試みる', async () => {
      const networkError = new BacklogApiError({
        type: ErrorType.NETWORK_ERROR,
        message: 'Network failure',
        context: { spaceId: 'test-space', timestamp: new Date() }
      })

      const recovered = await errorHandler.attemptRecovery(networkError)
      
      // デフォルトでは回復アクションがないのでfalse
      expect(recovered).toBe(false)
    })

    it('自動回復が無効なエラーでは回復を試みない', async () => {
      const dnsError = new BacklogApiError({
        type: ErrorType.DNS_RESOLUTION_ERROR,
        message: 'DNS failure',
        context: { spaceId: 'test-space', timestamp: new Date() }
      })

      const recovered = await errorHandler.attemptRecovery(dnsError)
      expect(recovered).toBe(false)
    })

    it('サーキットブレーカーが開いている場合は回復をスキップする', async () => {
      const error = new BacklogApiError({
        type: ErrorType.NETWORK_ERROR,
        message: 'Network failure',
        context: { spaceId: 'test-space', timestamp: new Date() }
      })

      // サーキットブレーカーを開く
      const circuitKey = `${ErrorType.NETWORK_ERROR}-test-space`
      ;(errorHandler as any).circuitBreakerStates.set(circuitKey, {
        isOpen: true,
        failureCount: 10,
        lastFailure: new Date()
      })

      const recovered = await errorHandler.attemptRecovery(error)
      expect(recovered).toBe(false)
    })
  })

  describe('エラーログ', () => {
    it('エラー重要度に応じて適切なログレベルで記録される', () => {
      const criticalError = new BacklogApiError({
        type: ErrorType.CONFIGURATION_ERROR,
        message: 'Critical error',
        severity: ErrorSeverity.CRITICAL,
        context: { spaceId: 'test-space', timestamp: new Date() }
      })

      errorHandler.classifyError(criticalError, {})

      expect(vi.mocked(Logger).getInstance().fatal).toHaveBeenCalledWith(
        expect.stringContaining('Critical Backlog API error'),
        expect.any(Error),
        expect.any(Object),
        expect.any(Object)
      )
    })

    it('機密情報がマスクされる', () => {
      const errorWithSensitiveData = new Error('API key abc123def456 is invalid')
      
      errorHandler.classifyError(errorWithSensitiveData, {
        spaceId: 'test-space',
        timestamp: new Date()
      })

      // ログにAPIキーが平文で記録されないことを確認
      const logCalls = vi.mocked(Logger).getInstance().error.mock.calls
      const loggedData = JSON.stringify(logCalls)
      expect(loggedData).not.toContain('abc123def456')
    })
  })

  describe('アラート機能', () => {
    beforeEach(() => {
      // アラート有効なハンドラーを作成
      errorHandler = new BacklogErrorHandler({
        enabled: true,
        thresholds: {
          errorRate: 5,
          criticalErrorCount: 2,
          responseTimeMs: 5000
        },
        channels: ['log', 'webhook'],
        webhookUrl: 'https://example.com/webhook'
      })
    })

    it('エラー率が闾値を超えた場合にアラートが発火される', () => {
      // 多数のエラーを発生させる
      for (let i = 0; i < 10; i++) {
        errorHandler.classifyError(new Error('Test error'), {
          spaceId: 'test-space',
          timestamp: new Date()
        })
      }

      expect(vi.mocked(Logger).getInstance().fatal).toHaveBeenCalledWith(
        expect.stringContaining('ALERT'),
        undefined,
        expect.any(Object)
      )
    })

    it('重要エラー数が闾値を超えた場合にアラートが発火される', () => {
      // CRITICALエラー（設定エラー）を発生させる
      for (let i = 0; i < 5; i++) {
        errorHandler.classifyError(new Error('Configuration error'), {
          spaceId: 'test-space',
          timestamp: new Date()
        })
      }

      expect(vi.mocked(Logger).getInstance().fatal).toHaveBeenCalledWith(
        expect.stringContaining('ALERT'),
        undefined,
        expect.any(Object)
      )
    })

    it('Webhookアラートが送信される', async () => {
      // Webhook設定を有効にしたハンドラーを作成
      const webhookHandler = new BacklogErrorHandler({
        channels: ['webhook'],
        webhookUrl: 'https://example.com/webhook'
      })
      
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200
      })

      // CRITICALエラーでアラートをトリガー
      webhookHandler.classifyError(new Error('Configuration error'), {
        spaceId: 'test-space',
        timestamp: new Date()
      })

      // 非同期処理のため少し待つ
      await vi.runAllTimersAsync()

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          }),
          body: expect.stringContaining('Backlog API Error Alert')
        })
      )
    }, 10000)

    it('Webhook送信失敗時はエラーログが記録される', async () => {
      // Webhook設定を有効にしたハンドラーを作成
      const webhookHandler = new BacklogErrorHandler({
        channels: ['webhook'],
        webhookUrl: 'https://example.com/webhook'
      })
      
      mockFetch.mockRejectedValue(new Error('Webhook failed'))

      webhookHandler.classifyError(new Error('Configuration error'), {
        spaceId: 'test-space',
        timestamp: new Date()
      })

      await vi.runAllTimersAsync()

      expect(vi.mocked(Logger).getInstance().error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send webhook alert'),
        expect.any(Error),
        expect.any(Object)
      )
    }, 10000)
  })

  describe('統計情報', () => {
    it('エラートレンド情報を追跡できる', () => {
      // 異なるタイプのエラーを発生させる
      errorHandler.classifyError(new Error('Network error'), {
        spaceId: 'test-space',
        timestamp: new Date()
      })
      errorHandler.classifyError(new Error('Rate limit'), {
        spaceId: 'test-space',
        timestamp: new Date(),
        statusCode: 429
      })
      errorHandler.classifyError(new Error('Network error 2'), {
        spaceId: 'test-space',
        timestamp: new Date()
      })

      const trends = errorHandler.getErrorTrends()
      
      expect(trends.get(ErrorType.NETWORK_ERROR)?.count).toBe(2)
      expect(trends.get(ErrorType.RATE_LIMIT_ERROR)?.count).toBe(1)
    })

    it('エラー統計サマリーを取得できる', () => {
      // 各種エラーを発生させる
      errorHandler.classifyError(new Error('Network error'), {
        spaceId: 'test-space',
        timestamp: new Date()
      })
      errorHandler.classifyError(new Error('Critical error'), {
        spaceId: 'test-space',
        timestamp: new Date(),
        statusCode: 500
      })

      const summary = errorHandler.getErrorSummary()
      
      expect(summary.totalErrors).toBe(2)
      expect(summary.errorsByType).toHaveProperty(ErrorType.NETWORK_ERROR)
      expect(summary.errorsBySeverity).toHaveProperty(ErrorSeverity.HIGH)
      expect(summary.uptime).toBeGreaterThan(0)
    })

    it('ヘルスチェックで適切な状態を返す', () => {
      const initialHealth = errorHandler.healthCheck()
      expect(initialHealth.status).toBe('healthy')

      // CRITICALエラー（設定エラー）を発生させる
      for (let i = 0; i < 5; i++) {
        errorHandler.classifyError(new Error('Configuration error'), {
          spaceId: 'test-space',
          timestamp: new Date()
        })
      }

      const degradedHealth = errorHandler.healthCheck()
      expect(degradedHealth.status).toBe('unhealthy')
    })
  })

  describe('設定管理', () => {
    it('アラート設定を動的に更新できる', () => {
      const newConfig = {
        enabled: false,
        thresholds: {
          errorRate: 15,
          criticalErrorCount: 10,
          responseTimeMs: 10000
        }
      }

      errorHandler.updateAlertConfig(newConfig)

      const healthStatus = errorHandler.healthCheck()
      expect(healthStatus.details.alertsEnabled).toBe(false)
    })

    it('エラーハンドラーをリセットできる', () => {
      // エラーを発生させる
      errorHandler.classifyError(new Error('Test error'), {
        spaceId: 'test-space',
        timestamp: new Date()
      })

      let summary = errorHandler.getErrorSummary()
      expect(summary.totalErrors).toBe(1)

      // リセット
      errorHandler.reset()

      summary = errorHandler.getErrorSummary()
      expect(summary.totalErrors).toBe(0)
    })
  })

  describe('デバッグ機能', () => {
    it('デバッグコンテキストを取得できる', () => {
      errorHandler.classifyError(new Error('Test error'), {
        spaceId: 'test-space',
        timestamp: new Date()
      })

      const debugContext = errorHandler.getDebugContext()
      
      expect(debugContext).toHaveProperty('errorCounts')
      expect(debugContext).toHaveProperty('errorTrends')
      expect(debugContext).toHaveProperty('circuitBreakerStates')
      expect(debugContext).toHaveProperty('alertConfig')
      expect(debugContext).toHaveProperty('retryStrategies')
      expect(debugContext).toHaveProperty('uptime')
    })
  })

  describe('BacklogApiErrorクラス', () => {
    it('エラーの詳細情報を取得できる', () => {
      const originalError = new Error('Original error')
      const context: ErrorContext = {
        spaceId: 'test-space',
        endpoint: '/issues',
        timestamp: new Date()
      }

      const backlogError = new BacklogApiError({
        type: ErrorType.NETWORK_ERROR,
        message: 'Network failure',
        severity: ErrorSeverity.HIGH,
        context,
        originalError,
        recoverable: true,
        retryable: true,
        suggestedAction: 'Check network connection',
        httpStatus: 503
      })

      const details = backlogError.getFullDetails()
      
      expect(details.type).toBe(ErrorType.NETWORK_ERROR)
      expect(details.severity).toBe(ErrorSeverity.HIGH)
      expect(details.recoverable).toBe(true)
      expect(details.retryable).toBe(true)
      expect(details.suggestedAction).toBe('Check network connection')
      expect(details.httpStatus).toBe(503)
      expect(details.originalError).toEqual({
        name: originalError.name,
        message: originalError.message,
        stack: originalError.stack
      })
    })

    it('適切なスタックトレースを生成する', () => {
      const backlogError = new BacklogApiError({
        type: ErrorType.API_ERROR,
        message: 'API error',
        context: { spaceId: 'test-space', timestamp: new Date() }
      })

      expect(backlogError.stack).toBeDefined()
      expect(backlogError.name).toBe('BacklogApiError')
    })
  })

  describe('パフォーマンス', () => {
    it('大量のエラーを効率的に処理できる', () => {
      const startTime = Date.now()
      
      // 1000個のエラーを処理
      for (let i = 0; i < 1000; i++) {
        errorHandler.classifyError(new Error(`Error ${i}`), {
          spaceId: `space-${i % 10}`,
          timestamp: new Date()
        })
      }
      
      const processingTime = Date.now() - startTime
      
      // 処理時間が合理的な範囲内であることを確認
      expect(processingTime).toBeLessThan(5000) // 5秒以内
      
      const summary = errorHandler.getErrorSummary()
      expect(summary.totalErrors).toBe(1000)
    })

    it('メモリ使用量が適切に管理される', () => {
      const initialMemory = process.memoryUsage()
      
      // 大量のエラーデータを生成
      for (let i = 0; i < 10000; i++) {
        errorHandler.classifyError(new Error(`Large error ${i} with lots of data`.repeat(100)), {
          spaceId: `space-${i % 100}`,
          timestamp: new Date(),
          metadata: {
            largeData: new Array(100).fill(`data-${i}`)
          }
        })
      }
      
      const finalMemory = process.memoryUsage()
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed
      
      // メモリ使用量が異常に増加していないことを確認
      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024) // 100MB以内
    })
  })
})
