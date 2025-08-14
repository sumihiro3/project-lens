/**
 * データベース接続管理
 *
 * データベース接続プールの管理、接続の作成・管理・クリーンアップを提供します。
 */

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { Logger, withAsyncPerformance } from '../utils/logger'
import {
  handleDatabaseError,
  executeWithRetry,
  DatabaseErrorHandler,
} from './utils/error-handler'
import {
  runDatabaseMigrations,
  type MigrationConfig,
  type MigrationResult,
} from './utils/migration-runner'
import { schema } from './schema'
import {
  getDefaultConfig,
  getDefaultDatabasePath,
  mergeConfig,
} from './connection-config'
import type {
  DatabaseConfig,
  DatabaseConnectionInfo,
  DatabaseEnvironment,
} from './connection-config'
import { DatabaseHealthChecker, type HealthCheckResult } from './health-checker'

/**
 * データベース接続プール管理クラス
 */
export class DatabaseConnectionPool {
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
    const logger = Logger.getInstance()
    const key = this.getConnectionKey(filePath, config.environment)

    return await withAsyncPerformance('database.getConnection', async () => {
      logger.debug('データベース接続の取得を開始', {
        filePath,
        environment: config.environment,
        connectionKey: key,
      })

      let connection = this.connections.get(key)
      if (connection && connection.open) {
        this.updateConnectionInfo(key, { connectionCount: this.getConnectionInfo(key).connectionCount + 1 })
        logger.debug('既存のデータベース接続を再利用', {
          connectionKey: key,
          connectionCount: this.getConnectionInfo(key).connectionCount,
        })
        return connection
      }

      // 新しい接続を作成
      if (this.connections.size >= this.maxConnections) {
        logger.warn('最大接続数に近づいています。アイドル接続をクリーンアップします', {
          currentConnections: this.connections.size,
          maxConnections: this.maxConnections,
        })
        await this.cleanupIdleConnections()
        if (this.connections.size >= this.maxConnections) {
          const error = new Error(`最大接続数に達しました (${this.maxConnections})`)
          logger.error('データベース接続プールが満杯です', error, {
            currentConnections: this.connections.size,
            maxConnections: this.maxConnections,
          })
          throw error
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
          slowQueryCount: 0,
        },
      })

      logger.info('新しいデータベース接続を作成しました', {
        filePath,
        environment: config.environment,
        connectionKey: key,
        totalConnections: this.connections.size,
      })

      return connection
    })
  }

  /**
   * 新しいデータベース接続を作成
   */
  private async createConnection(filePath: string, config: DatabaseConfig): Promise<Database.Database> {
    const logger = Logger.getInstance()
    const startTime = Date.now()

    try {
      logger.debug('データベース接続の作成を開始', {
        filePath,
        environment: config.environment,
        readonly: false,
        timeout: config.connectionTimeout || this.connectionTimeout,
      })

      const connection = new Database(filePath, {
        readonly: false,
        fileMustExist: false, // ファイルが存在しない場合は自動作成
        timeout: config.connectionTimeout || this.connectionTimeout,
        verbose: config.enableLogging ? console.log : undefined,
      })

      // SQLite設定の適用
      await this.configureSQLite(connection, config)

      const connectionTime = Date.now() - startTime
      logger.info('データベース接続を正常に作成しました', {
        filePath,
        environment: config.environment,
        connectionTime,
        isOpen: connection.open,
      })

      return connection
    }
    catch (error) {
      const connectionTime = Date.now() - startTime
      const dbError = handleDatabaseError(error, {
        operation: 'createConnection',
        filePath,
      })

      logger.error('データベース接続の作成に失敗しました', error as Error, {
        filePath,
        environment: config.environment,
        connectionTime,
        errorType: dbError.type,
        severity: dbError.severity,
      })

      throw new Error(`データベース接続の作成に失敗しました: ${dbError.message}`)
    }
  }

  /**
   * SQLite設定を適用
   */
  private async configureSQLite(connection: Database.Database, config: DatabaseConfig): Promise<void> {
    const logger = Logger.getInstance()

    try {
      logger.debug('SQLite設定の適用を開始', {
        environment: config.environment,
        enableWAL: config.enableWAL !== false && config.environment !== 'test',
        enableForeignKeys: config.enableForeignKeys !== false,
        busyTimeout: config.busyTimeout,
        cacheSize: config.cacheSize,
      })

      // WALモードの有効化（パフォーマンス向上）
      if (config.enableWAL !== false && config.environment !== 'test') {
        connection.exec('PRAGMA journal_mode = WAL')
        logger.debug('WALモードを有効化しました')
      }

      // 外部キー制約の有効化
      if (config.enableForeignKeys !== false) {
        connection.exec('PRAGMA foreign_keys = ON')
        logger.debug('外部キー制約を有効化しました')
      }

      // ビジータイムアウトの設定
      if (config.busyTimeout) {
        connection.exec(`PRAGMA busy_timeout = ${config.busyTimeout}`)
        logger.debug('ビジータイムアウトを設定しました', { busyTimeout: config.busyTimeout })
      }

      // キャッシュサイズの設定
      if (config.cacheSize) {
        connection.exec(`PRAGMA cache_size = ${config.cacheSize}`)
        logger.debug('キャッシュサイズを設定しました', { cacheSize: config.cacheSize })
      }

      // 同期モードの設定
      if (config.enableSynchronous) {
        connection.exec(`PRAGMA synchronous = ${config.enableSynchronous}`)
        logger.debug('同期モードを設定しました', { synchronous: config.enableSynchronous })
      }

      // パフォーマンス最適化設定
      if (config.environment === 'production') {
        connection.exec('PRAGMA optimize')
        logger.debug('本番環境向け最適化設定を適用しました')
      }

      logger.info('SQLite設定の適用が完了しました', {
        environment: config.environment,
        walEnabled: config.enableWAL !== false && config.environment !== 'test',
        foreignKeysEnabled: config.enableForeignKeys !== false,
      })
    }
    catch (error) {
      const dbError = handleDatabaseError(error, {
        operation: 'configureSQLite',
      })

      logger.warn('SQLite設定の適用中に警告が発生しました', {
        errorType: dbError.type,
        severity: dbError.severity,
        message: dbError.message,
        recoverable: dbError.recoverable,
      })
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
    const logger = Logger.getInstance()
    const connection = this.connections.get(key)
    const connectionInfo = this.connectionInfos.get(key)

    if (connection) {
      try {
        logger.debug('データベース接続を閉じています', {
          connectionKey: key,
          filePath: connectionInfo?.filePath,
          environment: connectionInfo?.environment,
          connectionCount: connectionInfo?.connectionCount,
        })

        connection.close()
        this.connections.delete(key)

        logger.info('データベース接続を正常に閉じました', {
          connectionKey: key,
          remainingConnections: this.connections.size,
        })
      }
      catch (error) {
        logger.warn('接続のクローズ中にエラーが発生しました', {
          connectionKey: key,
          error: error instanceof Error ? error.message : String(error),
        })
      }
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
    const logger = Logger.getInstance()
    const connectionCount = this.connections.size

    logger.info('すべてのデータベース接続を閉じています', {
      totalConnections: connectionCount,
    })

    const promises = Array.from(this.connections.keys()).map(key => this.closeConnection(key))
    await Promise.all(promises)

    logger.info('すべてのデータベース接続を閉じました', {
      closedConnections: connectionCount,
    })
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
        slowQueryCount: 0,
      },
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
  private healthChecker: DatabaseHealthChecker

  private constructor() {
    this.pool = new DatabaseConnectionPool()
    this.config = getDefaultConfig()
    this.healthChecker = new DatabaseHealthChecker(this.currentConnection, this.config)
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
   * データベースの初期化
   */
  public async initialize(config?: Partial<DatabaseConfig>): Promise<void> {
    const logger = Logger.getInstance()

    if (this.isInitialized) {
      logger.debug('データベースは既に初期化済みです')
      return
    }

    const startTime = Date.now()

    return await withAsyncPerformance('database.initialize', async () => {
      try {
        logger.info('データベースの初期化を開始します', {
          environment: this.config.environment,
          customPath: config?.customPath,
        })

        // 設定をマージ
        this.config = mergeConfig(this.config, config || {})

        // データベースファイルパスを決定
        const dbPath = this.config.customPath || getDefaultDatabasePath(this.config.environment)

        logger.debug('データベースファイルパスを決定しました', {
          dbPath,
          isCustomPath: !!this.config.customPath,
          environment: this.config.environment,
        })

        // ディレクトリの作成（必要な場合）
        await this.ensureDirectoryExists(path.dirname(dbPath))

        // データベースファイルの存在確認
        const isNewDatabase = dbPath !== ':memory:' && !fs.existsSync(dbPath)
        if (isNewDatabase) {
          logger.info('新規データベースファイルを作成します', { dbPath })
        }
        else if (dbPath !== ':memory:') {
          logger.debug('既存のデータベースファイルを使用します', { dbPath })
        }

        // ファイル権限とディスク容量のチェック
        await this.validateDatabaseEnvironment(dbPath)

        // データベース接続を取得
        this.currentConnection = await executeWithRetry(
          () => this.pool.getConnection(dbPath, this.config),
          3,
          1000,
        )

        // Drizzle ORMインスタンスを作成
        this.currentDrizzle = drizzle(this.currentConnection, { schema })
        logger.debug('Drizzle ORMインスタンスを作成しました')

        // ヘルスチェッカーを更新
        this.healthChecker.updateConnection(this.currentConnection)
        this.healthChecker.updateConfig(this.config)

        // マイグレーションを実行（設定されている場合）
        if (this.config.enableMigrations) {
          logger.info('データベースマイグレーションを実行します')
          await this.runMigrations()
        }

        this.isInitialized = true
        const initTime = Date.now() - startTime

        logger.info('データベースの初期化が完了しました', {
          dbPath,
          environment: this.config.environment,
          initTime,
          isNewDatabase,
          migrationsEnabled: this.config.enableMigrations,
        })
      }
      catch (error) {
        const initTime = Date.now() - startTime
        const dbPath = this.config.customPath || getDefaultDatabasePath(this.config.environment)
        const dbError = handleDatabaseError(error, {
          operation: 'initialize',
          filePath: dbPath,
        })

        logger.error('データベースの初期化に失敗しました', error as Error, {
          dbPath,
          environment: this.config.environment,
          initTime,
          errorType: dbError.type,
          severity: dbError.severity,
          recoverable: dbError.recoverable,
        })

        throw new Error(`データベースの初期化に失敗しました: ${dbError.message}`)
      }
    })
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
    }
    catch (error) {
      const dbError = handleDatabaseError(error, {
        operation: 'ensureDirectoryExists',
        filePath: dirPath,
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
    }
    catch (error) {
      const dbError = handleDatabaseError(error, {
        operation: 'validateDatabaseEnvironment',
        filePath: dbPath,
      })

      // 重大なエラーの場合は例外を発生、そうでなければ警告
      if (dbError.severity === 'critical' || dbError.severity === 'high') {
        throw new Error(`データベース環境の検証に失敗しました: ${dbError.message}`)
      }
      else {
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
      ...this.config.migrationConfig,
    }

    try {
      return await runDatabaseMigrations(this.currentConnection, migrationConfig)
    }
    catch (error) {
      const dbError = handleDatabaseError(error, {
        operation: 'runMigrations',
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
        slowQueryCount: 0,
      },
    }
  }

  /**
   * パフォーマンス統計を更新
   */
  public updatePerformanceStats(queryTime: number): void {
    this.healthChecker.updatePerformanceStats(queryTime)

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
        slowQueryCount: newSlowQueryCount,
      },
    })
  }

  /**
   * データベース接続をクリーンアップ
   */
  public async cleanup(): Promise<void> {
    const logger = Logger.getInstance()

    try {
      logger.info('データベースのクリーンアップを開始します', {
        isInitialized: this.isInitialized,
        hasConnection: !!this.currentConnection,
      })

      await this.pool.closeAllConnections()
      this.currentConnection = undefined
      this.currentDrizzle = undefined
      this.isInitialized = false

      logger.info('データベース接続のクリーンアップが完了しました')
    }
    catch (error) {
      logger.error('データベースクリーンアップ中にエラーが発生しました', error as Error)
      throw error
    }
  }

  /**
   * データベース接続をテスト
   */
  public async testConnection(): Promise<boolean> {
    const logger = Logger.getInstance()

    return await withAsyncPerformance('database.testConnection', async () => {
      logger.debug('データベース接続テストを開始します')

      try {
        const result = await this.healthChecker.testConnection()

        logger.info('データベース接続テストが完了しました', {
          success: result,
          isInitialized: this.isInitialized,
        })

        return result
      }
      catch (error) {
        logger.error('データベース接続テストに失敗しました', error as Error)
        return false
      }
    })
  }

  /**
   * データベースのヘルスチェックを実行
   */
  public async healthCheck(): Promise<HealthCheckResult> {
    const logger = Logger.getInstance()

    return await withAsyncPerformance('database.healthCheck', async () => {
      logger.debug('データベースヘルスチェックを開始します')

      try {
        const result = await this.healthChecker.healthCheck()

        logger.info('データベースヘルスチェックが完了しました', {
          status: result.status,
          responseTime: result.responseTime,
          issues: result.issues?.length || 0,
        })

        if (result.issues && result.issues.length > 0) {
          logger.warn('ヘルスチェックで問題が検出されました', {
            issues: result.issues,
          })
        }

        return result
      }
      catch (error) {
        logger.error('データベースヘルスチェックに失敗しました', error as Error)
        throw error
      }
    })
  }

  /**
   * パフォーマンスレポートを取得
   */
  public getPerformanceReport() {
    return this.healthChecker.generatePerformanceReport()
  }
}
