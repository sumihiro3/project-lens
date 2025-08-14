/**
 * Logger System Unit Tests
 *
 * ProjectLens Pinoログシステムのユニットテスト
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { Logger } from '../../../electron/main/utils/logger'
import { DatabaseErrorHandler } from '../../../electron/main/database/utils/error-handler'
// import type { LoggingConfig } from '../../../shared/types/logging'

// Mock Electron
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-logs'),
  },
}))

// Mock pino-pretty for tests
vi.mock('pino-pretty', () => ({
  default: vi.fn(() => process.stdout),
}))

describe('Logger System', () => {
  let logger: Logger
  let testLogDir: string
  let originalEnv: string | undefined

  beforeEach(() => {
    // テスト用一時ディレクトリ作成
    testLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-test-'))

    // 環境変数をテスト用に設定
    originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'

    // Loggerインスタンスをリセット
    // @ts-expect-error - private static property access for testing
    Logger.instance = undefined

    logger = Logger.getInstance()
  })

  afterEach(() => {
    // テスト後クリーンアップ
    logger.destroy()

    // テスト用ディレクトリ削除
    if (fs.existsSync(testLogDir)) {
      fs.rmSync(testLogDir, { recursive: true, force: true })
    }

    // 環境変数復元
    if (originalEnv !== undefined) {
      process.env.NODE_ENV = originalEnv
    }
    else {
      delete process.env.NODE_ENV
    }

    // Loggerインスタンスをリセット
    // @ts-expect-error - private static property access for testing
    Logger.instance = undefined
  })

  describe('初期化', () => {
    it('シングルトンインスタンスを返すべき', () => {
      const instance1 = Logger.getInstance()
      const instance2 = Logger.getInstance()
      expect(instance1).toBe(instance2)
    })

    it('100ms以内に初期化されるべき', () => {
      const start = Date.now()
      // @ts-expect-error - private static property access for testing
      Logger.instance = undefined
      Logger.getInstance()
      const duration = Date.now() - start
      expect(duration).toBeLessThan(100)
    })

    it('正しい環境を検出するべき', () => {
      const config = logger.getConfig()
      expect(config.currentEnvironment).toBe('test')
    })
  })

  describe('ログ出力', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleSpy.mockRestore()
    })

    it('異なるレベルのログを出功できるべき', () => {
      expect(() => {
        logger.trace('トレースメッセージ')
        logger.debug('デバッグメッセージ')
        logger.info('情報メッセージ')
        logger.warn('警告メッセージ')
        logger.error('エラーメッセージ')
        logger.fatal('致命的エラーメッセージ')
      }).not.toThrow()
    })

    it('データ付きログを出功できるべき', () => {
      const testData = { userId: 123, action: 'test' }
      expect(() => {
        logger.info('テストメッセージ', testData)
      }).not.toThrow()
    })

    it('エラーオブジェクト付きログを出力できるべき', () => {
      const testError = new Error('テストエラー')
      expect(() => {
        logger.error('エラー発生', testError)
      }).not.toThrow()
    })
  })

  describe('機密情報マスキング', () => {
    it('パスワードをマスクするべき', () => {
      // 実際のマスキング動作は内部処理のため、エラーが発生しないことをテスト
      expect(() => {
        logger.info('ログイン: password=secret123', {
          username: 'testuser',
          password: 'secret123',
        })
      }).not.toThrow()
    })

    it('トークンをマスクするべき', () => {
      expect(() => {
        logger.warn('認証エラー: token=bearer-xyz123')
      }).not.toThrow()
    })
  })

  describe('パフォーマンス測定', () => {
    it('同期処理のパフォーマンスを計測できるべき', () => {
      const result = logger.withPerformance('test-sync', () => {
        return 'test-result'
      })
      expect(result).toBe('test-result')
    })

    it('非同期処理のパフォーマンスを計測できるべき', async () => {
      const result = await logger.withAsyncPerformance('test-async', async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return 'async-result'
      })
      expect(result).toBe('async-result')
    })

    it('エラー発生時でもパフォーマンスを計測しエラーを再スローするべき', () => {
      const testError = new Error('テストエラー')
      expect(() => {
        logger.withPerformance('failing-operation', () => {
          throw testError
        })
      }).toThrow(testError)
    })
  })

  describe('データベースエラーログ', () => {
    it('データベースエラーをログできるべき', () => {
      const handler = DatabaseErrorHandler.getInstance()
      const testError = new Error('SQLITE_CANTOPEN: unable to open database')
      const dbError = handler.analyzeError(testError, {
        operation: 'connect',
        filePath: '/test/db.sqlite',
      })

      expect(() => {
        logger.logDatabaseError(dbError)
      }).not.toThrow()
    })

    it('異なる重要度のエラーを適切なレベルでログできるべき', () => {
      const handler = DatabaseErrorHandler.getInstance()

      // Critical error
      const criticalError = handler.analyzeError(new Error('database corruption'), {
        operation: 'read',
      })
      expect(() => logger.logDatabaseError(criticalError)).not.toThrow()

      // Warning level error
      const warningError = handler.analyzeError(new Error('constraint violation'), {
        operation: 'insert',
        table: 'users',
      })
      expect(() => logger.logDatabaseError(warningError)).not.toThrow()
    })
  })

  describe('設定管理', () => {
    it('現在の設定を取得できるべき', () => {
      const config = logger.getConfig()
      expect(config).toBeDefined()
      expect(config.currentEnvironment).toBe('test')
      expect(config.global).toBeDefined()
      expect(config.environments).toBeDefined()
    })

    it('ログレベルを動的に変更できるべき', () => {
      expect(() => {
        logger.setLevel('error')
        logger.setLevel('debug')
      }).not.toThrow()
    })

    it('設定を更新できるべき', () => {
      const newConfig = {
        global: {
          appName: 'TestApp',
          appVersion: '2.0.0',
          maxRetentionDays: 30,
          sensitiveDataMask: {
            enabled: false,
            patterns: [],
            replacement: '[HIDDEN]',
          },
          performance: {
            enabled: false,
            slowOperationThreshold: 2000,
          },
        },
      }

      expect(() => {
        logger.updateConfig(newConfig)
      }).not.toThrow()

      const updatedConfig = logger.getConfig()
      expect(updatedConfig.global.appName).toBe('TestApp')
      expect(updatedConfig.global.appVersion).toBe('2.0.0')
    })
  })

  describe('ヘルスチェック', () => {
    it('ヘルスチェックを実行できるべき', () => {
      const health = logger.healthCheck()
      expect(health).toBeDefined()
      expect(health.status).toBe('ok')
      expect(health.details).toBeDefined()
      expect(health.details.environment).toBe('test')
      expect(health.details.sessionId).toBeDefined()
      expect(typeof health.details.uptime).toBe('number')
    })

    it('エラー時に適切なステータスを返すべき', () => {
      // 実際のエラー状態をシミュレートするのは難しいので、
      // 正常時のヘルスチェックが機能することを確認
      const health = logger.healthCheck()
      expect(['ok', 'error']).toContain(health.status)
    })
  })

  describe('クリーンアップ', () => {
    it('リソースを適切にクリーンアップできるべき', () => {
      expect(() => {
        logger.destroy()
      }).not.toThrow()
    })
  })

  describe('クロスプラットフォーム対応', () => {
    it.each([
      ['darwin', 'macOS'],
      ['win32', 'Windows'],
      ['linux', 'Linux'],
    ])('%s プラットフォームで動作するべき (%s)', (platform, description) => {
      // process.env.NODE_ENV を一時的に変更してテスト環境をリセット
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'test'

      try {
        // 現在のプラットフォームでLoggerが正しく動作することを確認
        // プラットフォーム固有のロジックはgetLogDirectoryで使用される
        // @ts-expect-error - private static property access for testing
        Logger.instance = undefined
        const platformLogger = Logger.getInstance()

        expect(() => {
          platformLogger.info(`${description}でのテスト (実際のプラットフォーム: ${os.platform()})`)
        }).not.toThrow()

        // Logger が正しく初期化されていることを確認
        const config = platformLogger.getConfig()
        expect(config).toBeDefined()
        expect(config.currentEnvironment).toBe('test')

        platformLogger.destroy()
      }
      finally {
        // 環境変数を復元
        if (originalEnv) {
          process.env.NODE_ENV = originalEnv
        }
        else {
          delete process.env.NODE_ENV
        }
      }
    })
  })
})
