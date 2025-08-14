/**
 * データベース接続管理
 *
 * Drizzle ORM + better-sqlite3を使用したSQLiteデータベース接続の
 * 一元管理、接続プール、エラーハンドリングを提供します。
 *
 * このファイルは互換性のためのメインエクスポートファイルです。
 * 実際の実装は分割された以下のモジュールに移動されています：
 * - connection-manager.ts: 接続管理とプール管理
 * - connection-config.ts: 設定管理
 * - health-checker.ts: ヘルスチェックとモニタリング
 */

import type { drizzle } from 'drizzle-orm/better-sqlite3'
import type { DatabaseConfig } from './connection-config'
import { Logger, withAsyncPerformance } from '../utils/logger'

// ====================
// ユーティリティ関数
// ====================

import { DatabaseManager } from './connection-manager'

// 分割されたモジュールからのインポート
export {
  DatabaseManager,
  DatabaseConnectionPool,
} from './connection-manager'

export {
  DatabaseConfigManager,
  detectEnvironment,
  getDefaultConfig,
  getDefaultDatabasePath,
  validateConfig,
  mergeConfig,
} from './connection-config'

export {
  DatabaseHealthChecker,
} from './health-checker'

export type {
  DatabaseConfig,
  DatabaseConnectionInfo,
  DatabaseEnvironment,
} from './connection-config'

export type {
  HealthCheckResult,
  PerformanceStats,
} from './health-checker'

/**
 * グローバルなデータベースインスタンスを取得
 */
export function getDatabase(): DatabaseManager {
  return DatabaseManager.getInstance()
}

/**
 * データベースを初期化し、Drizzleインスタンスを取得
 */
export async function initializeDatabase(config?: Partial<DatabaseConfig>): Promise<ReturnType<typeof drizzle>> {
  const logger = Logger.getInstance()

  return await withAsyncPerformance('database.initializeDatabase', async () => {
    logger.info('データベース初期化を開始します', {
      hasCustomConfig: !!config,
      environment: config?.environment || 'default',
    })

    try {
      const db = getDatabase()
      await db.initialize(config)
      const drizzleInstance = db.getDrizzle()

      logger.info('データベース初期化が完了しました', {
        environment: config?.environment || 'default',
        status: 'success',
      })

      return drizzleInstance
    }
    catch (error) {
      logger.error('データベース初期化に失敗しました', error as Error, {
        environment: config?.environment || 'default',
        customConfig: config,
      })
      throw error
    }
  })
}

/**
 * パフォーマンス計測付きのクエリ実行
 */
export async function executeQuery<T>(
  queryFn: (db: ReturnType<typeof drizzle>) => Promise<T>,
): Promise<T> {
  const logger = Logger.getInstance()
  const db = getDatabase()
  const drizzleDb = db.getDrizzle()

  return await withAsyncPerformance('database.executeQuery', async () => {
    const startTime = Date.now()

    try {
      logger.debug('データベースクエリの実行を開始します')

      const result = await queryFn(drizzleDb)
      const endTime = Date.now()
      const queryTime = endTime - startTime

      db.updatePerformanceStats(queryTime)

      logger.debug('データベースクエリが正常に完了しました', {
        queryTime,
        status: 'success',
      })

      if (queryTime > 1000) {
        logger.warn('低速なクエリが検出されました', {
          queryTime,
          threshold: 1000,
        })
      }

      return result
    }
    catch (error) {
      const endTime = Date.now()
      const queryTime = endTime - startTime

      db.updatePerformanceStats(queryTime)

      logger.error('データベースクエリの実行中にエラーが発生しました', error as Error, {
        queryTime,
        status: 'failed',
      })

      throw error
    }
  })
}

/**
 * トランザクション実行
 */
export async function executeTransaction<T>(
  transactionFn: (tx: Parameters<Parameters<ReturnType<typeof drizzle>['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  const logger = Logger.getInstance()
  const db = getDatabase()
  const drizzleDb = db.getDrizzle()

  return await withAsyncPerformance('database.executeTransaction', async () => {
    const startTime = Date.now()

    try {
      logger.debug('データベーストランザクションの実行を開始します')

      const result = await drizzleDb.transaction(transactionFn)
      const endTime = Date.now()
      const transactionTime = endTime - startTime

      db.updatePerformanceStats(transactionTime)

      logger.info('データベーストランザクションが正常に完了しました', {
        transactionTime,
        status: 'committed',
      })

      if (transactionTime > 2000) {
        logger.warn('長時間実行されたトランザクションが検出されました', {
          transactionTime,
          threshold: 2000,
        })
      }

      return result
    }
    catch (error) {
      const endTime = Date.now()
      const transactionTime = endTime - startTime

      db.updatePerformanceStats(transactionTime)

      logger.error('データベーストランザクションでエラーが発生しました', error as Error, {
        transactionTime,
        status: 'rolled_back',
      })

      throw error
    }
  })
}

export default DatabaseManager
