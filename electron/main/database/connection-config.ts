/**
 * データベース設定管理
 *
 * データベース接続設定、環境検知、デフォルト設定の管理を提供します。
 */

import * as path from 'path'
import * as os from 'os'
import type { MigrationConfig } from './utils/migration-runner'

/**
 * データベース環境設定
 */
export type DatabaseEnvironment = 'production' | 'development' | 'test'

/**
 * データベース接続設定
 */
export interface DatabaseConfig {
  environment: DatabaseEnvironment
  customPath?: string
  enableWAL?: boolean
  enableForeignKeys?: boolean
  busyTimeout?: number
  cacheSize?: number
  enableSynchronous?: 'OFF' | 'NORMAL' | 'FULL'
  enableMigrations?: boolean
  migrationConfig?: MigrationConfig
  maxConnections?: number
  connectionTimeout?: number
  enableLogging?: boolean
}

/**
 * データベース接続情報
 */
export interface DatabaseConnectionInfo {
  filePath: string
  environment: DatabaseEnvironment
  isConnected: boolean
  connectionCount: number
  lastConnectedAt?: Date
  lastErrorAt?: Date
  performance: {
    averageQueryTime: number
    queryCount: number
    slowQueryCount: number
  }
}

/**
 * 環境を自動検出
 */
export function detectEnvironment(): DatabaseEnvironment {
  if (process.env.NODE_ENV === 'test') return 'test'
  if (process.env.NODE_ENV === 'development') return 'development'
  return 'production'
}

/**
 * デフォルト設定を取得
 */
export function getDefaultConfig(): DatabaseConfig {
  const environment = detectEnvironment()

  return {
    environment,
    enableWAL: environment !== 'test',
    enableForeignKeys: true,
    busyTimeout: 5000,
    cacheSize: -2000, // 2MB
    enableSynchronous: environment === 'production' ? 'NORMAL' : 'OFF',
    enableMigrations: true,
    maxConnections: 5,
    connectionTimeout: 30000,
    enableLogging: environment === 'development',
  }
}

/**
 * デフォルトのデータベースパスを取得
 */
export function getDefaultDatabasePath(environment: DatabaseEnvironment): string {
  switch (environment) {
    case 'test':
      return ':memory:' // メモリ内データベース
    case 'development':
      return path.join(process.cwd(), 'dev-database.sqlite3')
    case 'production': {
      const configDir = path.join(os.homedir(), '.config', 'project-lens')
      return path.join(configDir, 'database.sqlite3')
    }
    default:
      throw new Error(`不明な環境: ${environment}`)
  }
}

/**
 * 設定の妥当性を検証
 */
export function validateConfig(config: DatabaseConfig): void {
  if (!config.environment) {
    throw new Error('environment は必須です')
  }

  if (config.maxConnections && config.maxConnections < 1) {
    throw new Error('maxConnections は1以上である必要があります')
  }

  if (config.connectionTimeout && config.connectionTimeout < 1000) {
    throw new Error('connectionTimeout は1000ms以上である必要があります')
  }

  if (config.busyTimeout && config.busyTimeout < 0) {
    throw new Error('busyTimeout は0以上である必要があります')
  }

  if (config.cacheSize && config.cacheSize === 0) {
    throw new Error('cacheSize は0以外の値である必要があります')
  }
}

/**
 * 設定をマージ
 */
export function mergeConfig(baseConfig: DatabaseConfig, overrides: Partial<DatabaseConfig>): DatabaseConfig {
  const merged = { ...baseConfig, ...overrides }
  validateConfig(merged)
  return merged
}

/**
 * データベース設定管理ユーティリティの互換性ラッパー
 */
export const DatabaseConfigManager = {
  detectEnvironment,
  getDefaultConfig,
  getDefaultDatabasePath,
  validateConfig,
  mergeConfig,
}
