/**
 * データベースエラーハンドリング
 * 
 * SQLiteデータベース操作で発生する可能性のあるエラーを
 * 分類・処理し、適切なエラーメッセージとロギングを提供します。
 */

import * as fs from 'fs'
import * as path from 'path'

/**
 * データベースエラーの種類
 */
export enum DatabaseErrorType {
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  DISK_FULL = 'DISK_FULL',
  DATABASE_LOCKED = 'DATABASE_LOCKED',
  CORRUPTION = 'CORRUPTION',
  MIGRATION_FAILED = 'MIGRATION_FAILED',
  QUERY_ERROR = 'QUERY_ERROR',
  CONSTRAINT_VIOLATION = 'CONSTRAINT_VIOLATION',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  UNKNOWN = 'UNKNOWN'
}

/**
 * 構造化されたデータベースエラー情報
 */
export interface DatabaseError {
  type: DatabaseErrorType
  message: string
  originalError: Error
  context: {
    operation?: string
    table?: string
    query?: string
    filePath?: string
    [key: string]: string | number | boolean | undefined
  } | undefined
  timestamp: Date
  severity: 'low' | 'medium' | 'high' | 'critical'
  recoverable: boolean
  suggestedAction?: string
}

/**
 * データベースエラーハンドラークラス
 */
export class DatabaseErrorHandler {
  private static instance: DatabaseErrorHandler
  private errorHistory: DatabaseError[] = []
  private readonly maxHistorySize = 100

  private constructor() {}

  /**
   * シングルトンインスタンスを取得
   */
  public static getInstance(): DatabaseErrorHandler {
    if (!DatabaseErrorHandler.instance) {
      DatabaseErrorHandler.instance = new DatabaseErrorHandler()
    }
    return DatabaseErrorHandler.instance
  }

  /**
   * エラーを分析して構造化された情報として返す
   */
  public analyzeError(error: Error, context?: DatabaseError['context'] | undefined): DatabaseError {
    const dbError: DatabaseError = {
      type: this.classifyError(error),
      message: this.generateUserFriendlyMessage(error),
      originalError: error,
      context: context,
      timestamp: new Date(),
      severity: this.determineSeverity(error),
      recoverable: this.isRecoverable(error),
      suggestedAction: this.getSuggestedAction(error)
    }

    // エラー履歴に追加（サイズ制限あり）
    this.addToHistory(dbError)

    // ログ出力（将来のPino連携準備）
    this.logError(dbError)

    return dbError
  }

  /**
   * エラーの種類を分類
   */
  private classifyError(error: Error): DatabaseErrorType {
    const message = error.message.toLowerCase()
    const code = (error as any).code

    // SQLiteエラーコードによる分類
    if (code === 'SQLITE_CANTOPEN' || message.includes('no such file')) {
      return DatabaseErrorType.CONNECTION_FAILED
    }
    if (code === 'SQLITE_PERM' || message.includes('permission denied')) {
      return DatabaseErrorType.PERMISSION_DENIED
    }
    if (code === 'SQLITE_FULL' || message.includes('disk full')) {
      return DatabaseErrorType.DISK_FULL
    }
    if (code === 'SQLITE_BUSY' || message.includes('database is locked')) {
      return DatabaseErrorType.DATABASE_LOCKED
    }
    if (code === 'SQLITE_CORRUPT' || message.includes('database disk image is malformed')) {
      return DatabaseErrorType.CORRUPTION
    }
    if (code === 'SQLITE_CONSTRAINT' || message.includes('constraint')) {
      return DatabaseErrorType.CONSTRAINT_VIOLATION
    }

    // メッセージ内容による分類
    if (message.includes('migration')) {
      return DatabaseErrorType.MIGRATION_FAILED
    }
    if (message.includes('transaction')) {
      return DatabaseErrorType.TRANSACTION_FAILED
    }
    if (message.includes('sql') || message.includes('query')) {
      return DatabaseErrorType.QUERY_ERROR
    }

    return DatabaseErrorType.UNKNOWN
  }

  /**
   * ユーザーフレンドリーなエラーメッセージを生成
   */
  private generateUserFriendlyMessage(error: Error): string {
    const type = this.classifyError(error)

    switch (type) {
      case DatabaseErrorType.CONNECTION_FAILED:
        return 'データベースに接続できませんでした。ファイルパスを確認してください。'
      case DatabaseErrorType.PERMISSION_DENIED:
        return 'データベースファイルへのアクセス権限がありません。'
      case DatabaseErrorType.DISK_FULL:
        return 'ディスク容量が不足しています。空き容量を確保してください。'
      case DatabaseErrorType.DATABASE_LOCKED:
        return 'データベースが他のプロセスによってロックされています。しばらくお待ちください。'
      case DatabaseErrorType.CORRUPTION:
        return 'データベースファイルが破損している可能性があります。'
      case DatabaseErrorType.MIGRATION_FAILED:
        return 'データベースのマイグレーションに失敗しました。'
      case DatabaseErrorType.QUERY_ERROR:
        return 'データベースクエリの実行中にエラーが発生しました。'
      case DatabaseErrorType.CONSTRAINT_VIOLATION:
        return 'データの整合性制約に違反しています。'
      case DatabaseErrorType.TRANSACTION_FAILED:
        return 'データベーストランザクションが失敗しました。'
      default:
        return `予期しないエラーが発生しました: ${error.message}`
    }
  }

  /**
   * エラーの重要度を判定
   */
  private determineSeverity(error: Error): DatabaseError['severity'] {
    const type = this.classifyError(error)

    switch (type) {
      case DatabaseErrorType.CORRUPTION:
      case DatabaseErrorType.PERMISSION_DENIED:
        return 'critical'
      case DatabaseErrorType.CONNECTION_FAILED:
      case DatabaseErrorType.DISK_FULL:
      case DatabaseErrorType.MIGRATION_FAILED:
        return 'high'
      case DatabaseErrorType.DATABASE_LOCKED:
      case DatabaseErrorType.TRANSACTION_FAILED:
        return 'medium'
      case DatabaseErrorType.QUERY_ERROR:
      case DatabaseErrorType.CONSTRAINT_VIOLATION:
        return 'low'
      default:
        return 'medium'
    }
  }

  /**
   * エラーが復旧可能かどうかを判定
   */
  private isRecoverable(error: Error): boolean {
    const type = this.classifyError(error)

    switch (type) {
      case DatabaseErrorType.DATABASE_LOCKED:
      case DatabaseErrorType.QUERY_ERROR:
      case DatabaseErrorType.TRANSACTION_FAILED:
      case DatabaseErrorType.CONSTRAINT_VIOLATION:
        return true
      case DatabaseErrorType.CORRUPTION:
      case DatabaseErrorType.PERMISSION_DENIED:
        return false
      default:
        return true
    }
  }

  /**
   * 推奨される対処法を取得
   */
  private getSuggestedAction(error: Error): string {
    const type = this.classifyError(error)

    switch (type) {
      case DatabaseErrorType.CONNECTION_FAILED:
        return 'アプリケーションを再起動するか、設定ディレクトリの権限を確認してください。'
      case DatabaseErrorType.PERMISSION_DENIED:
        return 'ファイルの権限設定を確認し、必要に応じて管理者権限で実行してください。'
      case DatabaseErrorType.DISK_FULL:
        return '不要なファイルを削除してディスク容量を確保してください。'
      case DatabaseErrorType.DATABASE_LOCKED:
        return 'しばらく待ってから再試行してください。'
      case DatabaseErrorType.CORRUPTION:
        return 'データベースファイルをバックアップから復元するか、初期化が必要です。'
      case DatabaseErrorType.MIGRATION_FAILED:
        return 'アプリケーションを再起動してマイグレーションを再試行してください。'
      default:
        return 'アプリケーションを再起動してください。問題が解決しない場合はサポートにお問い合わせください。'
    }
  }

  /**
   * エラー履歴に追加
   */
  private addToHistory(error: DatabaseError): void {
    this.errorHistory.unshift(error)
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory = this.errorHistory.slice(0, this.maxHistorySize)
    }
  }

  /**
   * エラーログを出力（将来のPino連携準備）
   */
  private logError(error: DatabaseError): void {
    const logData = {
      level: this.mapSeverityToLogLevel(error.severity),
      msg: error.message,
      error: {
        type: error.type,
        original: error.originalError.message,
        stack: error.originalError.stack,
        context: error.context
      },
      timestamp: error.timestamp.toISOString(),
      recoverable: error.recoverable,
      suggestedAction: error.suggestedAction
    }

    // 現在は console.error を使用、将来的にPinoに置き換え
    if (error.severity === 'critical' || error.severity === 'high') {
      console.error('[DatabaseError]', JSON.stringify(logData, null, 2))
    } else {
      console.warn('[DatabaseError]', JSON.stringify(logData, null, 2))
    }
  }

  /**
   * 重要度をログレベルにマッピング
   */
  private mapSeverityToLogLevel(severity: DatabaseError['severity']): string {
    switch (severity) {
      case 'critical':
        return 'fatal'
      case 'high':
        return 'error'
      case 'medium':
        return 'warn'
      case 'low':
        return 'info'
      default:
        return 'warn'
    }
  }

  /**
   * エラー履歴を取得
   */
  public getErrorHistory(): DatabaseError[] {
    return [...this.errorHistory]
  }

  /**
   * 重要度によるエラー履歴のフィルタ
   */
  public getErrorsBySeverity(severity: DatabaseError['severity']): DatabaseError[] {
    return this.errorHistory.filter(error => error.severity === severity)
  }

  /**
   * エラー履歴をクリア
   */
  public clearHistory(): void {
    this.errorHistory = []
  }

  /**
   * ディスク容量チェック
   */
  public static async checkDiskSpace(filePath: string): Promise<{ available: number; total: number }> {
    try {
      const stats = await fs.promises.statfs(path.dirname(filePath))
      return {
        available: stats.bavail * stats.bsize,
        total: stats.blocks * stats.bsize
      }
    } catch (error) {
      throw new Error(`ディスク容量の確認に失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * ファイル権限チェック
   */
  public static async checkFilePermissions(filePath: string): Promise<{ readable: boolean; writable: boolean }> {
    try {
      const result = { readable: false, writable: false }
      
      // ファイルが存在する場合
      if (fs.existsSync(filePath)) {
        try {
          await fs.promises.access(filePath, fs.constants.R_OK)
          result.readable = true
        } catch {}
        
        try {
          await fs.promises.access(filePath, fs.constants.W_OK)
          result.writable = true
        } catch {}
      } else {
        // ファイルが存在しない場合、親ディレクトリの権限をチェック
        const parentDir = path.dirname(filePath)
        try {
          await fs.promises.access(parentDir, fs.constants.W_OK)
          result.writable = true
          result.readable = true // 作成できれば読み書き可能
        } catch {}
      }
      
      return result
    } catch (error) {
      throw new Error(`ファイル権限の確認に失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/**
 * エラーハンドリングユーティリティ関数
 */
export const handleDatabaseError = (error: unknown, context?: DatabaseError['context']): DatabaseError => {
  const handler = DatabaseErrorHandler.getInstance()
  const dbError = error instanceof Error ? error : new Error(String(error))
  return handler.analyzeError(dbError, context)
}

/**
 * リトライ機能付きの非同期操作実行
 */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
  backoffMultiplier: number = 2
): Promise<T> {
  let lastError: Error
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      
      // 最後の試行の場合は例外を投げる
      if (attempt === maxRetries) {
        break
      }
      
      // 復旧不可能なエラーの場合は即座に失敗
      const dbError = handleDatabaseError(lastError)
      if (!dbError.recoverable) {
        break
      }
      
      // 指数バックオフで待機
      const delay = baseDelay * Math.pow(backoffMultiplier, attempt)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  
  throw lastError!
}

export default DatabaseErrorHandler
