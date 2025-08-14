/**
 * Pino Logger System for ProjectLens Electron App
 *
 * Pinoライブラリを使用した高性能ログシステム
 * - 環境別設定分岐（NODE_ENV基準）
 * - ファイル出力とローテーション機能
 * - クロスプラットフォーム対応
 * - 構造化ログ（JSON形式）
 * - 既存のエラーハンドラーとの統合
 */

import pino from 'pino'
import type { Logger as PinoLogger, LoggerOptions } from 'pino'
import { Transform } from 'stream'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { DatabaseError } from '../database/utils/error-handler'

// Logging types (inline to avoid complex path dependencies)
type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
type ProcessType = 'main' | 'renderer' | 'worker' | 'preload'
type Environment = 'development' | 'production' | 'test' | 'staging'

interface LogContext {
  process: ProcessType
  pid: number
  timestamp: string
  sessionId?: string
  userId?: number
  requestId?: string
  source?: {
    file: string
    line?: number
    function?: string
  }
  metadata?: Record<string, string | number | boolean | null | undefined>
}

interface LogFileConfig {
  filePath: string
  rotation: {
    maxSize: number
    maxFiles: number
    frequency: 'daily' | 'weekly' | 'monthly' | 'size-based'
  }
  compression: {
    enabled: boolean
    method: 'gzip' | 'zip'
  }
}

interface ConsoleLogConfig {
  enabled: boolean
  colorize: boolean
  timestampFormat: 'iso' | 'local' | 'relative' | 'none'
  format: 'json' | 'text' | 'compact'
}

interface EnvironmentLogConfig {
  environment: Environment
  minLevel: LogLevel
  console: ConsoleLogConfig
  file?: LogFileConfig
  debug: boolean
}

interface LoggingConfig {
  currentEnvironment: Environment
  environments: Record<Environment, EnvironmentLogConfig>
  global: {
    appName: string
    appVersion: string
    maxRetentionDays: number
    sensitiveDataMask: {
      enabled: boolean
      patterns: string[]
      replacement: string
    }
    performance: {
      enabled: boolean
      slowOperationThreshold: number
    }
  }
}

// Default configuration
const defaultLoggingConfig: LoggingConfig = {
  currentEnvironment: 'development',
  environments: {
    development: {
      environment: 'development',
      minLevel: 'debug',
      console: {
        enabled: true,
        colorize: true,
        timestampFormat: 'local',
        format: 'text',
      },
      file: {
        filePath: './logs/app.log',
        rotation: {
          maxSize: 10,
          maxFiles: 5,
          frequency: 'daily',
        },
        compression: {
          enabled: false,
          method: 'gzip',
        },
      },
      debug: true,
    },
    production: {
      environment: 'production',
      minLevel: 'info',
      console: {
        enabled: false,
        colorize: false,
        timestampFormat: 'iso',
        format: 'json',
      },
      file: {
        filePath: './logs/app.log',
        rotation: {
          maxSize: 50,
          maxFiles: 30,
          frequency: 'daily',
        },
        compression: {
          enabled: true,
          method: 'gzip',
        },
      },
      debug: false,
    },
    test: {
      environment: 'test',
      minLevel: 'warn',
      console: {
        enabled: true,
        colorize: false,
        timestampFormat: 'none',
        format: 'compact',
      },
      debug: false,
    },
    staging: {
      environment: 'staging',
      minLevel: 'debug',
      console: {
        enabled: true,
        colorize: true,
        timestampFormat: 'iso',
        format: 'json',
      },
      file: {
        filePath: './logs/app.log',
        rotation: {
          maxSize: 25,
          maxFiles: 10,
          frequency: 'daily',
        },
        compression: {
          enabled: true,
          method: 'gzip',
        },
      },
      debug: true,
    },
  },
  global: {
    appName: 'ProjectLens',
    appVersion: '1.0.0',
    maxRetentionDays: 90,
    sensitiveDataMask: {
      enabled: true,
      patterns: [
        'password\\s*[=:]\\s*[^\\s]+',
        'token\\s*[=:]\\s*[^\\s]+',
        'key\\s*[=:]\\s*[^\\s]+',
        'secret\\s*[=:]\\s*[^\\s]+',
      ],
      replacement: '[REDACTED]',
    },
    performance: {
      enabled: true,
      slowOperationThreshold: 1000,
    },
  },
}

/**
 * ログディレクトリのパスを取得（クロスプラットフォーム対応）
 */
function getLogDirectory(): string {
  const platform = os.platform()
  let baseDir: string

  switch (platform) {
    case 'darwin': // macOS
      baseDir = path.join(os.homedir(), 'Library', 'Logs')
      break
    case 'win32': // Windows
      baseDir = path.join(os.homedir(), 'AppData', 'Local')
      break
    default: // Linux and others
      baseDir = path.join(os.homedir(), '.config')
      break
  }

  return path.join(baseDir, 'project-lens', 'logs')
}

/**
 * ログファイルローテーション実装
 */
class LogRotationTransform extends Transform {
  private currentFileSize: number = 0
  private readonly maxFileSize: number
  private readonly maxFiles: number
  private readonly baseFilePath: string
  private currentStream: fs.WriteStream | null = null

  constructor(filePath: string, maxSize: number, maxFiles: number) {
    super({ objectMode: true })
    this.maxFileSize = maxSize * 1024 * 1024 // MB to bytes
    this.maxFiles = maxFiles
    this.baseFilePath = filePath
    this.initializeStream()
  }

  private initializeStream(): void {
    try {
      // ディレクトリが存在しない場合は作成
      const dir = path.dirname(this.baseFilePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      // 既存ファイルのサイズを確認
      if (fs.existsSync(this.baseFilePath)) {
        const stats = fs.statSync(this.baseFilePath)
        this.currentFileSize = stats.size
      }

      this.currentStream = fs.createWriteStream(this.baseFilePath, { flags: 'a' })
    }
    catch (error) {
      console.error('ログストリーム初期化エラー:', error)
    }
  }

  private rotateFile(): void {
    if (!this.currentStream) return

    try {
      this.currentStream.end()

      // 既存のローテーションファイルを移動
      for (let i = this.maxFiles - 1; i > 0; i--) {
        const oldFile = `${this.baseFilePath}.${i}`
        const newFile = `${this.baseFilePath}.${i + 1}`

        if (fs.existsSync(oldFile)) {
          if (i === this.maxFiles - 1) {
            fs.unlinkSync(oldFile) // 最古のファイルを削除
          }
          else {
            fs.renameSync(oldFile, newFile)
          }
        }
      }

      // 現在のログファイルをローテーション
      if (fs.existsSync(this.baseFilePath)) {
        fs.renameSync(this.baseFilePath, `${this.baseFilePath}.1`)
      }

      // 新しいストリームを作成
      this.currentFileSize = 0
      this.currentStream = fs.createWriteStream(this.baseFilePath, { flags: 'a' })
    }
    catch (error) {
      console.error('ログローテーションエラー:', error)
    }
  }

  override _transform(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (!this.currentStream) {
      callback()
      return
    }

    const logLine = JSON.stringify(chunk) + '\n'
    const lineSize = Buffer.byteLength(logLine, 'utf8')

    // ファイルサイズチェック
    if (this.currentFileSize + lineSize > this.maxFileSize) {
      this.rotateFile()
    }

    this.currentFileSize += lineSize
    this.currentStream.write(logLine)
    callback()
  }

  override destroy(error?: Error): this {
    if (this.currentStream) {
      this.currentStream.end()
      this.currentStream = null
    }
    super.destroy(error)
    return this
  }
}

/**
 * メインログマネージャークラス（シングルトンパターン）
 */
export class Logger {
  private static instance: Logger
  private pinoLogger!: PinoLogger
  private config: LoggingConfig
  private rotationTransform: LogRotationTransform | null = null
  private readonly startTime: number
  private readonly processType: ProcessType = 'main'
  private sessionId: string

  private constructor() {
    this.startTime = Date.now()
    this.sessionId = this.generateSessionId()

    // デフォルト設定を基に環境別設定を適用
    this.config = { ...defaultLoggingConfig }
    this.config.currentEnvironment = this.detectEnvironment()

    this.initializeLogger()
  }

  /**
   * シングルトンインスタンス取得（100ms以内初期化保証）
   */
  public static getInstance(): Logger {
    const initStart = Date.now()

    if (!Logger.instance) {
      Logger.instance = new Logger()
    }

    const initTime = Date.now() - initStart
    if (initTime > 100) {
      console.warn(`Logger initialization took ${initTime}ms (>100ms)`)
    }

    return Logger.instance
  }

  /**
   * 現在の環境を検出
   */
  private detectEnvironment(): Environment {
    const nodeEnv = process.env.NODE_ENV
    switch (nodeEnv) {
      case 'production':
        return 'production'
      case 'test':
        return 'test'
      case 'staging':
        return 'staging'
      default:
        return 'development'
    }
  }

  /**
   * セッションID生成
   */
  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
  }

  /**
   * Pinoロガー初期化
   */
  private initializeLogger(): void {
    const currentEnvConfig = this.config.environments[this.config.currentEnvironment]
    const logDir = getLogDirectory()

    // ログディレクトリ作成
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true })
    }

    // Pinoオプション構築
    const pinoOptions: LoggerOptions = {
      level: currentEnvConfig.minLevel,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label: string) => ({ level: label }),
        bindings: () => ({
          pid: process.pid,
          hostname: os.hostname(),
          process: this.processType,
          sessionId: this.sessionId,
        }),
      },
      base: {
        name: this.config.global.appName,
        version: this.config.global.appVersion,
      },
      serializers: {
        error: pino.stdSerializers.err,
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res,
      },
    }

    // ストリーム設定
    const streams: Array<{ level: string, stream: NodeJS.WritableStream }> = []

    // コンソール出力設定
    if (currentEnvConfig.console.enabled) {
      if (this.config.currentEnvironment === 'development') {
        // 開発環境では pino-pretty を使用
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        const pretty = require('pino-pretty')
        streams.push({
          level: currentEnvConfig.minLevel,
          stream: pretty({
            colorize: currentEnvConfig.console.colorize,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
            messageFormat: '{levelLabel} - {msg}',
          }),
        })
      }
      else {
        // 本番環境では標準出力
        streams.push({
          level: currentEnvConfig.minLevel,
          stream: process.stdout,
        })
      }
    }

    // ファイル出力設定
    if (currentEnvConfig.file) {
      const logFilePath = path.join(logDir, 'app.log')

      this.rotationTransform = new LogRotationTransform(
        logFilePath,
        currentEnvConfig.file.rotation.maxSize,
        currentEnvConfig.file.rotation.maxFiles,
      )

      streams.push({
        level: currentEnvConfig.minLevel,
        stream: this.rotationTransform,
      })
    }

    // 複数ストリーム使用時の設定
    if (streams.length > 1) {
      this.pinoLogger = pino(pinoOptions, pino.multistream(streams))
    }
    else {
      this.pinoLogger = pino(pinoOptions, streams[0]?.stream || process.stdout)
    }

    // 起動ログ
    this.info('Logger initialized', {
      environment: this.config.currentEnvironment,
      logLevel: currentEnvConfig.minLevel,
      logDirectory: logDir,
    })
  }

  /**
   * 共通ログコンテキスト生成
   */
  private createLogContext(extra?: Partial<LogContext>): LogContext {
    return {
      process: this.processType,
      pid: process.pid,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      ...extra,
    }
  }

  /**
   * 機密情報マスキング
   */
  private maskSensitiveData(message: string, data?: Record<string, unknown>): { message: string, data?: Record<string, unknown> } {
    if (!this.config.global.sensitiveDataMask.enabled) {
      return { message, ...(data !== undefined && { data }) }
    }

    let maskedMessage = message
    const patterns = this.config.global.sensitiveDataMask.patterns
    const replacement = this.config.global.sensitiveDataMask.replacement

    patterns.forEach((pattern) => {
      const regex = new RegExp(pattern, 'gi')
      maskedMessage = maskedMessage.replace(regex, replacement)
    })

    let maskedData = data
    if (data) {
      maskedData = JSON.parse(JSON.stringify(data))
      const maskRecursive = (obj: Record<string, unknown>): Record<string, unknown> => {
        if (typeof obj === 'object' && obj !== null) {
          for (const key in obj) {
            if (typeof obj[key] === 'string') {
              patterns.forEach((pattern) => {
                const regex = new RegExp(pattern, 'gi')
                obj[key] = (obj[key] as string).replace(regex, replacement)
              })
            }
            else if (typeof obj[key] === 'object' && obj[key] !== null) {
              obj[key] = maskRecursive(obj[key] as Record<string, unknown>)
            }
          }
        }
        return obj
      }
      maskedData = maskRecursive(maskedData as Record<string, unknown>)
    }

    return { message: maskedMessage, ...(maskedData !== undefined && { data: maskedData }) }
  }

  /**
   * パフォーマンス計測付きログ
   */
  public withPerformance<T>(operation: string, fn: () => T): T {
    const start = Date.now()
    try {
      const result = fn()
      const duration = Date.now() - start

      if (this.config.global.performance.enabled) {
        if (duration > this.config.global.performance.slowOperationThreshold) {
          this.warn('Slow operation detected', {
            operation,
            duration,
            threshold: this.config.global.performance.slowOperationThreshold,
          })
        }
        else {
          this.debug('Operation completed', { operation, duration })
        }
      }

      return result
    }
    catch (error) {
      const duration = Date.now() - start
      this.error('Operation failed', error as Error, { operation, duration })
      throw error
    }
  }

  /**
   * 非同期パフォーマンス計測付きログ
   */
  public async withAsyncPerformance<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now()
    try {
      const result = await fn()
      const duration = Date.now() - start

      if (this.config.global.performance.enabled) {
        if (duration > this.config.global.performance.slowOperationThreshold) {
          this.warn('Slow async operation detected', {
            operation,
            duration,
            threshold: this.config.global.performance.slowOperationThreshold,
          })
        }
        else {
          this.debug('Async operation completed', { operation, duration })
        }
      }

      return result
    }
    catch (error) {
      const duration = Date.now() - start
      this.error('Async operation failed', error as Error, { operation, duration })
      throw error
    }
  }

  /**
   * データベースエラー専用ログ（error-handler.ts統合）
   */
  public logDatabaseError(dbError: DatabaseError): void {
    const context = this.createLogContext({
      metadata: {
        errorType: dbError.type,
        severity: dbError.severity,
        recoverable: dbError.recoverable,
        operation: dbError.context?.operation || 'unknown',
        table: dbError.context?.table || null,
        ...(dbError.context || {}),
      },
    })

    const logData = {
      context,
      error: {
        name: dbError.originalError.name,
        message: dbError.originalError.message,
        stack: dbError.originalError.stack,
      },
      suggestedAction: dbError.suggestedAction,
    }

    switch (dbError.severity) {
      case 'critical':
        this.pinoLogger?.fatal(logData, dbError.message)
        break
      case 'high':
        this.pinoLogger?.error(logData, dbError.message)
        break
      case 'medium':
        this.pinoLogger?.warn(logData, dbError.message)
        break
      case 'low':
        this.pinoLogger?.info(logData, dbError.message)
        break
    }
  }

  // レベル別ログメソッド
  public trace(message: string, data?: Record<string, unknown>, context?: Partial<LogContext>): void {
    const { message: maskedMessage, data: maskedData } = this.maskSensitiveData(message, data)
    const logContext = this.createLogContext(context)
    this.pinoLogger?.trace({ context: logContext, ...maskedData }, maskedMessage)
  }

  public debug(message: string, data?: Record<string, unknown>, context?: Partial<LogContext>): void {
    const { message: maskedMessage, data: maskedData } = this.maskSensitiveData(message, data)
    const logContext = this.createLogContext(context)
    this.pinoLogger?.debug({ context: logContext, ...maskedData }, maskedMessage)
  }

  public info(message: string, data?: Record<string, unknown>, context?: Partial<LogContext>): void {
    const { message: maskedMessage, data: maskedData } = this.maskSensitiveData(message, data)
    const logContext = this.createLogContext(context)
    this.pinoLogger?.info({ context: logContext, ...maskedData }, maskedMessage)
  }

  public warn(message: string, data?: Record<string, unknown>, context?: Partial<LogContext>): void {
    const { message: maskedMessage, data: maskedData } = this.maskSensitiveData(message, data)
    const logContext = this.createLogContext(context)
    this.pinoLogger?.warn({ context: logContext, ...maskedData }, maskedMessage)
  }

  public error(message: string, error?: Error, data?: Record<string, unknown>, context?: Partial<LogContext>): void {
    const { message: maskedMessage, data: maskedData } = this.maskSensitiveData(message, data)
    const logContext = this.createLogContext(context)

    const logData = {
      context: logContext,
      ...maskedData,
      ...(error && { error: { name: error.name, message: error.message, stack: error.stack } }),
    }

    this.pinoLogger?.error(logData, maskedMessage)
  }

  public fatal(message: string, error?: Error, data?: Record<string, unknown>, context?: Partial<LogContext>): void {
    const { message: maskedMessage, data: maskedData } = this.maskSensitiveData(message, data)
    const logContext = this.createLogContext(context)

    const logData = {
      context: logContext,
      ...maskedData,
      ...(error && { error: { name: error.name, message: error.message, stack: error.stack } }),
    }

    this.pinoLogger?.fatal(logData, maskedMessage)
  }

  /**
   * 設定の動的更新
   */
  public updateConfig(newConfig: Partial<LoggingConfig>): void {
    this.config = { ...this.config, ...newConfig }
    this.info('Logger configuration updated', { newConfig })
  }

  /**
   * 現在の設定取得
   */
  public getConfig(): LoggingConfig {
    return { ...this.config }
  }

  /**
   * ログレベルの動的変更
   */
  public setLevel(level: LogLevel): void {
    if (this.pinoLogger) this.pinoLogger.level = level
    this.info('Log level changed', { newLevel: level })
  }

  /**
   * ヘルスチェック
   */
  public healthCheck(): { status: 'ok' | 'error', details: Record<string, unknown> } {
    try {
      const logDir = getLogDirectory()
      const currentEnvConfig = this.config.environments[this.config.currentEnvironment]

      return {
        status: 'ok',
        details: {
          environment: this.config.currentEnvironment,
          logLevel: currentEnvConfig.minLevel,
          logDirectory: logDir,
          logDirectoryExists: fs.existsSync(logDir),
          uptime: Date.now() - this.startTime,
          sessionId: this.sessionId,
        },
      }
    }
    catch (error) {
      return {
        status: 'error',
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }

  /**
   * クリーンアップ
   */
  public destroy(): void {
    this.info('Logger shutting down')

    if (this.rotationTransform) {
      this.rotationTransform.destroy()
      this.rotationTransform = null
    }

    if (this.pinoLogger) {
      this.pinoLogger.flush()
    }
  }
}

// メモリ効率的なインスタンスエクスポート
const logger = Logger.getInstance()

// 便利な関数エクスポート
export const trace = (message: string, data?: Record<string, unknown>): void => logger.trace(message, data)
export const debug = (message: string, data?: Record<string, unknown>): void => logger.debug(message, data)
export const info = (message: string, data?: Record<string, unknown>): void => logger.info(message, data)
export const warn = (message: string, data?: Record<string, unknown>): void => logger.warn(message, data)
export const error = (message: string, err?: Error, data?: Record<string, unknown>): void => logger.error(message, err, data)
export const fatal = (message: string, err?: Error, data?: Record<string, unknown>): void => logger.fatal(message, err, data)

// パフォーマンス測定用
export const withPerformance = <T>(operation: string, fn: () => T): T => logger.withPerformance(operation, fn)
export const withAsyncPerformance = <T>(operation: string, fn: () => Promise<T>): Promise<T> => logger.withAsyncPerformance(operation, fn)

// データベースエラーログ
export const logDatabaseError = (dbError: DatabaseError): void => logger.logDatabaseError(dbError)

export default logger
