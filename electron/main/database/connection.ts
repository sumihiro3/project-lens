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
  const db = getDatabase()
  await db.initialize(config)
  return db.getDrizzle()
}

/**
 * パフォーマンス計測付きのクエリ実行
 */
export async function executeQuery<T>(
  queryFn: (db: ReturnType<typeof drizzle>) => Promise<T>,
): Promise<T> {
  const db = getDatabase()
  const drizzleDb = db.getDrizzle()

  const startTime = Date.now()
  try {
    const result = await queryFn(drizzleDb)
    const endTime = Date.now()
    db.updatePerformanceStats(endTime - startTime)
    return result
  }
  catch (error) {
    const endTime = Date.now()
    db.updatePerformanceStats(endTime - startTime)
    throw error
  }
}

/**
 * トランザクション実行
 */
export async function executeTransaction<T>(
  transactionFn: (tx: Parameters<Parameters<ReturnType<typeof drizzle>['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  const db = getDatabase()
  const drizzleDb = db.getDrizzle()

  const startTime = Date.now()
  try {
    const result = await drizzleDb.transaction(transactionFn)
    const endTime = Date.now()
    db.updatePerformanceStats(endTime - startTime)
    return result
  }
  catch (error) {
    const endTime = Date.now()
    db.updatePerformanceStats(endTime - startTime)
    throw error
  }
}

export default DatabaseManager
