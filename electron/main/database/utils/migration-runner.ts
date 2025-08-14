/**
 * マイグレーション実行機能
 * 
 * Drizzle ORMを使用したデータベースマイグレーションの自動実行、
 * 失敗時のロールバック、履歴管理を提供します。
 */

import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { handleDatabaseError, executeWithRetry } from './error-handler'

/**
 * マイグレーション実行結果
 */
export interface MigrationResult {
  success: boolean
  appliedMigrations: string[]
  failedMigration?: string
  error?: Error
  duration: number
  timestamp: Date
}

/**
 * マイグレーション履歴エントリ
 */
export interface MigrationHistoryEntry {
  version: string
  appliedAt: Date
  duration: number
  success: boolean
  errorMessage?: string
}

/**
 * マイグレーション設定
 */
export interface MigrationConfig {
  migrationsFolder: string
  tableName?: string
  timeout?: number
  createBackup?: boolean
  backupPath?: string
}

/**
 * マイグレーション実行クラス
 */
export class MigrationRunner {
  private db: Database.Database
  private drizzleDb: ReturnType<typeof drizzle>
  private config: Required<MigrationConfig>
  private readonly defaultTimeout = 30000 // 30秒

  constructor(db: Database.Database, config: MigrationConfig) {
    this.db = db
    this.drizzleDb = drizzle(db)
    this.config = {
      migrationsFolder: config.migrationsFolder,
      tableName: config.tableName || '__drizzle_migrations',
      timeout: config.timeout || this.defaultTimeout,
      createBackup: config.createBackup ?? true,
      backupPath: config.backupPath || path.join(path.dirname(db.name || ''), 'backups')
    }

    this.initializeMigrationTable()
  }

  /**
   * マイグレーション履歴テーブルを初期化
   */
  private initializeMigrationTable(): void {
    try {
      const createTableSQL = `
        CREATE TABLE IF NOT EXISTS ${this.config.tableName} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          version TEXT NOT NULL UNIQUE,
          applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          duration INTEGER NOT NULL,
          success INTEGER NOT NULL DEFAULT 1,
          error_message TEXT
        )
      `
      this.db.exec(createTableSQL)
    } catch (error) {
      const dbError = handleDatabaseError(error, {
        operation: 'initializeMigrationTable',
        table: this.config.tableName
      })
      throw new Error(`マイグレーション履歴テーブルの初期化に失敗しました: ${dbError.message}`)
    }
  }

  /**
   * マイグレーションを実行
   */
  public async runMigrations(): Promise<MigrationResult> {
    const startTime = Date.now()
    const result: MigrationResult = {
      success: false,
      appliedMigrations: [],
      duration: 0,
      timestamp: new Date()
    }

    try {
      // マイグレーションファイルの存在確認
      if (!fs.existsSync(this.config.migrationsFolder)) {
        throw new Error(`マイグレーションフォルダが見つかりません: ${this.config.migrationsFolder}`)
      }

      // バックアップ作成（設定されている場合）
      if (this.config.createBackup) {
        await this.createBackup()
      }

      // マイグレーション実行前の状態を記録
      const preMigrationVersions = await this.getAppliedMigrations()

      // Drizzle ORMのマイグレーション実行
      await executeWithRetry(async () => {
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('マイグレーションがタイムアウトしました')), this.config.timeout)
        })

        const migrationPromise = migrate(this.drizzleDb, {
          migrationsFolder: this.config.migrationsFolder
        })

        await Promise.race([migrationPromise, timeoutPromise])
      }, 2, 2000) // 最大2回リトライ、2秒間隔

      // マイグレーション後の状態を確認
      const postMigrationVersions = await this.getAppliedMigrations()
      result.appliedMigrations = postMigrationVersions.filter(
        version => !preMigrationVersions.includes(version)
      )

      result.success = true
      result.duration = Date.now() - startTime

      // 成功した各マイグレーションを履歴に記録
      for (const migration of result.appliedMigrations) {
        await this.recordMigration(migration, result.duration / result.appliedMigrations.length, true)
      }

      return result

    } catch (error) {
      result.success = false
      result.duration = Date.now() - startTime
      result.error = error instanceof Error ? error : new Error(String(error))

      const dbError = handleDatabaseError(result.error, {
        operation: 'runMigrations',
        filePath: this.config.migrationsFolder
      })

      // 失敗したマイグレーションをログに記録
      try {
        await this.recordMigration(
          result.failedMigration || 'unknown',
          result.duration,
          false,
          dbError.message
        )
      } catch (logError) {
        console.error('マイグレーション履歴の記録に失敗:', logError)
      }

      // ロールバック実行（可能な場合）
      if (this.config.createBackup && dbError.recoverable) {
        try {
          await this.rollbackToBackup()
          console.log('バックアップからのロールバックが完了しました')
        } catch (rollbackError) {
          console.error('ロールバックに失敗:', rollbackError)
        }
      }

      throw new Error(`マイグレーションに失敗しました: ${dbError.message}`)
    }
  }

  /**
   * 適用済みマイグレーション一覧を取得
   */
  private async getAppliedMigrations(): Promise<string[]> {
    try {
      const query = `SELECT version FROM ${this.config.tableName} WHERE success = 1 ORDER BY applied_at`
      const stmt = this.db.prepare(query)
      const rows = stmt.all() as { version: string }[]
      return rows.map(row => row.version)
    } catch (error) {
      // マイグレーション履歴テーブルが存在しない場合は空配列を返す
      return []
    }
  }

  /**
   * マイグレーション実行履歴を記録
   */
  private async recordMigration(
    version: string,
    duration: number,
    success: boolean,
    errorMessage?: string
  ): Promise<void> {
    try {
      const query = `
        INSERT INTO ${this.config.tableName} (version, duration, success, error_message)
        VALUES (?, ?, ?, ?)
      `
      const stmt = this.db.prepare(query)
      stmt.run(version, duration, success ? 1 : 0, errorMessage || null)
    } catch (error) {
      console.error('マイグレーション履歴の記録に失敗:', error)
    }
  }

  /**
   * データベースのバックアップを作成
   */
  private async createBackup(): Promise<string> {
    try {
      const backupDir = this.config.backupPath
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true })
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backupFileName = `backup-${timestamp}.sqlite3`
      const backupPath = path.join(backupDir, backupFileName)

      // SQLiteのbackupコマンドを使用してバックアップ作成
      await executeWithRetry(async () => {
        // SQLiteのbackupメソッドを使用してバックアップ作成
        await fs.promises.copyFile(this.db.name || '', backupPath)
      })

      // 古いバックアップファイルを削除（最新5件のみ保持）
      await this.cleanupOldBackups(backupDir)

      return backupPath
    } catch (error) {
      const dbError = handleDatabaseError(error, {
        operation: 'createBackup',
        filePath: this.config.backupPath
      })
      throw new Error(`バックアップの作成に失敗しました: ${dbError.message}`)
    }
  }

  /**
   * バックアップからロールバック
   */
  private async rollbackToBackup(): Promise<void> {
    try {
      const backupDir = this.config.backupPath
      if (!fs.existsSync(backupDir)) {
        throw new Error('バックアップディレクトリが見つかりません')
      }

      // 最新のバックアップファイルを取得
      const backupFiles = fs.readdirSync(backupDir)
        .filter(file => file.endsWith('.sqlite3'))
        .sort()
        .reverse()

      if (backupFiles.length === 0) {
        throw new Error('利用可能なバックアップファイルがありません')
      }

      const latestBackupFile = backupFiles[0]
      if (!latestBackupFile) {
        throw new Error('バックアップファイルが見つかりません')
      }
      
      const latestBackup = path.join(backupDir, latestBackupFile)
      const currentDbPath = this.db.name
      
      if (!currentDbPath) {
        throw new Error('データベースパスが不明です')
      }

      // データベース接続を一時的に閉じる
      this.db.close()

      // バックアップファイルを現在のデータベースファイルに復元
      await fs.promises.copyFile(latestBackup, currentDbPath)

      // データベース接続を再開
      if (currentDbPath) {
        this.db = new Database(currentDbPath)
      } else {
        throw new Error('データベースパスが不明です')
      }
      this.drizzleDb = drizzle(this.db)

    } catch (error) {
      const dbError = handleDatabaseError(error, {
        operation: 'rollbackToBackup',
        filePath: this.config.backupPath
      })
      throw new Error(`ロールバックに失敗しました: ${dbError.message}`)
    }
  }

  /**
   * 古いバックアップファイルを削除
   */
  private async cleanupOldBackups(backupDir: string, keepCount: number = 5): Promise<void> {
    try {
      const backupFiles = fs.readdirSync(backupDir)
        .filter(file => file.endsWith('.sqlite3'))
        .map(file => ({
          name: file,
          path: path.join(backupDir, file),
          stats: fs.statSync(path.join(backupDir, file))
        }))
        .sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime())

      if (backupFiles.length > keepCount) {
        const filesToDelete = backupFiles.slice(keepCount)
        for (const file of filesToDelete) {
          await fs.promises.unlink(file.path)
        }
      }
    } catch (error) {
      console.warn('古いバックアップファイルの削除に失敗:', error)
    }
  }

  /**
   * マイグレーション履歴を取得
   */
  public async getMigrationHistory(): Promise<MigrationHistoryEntry[]> {
    try {
      const query = `
        SELECT 
          version,
          applied_at,
          duration,
          success,
          error_message
        FROM ${this.config.tableName}
        ORDER BY applied_at DESC
      `
      const stmt = this.db.prepare(query)
      const rows = stmt.all() as any[]

      return rows.map(row => ({
        version: row.version,
        appliedAt: new Date(row.applied_at),
        duration: row.duration,
        success: Boolean(row.success),
        errorMessage: row.error_message || undefined
      }))
    } catch (error) {
      const dbError = handleDatabaseError(error, {
        operation: 'getMigrationHistory',
        table: this.config.tableName
      })
      throw new Error(`マイグレーション履歴の取得に失敗しました: ${dbError.message}`)
    }
  }

  /**
   * 最新のマイグレーション状態を確認
   */
  public async getLatestMigrationStatus(): Promise<{
    hasAppliedMigrations: boolean
    lastMigrationVersion?: string
    lastMigrationDate?: Date
    pendingMigrations: string[]
  }> {
    try {
      const appliedMigrations = await this.getAppliedMigrations()
      const availableMigrations = this.getAvailableMigrations()
      
      const pendingMigrations = availableMigrations.filter(
        migration => !appliedMigrations.includes(migration)
      )

      const history = await this.getMigrationHistory()
      const lastSuccess = history.find(entry => entry.success)

      return {
        hasAppliedMigrations: appliedMigrations.length > 0,
        ...(lastSuccess?.version && { lastMigrationVersion: lastSuccess.version }),
        ...(lastSuccess?.appliedAt && { lastMigrationDate: lastSuccess.appliedAt }),
        pendingMigrations
      }
    } catch (error) {
      const dbError = handleDatabaseError(error, {
        operation: 'getLatestMigrationStatus'
      })
      throw new Error(`マイグレーション状態の確認に失敗しました: ${dbError.message}`)
    }
  }

  /**
   * 利用可能なマイグレーションファイルを取得
   */
  private getAvailableMigrations(): string[] {
    try {
      if (!fs.existsSync(this.config.migrationsFolder)) {
        return []
      }

      return fs.readdirSync(this.config.migrationsFolder)
        .filter(file => file.endsWith('.sql'))
        .sort()
    } catch (error) {
      console.warn('利用可能なマイグレーションファイルの取得に失敗:', error)
      return []
    }
  }

  /**
   * マイグレーション実行前の検証
   */
  public async validateBeforeMigration(): Promise<{
    isValid: boolean
    issues: string[]
  }> {
    const issues: string[] = []

    try {
      // マイグレーションフォルダの存在確認
      if (!fs.existsSync(this.config.migrationsFolder)) {
        issues.push(`マイグレーションフォルダが見つかりません: ${this.config.migrationsFolder}`)
      }

      // データベース接続の確認
      try {
        this.db.exec('SELECT 1')
      } catch {
        issues.push('データベースに接続できません')
      }

      // ディスク容量の確認
      try {
        const diskSpace = await import('./error-handler').then(module => 
          module.DatabaseErrorHandler.checkDiskSpace(this.db.name || '')
        )
        if (diskSpace.available < 100 * 1024 * 1024) { // 100MB未満
          issues.push('ディスク容量が不足しています')
        }
      } catch (error) {
        issues.push('ディスク容量の確認に失敗しました')
      }

      // バックアップディレクトリの権限確認
      if (this.config.createBackup) {
        try {
          const parentDir = path.dirname(this.config.backupPath)
          if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true })
          }
        } catch {
          issues.push('バックアップディレクトリにアクセスできません')
        }
      }

      return {
        isValid: issues.length === 0,
        issues
      }
    } catch (error) {
      issues.push(`検証中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`)
      return {
        isValid: false,
        issues
      }
    }
  }

  /**
   * リソースのクリーンアップ
   */
  public cleanup(): void {
    // データベース接続は外部で管理されるため、ここでは閉じない
    // 必要に応じて他のリソースをクリーンアップ
  }
}

/**
 * マイグレーション実行のヘルパー関数
 */
export async function runDatabaseMigrations(
  db: Database.Database,
  config: MigrationConfig
): Promise<MigrationResult> {
  const runner = new MigrationRunner(db, config)
  
  try {
    // マイグレーション前の検証
    const validation = await runner.validateBeforeMigration()
    if (!validation.isValid) {
      throw new Error(`マイグレーション前の検証に失敗しました: ${validation.issues.join(', ')}`)
    }

    // マイグレーション実行
    return await runner.runMigrations()
  } finally {
    runner.cleanup()
  }
}

export default MigrationRunner
