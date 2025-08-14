/**
 * データベース接続管理
 * 
 * Drizzle ORM + better-sqlite3を使用したSQLiteデータベース接続の
 * 一元管理、接続プール、エラーハンドリングを提供します。
 */

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { 
  handleDatabaseError, 
  executeWithRetry, 
  DatabaseErrorHandler
} from './utils/error-handler'
import { 
  runDatabaseMigrations, 
  type MigrationConfig, 
  type MigrationResult 
} from './utils/migration-runner'
import { schema } from './schema'

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
 * データベース接続プール管理クラス
 */
class DatabaseConnectionPool {
  private connections: Map<string, Database.Database> = new Map()
  private connectionInfos: Map<string, DatabaseConnectionInfo> = new Map()
  private readonly maxConnections: number
  private readonly connectionTimeout: number

  constructor(maxConnections: number = 10, connectionTimeout: number = 30000) {
    this.maxConnections = maxConnections
    this.connectionTimeout = connectionTimeout
  }

  /**
   * 接続を取得または作成
   */
  async getConnection(filePath: string, config: DatabaseConfig): Promise<Database.Database> {
    const key = this.getConnectionKey(filePath, config.environment)
    
    let connection = this.connections.get(key)
    if (connection && connection.open) {
      this.updateConnectionInfo(key, { connectionCount: this.getConnectionInfo(key).connectionCount + 1 })
      return connection
    }

    // 新しい接続を作成
    if (this.connections.size >= this.maxConnections) {
      await this.cleanupIdleConnections()
      if (this.connections.size >= this.maxConnections) {
        throw new Error(`最大接続数に達しました (${this.maxConnections})`)
      }
    }

    connection = await this.createConnection(filePath, config)
    this.connections.set(key, connection)
    
    // 接続情報を初期化
    this.connectionInfos.set(key, {
      filePath,
      environment: config.environment,
      isConnected: true,
      connectionCount: 1,
      lastConnectedAt: new Date(),
      performance: {
        averageQueryTime: 0,
        queryCount: 0,
        slowQueryCount: 0
      }
    })

    return connection
  }

  /**
   * 新しいデータベース接続を作成
   */
  private async createConnection(filePath: string, config: DatabaseConfig): Promise<Database.Database> {
    try {
      const connection = new Database(filePath, {
        readonly: false,
        fileMustExist: false, // ファイルが存在しない場合は自動作成
        timeout: config.connectionTimeout || this.connectionTimeout,
        verbose: config.enableLogging ? console.log : undefined
      })

      // SQLite設定の適用
      await this.configureSQLite(connection, config)

      return connection
    } catch (error) {
      const dbError = handleDatabaseError(error, {
        operation: 'createConnection',
        filePath
      })
      throw new Error(`データベース接続の作成に失敗しました: ${dbError.message}`)
    }
  }

  /**
   * SQLite設定を適用
   */
  private async configureSQLite(connection: Database.Database, config: DatabaseConfig): Promise<void> {
    try {
      // WALモードの有効化（パフォーマンス向上）
      if (config.enableWAL !== false && config.environment !== 'test') {
        connection.exec('PRAGMA journal_mode = WAL')
      }

      // 外部キー制約の有効化
      if (config.enableForeignKeys !== false) {
        connection.exec('PRAGMA foreign_keys = ON')
      }

      // ビジータイムアウトの設定
      if (config.busyTimeout) {
        connection.exec(`PRAGMA busy_timeout = ${config.busyTimeout}`)
      }

      // キャッシュサイズの設定
      if (config.cacheSize) {
        connection.exec(`PRAGMA cache_size = ${config.cacheSize}`)
      }

      // 同期モードの設定
      if (config.enableSynchronous) {
        connection.exec(`PRAGMA synchronous = ${config.enableSynchronous}`)
      }

      // パフォーマンス最適化設定
      if (config.environment === 'production') {
        connection.exec('PRAGMA optimize')
      }

    } catch (error) {
      const dbError = handleDatabaseError(error, {
        operation: 'configureSQLite'
      })
      console.warn(`SQLite設定の適用中に警告: ${dbError.message}`)
    }
  }

  /**
   * アイドル状態の接続をクリーンアップ
   */
  private async cleanupIdleConnections(): Promise<void> {
    const now = Date.now()
    const idleTimeout = this.connectionTimeout

    for (const [key, info] of this.connectionInfos.entries()) {
      if (info.lastConnectedAt && (now - info.lastConnectedAt.getTime()) > idleTimeout) {
        await this.closeConnection(key)
      }
    }
  }

  /**
   * 特定の接続を閉じる
   */
  async closeConnection(key: string): Promise<void> {
    const connection = this.connections.get(key)
    if (connection) {
      try {
        connection.close()
      } catch (error) {
        console.warn(`接続のクローズ中にエラー: ${error}`)
      }
      this.connections.delete(key)
    }
    
    const info = this.connectionInfos.get(key)
    if (info) {
      info.isConnected = false
      this.connectionInfos.set(key, info)
    }
  }

  /**
   * すべての接続を閉じる
   */
  async closeAllConnections(): Promise<void> {
    const promises = Array.from(this.connections.keys()).map(key => this.closeConnection(key))
    await Promise.all(promises)
  }

  /**
   * 接続キーを生成
   */
  private getConnectionKey(filePath: string, environment: DatabaseEnvironment): string {
    return `${filePath}:${environment}`
  }

  /**
   * 接続情報を取得
   */
  getConnectionInfo(key: string): DatabaseConnectionInfo {
    return this.connectionInfos.get(key) || {
      filePath: '',
      environment: 'development',
      isConnected: false,
      connectionCount: 0,
      performance: {
        averageQueryTime: 0,
        queryCount: 0,
        slowQueryCount: 0
      }
    }
  }

  /**
   * 接続情報を更新
   */
  updateConnectionInfo(key: string, updates: Partial<DatabaseConnectionInfo>): void {
    const current = this.getConnectionInfo(key)
    this.connectionInfos.set(key, { ...current, ...updates })
  }

  /**
   * すべての接続情報を取得
   */
  getAllConnectionInfos(): DatabaseConnectionInfo[] {
    return Array.from(this.connectionInfos.values())
  }
}

/**
 * メインのデータベース管理クラス
 */
export class DatabaseManager {
  private static instance: DatabaseManager
  private pool: DatabaseConnectionPool
  private currentConnection: Database.Database | undefined = undefined
  private currentDrizzle: ReturnType<typeof drizzle> | undefined = undefined
  private config: DatabaseConfig
  private isInitialized = false

  private constructor() {
    this.pool = new DatabaseConnectionPool()
    this.config = this.getDefaultConfig()
  }

  /**
   * シングルトンインスタンスを取得
   */
  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager()
    }
    return DatabaseManager.instance
  }

  /**
   * デフォルト設定を取得
   */
  private getDefaultConfig(): DatabaseConfig {
    const environment = this.detectEnvironment()
    
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
      enableLogging: environment === 'development'
    }
  }

  /**
   * 環境を自動検出
   */
  private detectEnvironment(): DatabaseEnvironment {
    if (process.env.NODE_ENV === 'test') return 'test'
    if (process.env.NODE_ENV === 'development') return 'development'
    return 'production'
  }

  /**
   * データベースの初期化
   */
  public async initialize(config?: Partial<DatabaseConfig>): Promise<void> {
    if (this.isInitialized) {
      return
    }

    try {
      // 設定をマージ
      this.config = { ...this.config, ...config }
      
      // データベースファイルパスを決定
      const dbPath = this.config.customPath || this.getDefaultDatabasePath(this.config.environment)
      
      // ディレクトリの作成（必要な場合）
      await this.ensureDirectoryExists(path.dirname(dbPath))
      
      // データベースファイルの存在確認
      const isNewDatabase = dbPath !== ':memory:' && !fs.existsSync(dbPath)
      if (isNewDatabase) {
        console.log(`📄 新規データベースファイルを作成します: ${dbPath}`)
      }
      
      // ファイル権限とディスク容量のチェック
      await this.validateDatabaseEnvironment(dbPath)
      
      // データベース接続を取得
      this.currentConnection = await executeWithRetry(
        () => this.pool.getConnection(dbPath, this.config),
        3,
        1000
      )
      
      // Drizzle ORMインスタンスを作成
      this.currentDrizzle = drizzle(this.currentConnection, { schema })
      
      // マイグレーションを実行（設定されている場合）
      if (this.config.enableMigrations) {
        await this.runMigrations()
      }
      
      this.isInitialized = true
      
      console.log(`データベースが初期化されました: ${dbPath} (環境: ${this.config.environment})`)
      
    } catch (error) {
      const dbError = handleDatabaseError(error, {
        operation: 'initialize',
        filePath: this.config.customPath || this.getDefaultDatabasePath(this.config.environment)
      })
      throw new Error(`データベースの初期化に失敗しました: ${dbError.message}`)
    }
  }

  /**
   * デフォルトのデータベースパスを取得
   */
  private getDefaultDatabasePath(environment: DatabaseEnvironment): string {
    switch (environment) {
      case 'test':
        return ':memory:' // メモリ内データベース
      case 'development':
        return path.join(process.cwd(), 'dev-database.sqlite3')
      case 'production':
        const configDir = path.join(os.homedir(), '.config', 'project-lens')
        return path.join(configDir, 'database.sqlite3')
      default:
        throw new Error(`不明な環境: ${environment}`)
    }
  }

  /**
   * ディレクトリの存在を確認し、必要に応じて作成
   */
  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    if (dirPath === ':memory:' || dirPath === '') {
      return
    }

    try {
      await executeWithRetry(async () => {
        if (!fs.existsSync(dirPath)) {
          await fs.promises.mkdir(dirPath, { recursive: true })
        }
      })
    } catch (error) {
      const dbError = handleDatabaseError(error, {
        operation: 'ensureDirectoryExists',
        filePath: dirPath
      })
      throw new Error(`ディレクトリの作成に失敗しました: ${dbError.message}`)
    }
  }

  /**
   * データベース環境の検証
   */
  private async validateDatabaseEnvironment(dbPath: string): Promise<void> {
    if (dbPath === ':memory:') {
      return // メモリ内データベースはスキップ
    }

    try {
      // ファイルまたはディレクトリの権限をチェック
      const checkPath = fs.existsSync(dbPath) ? dbPath : path.dirname(dbPath)
      const permissions = await DatabaseErrorHandler.checkFilePermissions(checkPath)
      if (!permissions.writable) {
        throw new Error('データベースファイルまたはディレクトリに書き込み権限がありません')
      }

      // ディスク容量のチェック（本番環境のみ）
      if (this.config.environment === 'production') {
        const diskSpace = await DatabaseErrorHandler.checkDiskSpace(dbPath)
        const minRequiredSpace = 100 * 1024 * 1024 // 100MB
        
        if (diskSpace.available < minRequiredSpace) {
          console.warn(`ディスク容量が不足しています: 利用可能 ${Math.round(diskSpace.available / 1024 / 1024)}MB`)
        }
      }
    } catch (error) {
      const dbError = handleDatabaseError(error, {
        operation: 'validateDatabaseEnvironment',
        filePath: dbPath
      })
      
      // 重大なエラーの場合は例外を発生、そうでなければ警告
      if (dbError.severity === 'critical' || dbError.severity === 'high') {
        throw new Error(`データベース環境の検証に失敗しました: ${dbError.message}`)
      } else {
        console.warn(`データベース環境の検証中に警告: ${dbError.message}`)
      }
    }
  }

  /**
   * マイグレーションを実行
   */
  private async runMigrations(): Promise<MigrationResult> {
    if (!this.currentConnection) {
      throw new Error('データベース接続が初期化されていません')
    }

    const migrationConfig: MigrationConfig = {
      migrationsFolder: path.join(process.cwd(), 'drizzle'),
      tableName: '__drizzle_migrations',
      timeout: 60000, // 1分
      createBackup: this.config.environment === 'production',
      ...this.config.migrationConfig
    }

    try {
      return await runDatabaseMigrations(this.currentConnection, migrationConfig)
    } catch (error) {
      const dbError = handleDatabaseError(error, {
        operation: 'runMigrations'
      })
      throw new Error(`マイグレーションの実行に失敗しました: ${dbError.message}`)
    }
  }

  /**
   * Drizzle ORMインスタンスを取得
   */
  public getDrizzle(): ReturnType<typeof drizzle> {
    if (!this.currentDrizzle) {
      throw new Error('データベースが初期化されていません。initialize()を先に実行してください。')
    }
    return this.currentDrizzle
  }

  /**
   * 生のSQLiteインスタンスを取得（特殊な操作用）
   */
  public getRawConnection(): Database.Database {
    if (!this.currentConnection) {
      throw new Error('データベース接続が初期化されていません。initialize()を先に実行してください。')
    }
    return this.currentConnection
  }

  /**
   * データベースの状態情報を取得
   */
  public getStatus(): {
    isInitialized: boolean
    environment: DatabaseEnvironment
    connectionInfo: DatabaseConnectionInfo | undefined
    performance: {
      queryCount: number
      averageQueryTime: number
      slowQueryCount: number
    }
  } {
    const connectionInfos = this.pool.getAllConnectionInfos()
    const primaryConnection = connectionInfos[0]

    return {
      isInitialized: this.isInitialized,
      environment: this.config.environment,
      connectionInfo: primaryConnection,
      performance: primaryConnection?.performance || {
        queryCount: 0,
        averageQueryTime: 0,
        slowQueryCount: 0
      }
    }
  }

  /**
   * パフォーマンス統計を更新
   */
  public updatePerformanceStats(queryTime: number): void {
    if (!this.currentConnection) return

    const key = `${this.currentConnection.name || ''}:${this.config.environment}`
    const info = this.pool.getConnectionInfo(key)
    
    const newQueryCount = info.performance.queryCount + 1
    const newAverage = ((info.performance.averageQueryTime * info.performance.queryCount) + queryTime) / newQueryCount
    const newSlowQueryCount = queryTime > 50 ? info.performance.slowQueryCount + 1 : info.performance.slowQueryCount

    this.pool.updateConnectionInfo(key, {
      performance: {
        queryCount: newQueryCount,
        averageQueryTime: newAverage,
        slowQueryCount: newSlowQueryCount
      }
    })
  }

  /**
   * データベース接続をクリーンアップ
   */
  public async cleanup(): Promise<void> {
    try {
      await this.pool.closeAllConnections()
      this.currentConnection = undefined
      this.currentDrizzle = undefined
      this.isInitialized = false
      console.log('データベース接続をクリーンアップしました')
    } catch (error) {
      console.error('データベースクリーンアップ中にエラー:', error)
    }
  }

  /**
   * データベース接続をテスト
   */
  public async testConnection(): Promise<boolean> {
    try {
      if (!this.currentConnection) {
        return false
      }
      
      const startTime = Date.now()
      this.currentConnection.exec('SELECT 1')
      const endTime = Date.now()
      
      this.updatePerformanceStats(endTime - startTime)
      return true
    } catch (error) {
      const dbError = handleDatabaseError(error, {
        operation: 'testConnection'
      })
      console.error(`データベース接続テストに失敗: ${dbError.message}`)
      return false
    }
  }

  /**
   * データベースのヘルスチェックを実行
   */
  public async healthCheck(): Promise<{
    isHealthy: boolean
    checks: {
      connection: boolean
      diskSpace: boolean
      permissions: boolean
      performance: boolean
    }
    issues: string[]
  }> {
    const issues: string[] = []
    const checks = {
      connection: false,
      diskSpace: false,
      permissions: false,
      performance: false
    }

    try {
      // 接続テスト
      checks.connection = await this.testConnection()
      if (!checks.connection) {
        issues.push('データベース接続が失敗しました')
      }

      // パフォーマンスチェック
      const status = this.getStatus()
      checks.performance = status.performance.averageQueryTime < 100 // 100ms未満
      if (!checks.performance) {
        issues.push(`クエリの平均実行時間が遅いです: ${status.performance.averageQueryTime.toFixed(2)}ms`)
      }

      // ディスク容量と権限チェック（本番環境のみ）
      if (this.config.environment === 'production' && this.currentConnection?.name) {
        try {
          const diskSpace = await DatabaseErrorHandler.checkDiskSpace(this.currentConnection.name)
          checks.diskSpace = diskSpace.available > 50 * 1024 * 1024 // 50MB以上
          if (!checks.diskSpace) {
            issues.push('ディスク容量が不足しています')
          }

          const permissions = await DatabaseErrorHandler.checkFilePermissions(this.currentConnection.name)
          checks.permissions = permissions.readable && permissions.writable
          if (!checks.permissions) {
            issues.push('ファイル権限に問題があります')
          }
        } catch (error) {
          issues.push(`ヘルスチェック中にエラー: ${error instanceof Error ? error.message : String(error)}`)
        }
      } else {
        // 本番以外はチェックをスキップ
        checks.diskSpace = true
        checks.permissions = true
      }

      return {
        isHealthy: Object.values(checks).every(Boolean) && issues.length === 0,
        checks,
        issues
      }
    } catch (error) {
      issues.push(`ヘルスチェックの実行中にエラー: ${error instanceof Error ? error.message : String(error)}`)
      return {
        isHealthy: false,
        checks,
        issues
      }
    }
  }
}

// ====================
// ユーティリティ関数
// ====================

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
  queryFn: (db: ReturnType<typeof drizzle>) => Promise<T>
): Promise<T> {
  const db = getDatabase()
  const drizzleDb = db.getDrizzle()
  
  const startTime = Date.now()
  try {
    const result = await queryFn(drizzleDb)
    const endTime = Date.now()
    db.updatePerformanceStats(endTime - startTime)
    return result
  } catch (error) {
    const endTime = Date.now()
    db.updatePerformanceStats(endTime - startTime)
    throw error
  }
}

/**
 * トランザクション実行
 */
export async function executeTransaction<T>(
  transactionFn: (tx: Parameters<Parameters<ReturnType<typeof drizzle>['transaction']>[0]>[0]) => Promise<T>
): Promise<T> {
  const db = getDatabase()
  const drizzleDb = db.getDrizzle()
  
  const startTime = Date.now()
  try {
    const result = await drizzleDb.transaction(transactionFn)
    const endTime = Date.now()
    db.updatePerformanceStats(endTime - startTime)
    return result
  } catch (error) {
    const endTime = Date.now()
    db.updatePerformanceStats(endTime - startTime)
    throw error
  }
}

export default DatabaseManager
