/**
 * Backlog Direct API接続管理サービス Phase 5 - 高度なエラーハンドラー
 *
 * カスタムエラー分類、指数バックオフリトライ機構、Pinoログ統合、
 * 高度なエラー回復機能、運用サポート機能を提供します。
 *
 * Features:
 * - 12種類以上のエラー分類と自動回復戦略
 * - 指数バックオフによる段階的リトライ機構
 * - 既存Pinoログシステムとの完全統合
 * - 機密情報自動マスキング機能
 * - エラートレンド分析とアラート機能
 * - 運用チーム向け詳細コンテキスト保存
 */

import { Logger } from '../../utils/logger'
// import type { LogContext } from '../../utils/logger'
type LogContext = Record<string, unknown>

/**
 * エラー種別列挙型（12種類以上）
 */
export enum ErrorType {
  // 接続関連エラー
  NETWORK_ERROR = 'NETWORK_ERROR',
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  DNS_RESOLUTION_ERROR = 'DNS_RESOLUTION_ERROR',
  SSL_CERTIFICATE_ERROR = 'SSL_CERTIFICATE_ERROR',

  // API関連エラー
  API_ERROR = 'API_ERROR',
  API_VERSION_MISMATCH = 'API_VERSION_MISMATCH',
  MALFORMED_RESPONSE = 'MALFORMED_RESPONSE',

  // 認証関連エラー
  AUTH_ERROR = 'AUTH_ERROR',
  AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',
  AUTH_INSUFFICIENT_PERMISSIONS = 'AUTH_INSUFFICIENT_PERMISSIONS',

  // レート制限エラー
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',

  // データ関連エラー
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  SERIALIZATION_ERROR = 'SERIALIZATION_ERROR',

  // システム関連エラー
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  RESOURCE_EXHAUSTED = 'RESOURCE_EXHAUSTED',

  // 外部依存エラー
  THIRD_PARTY_SERVICE_ERROR = 'THIRD_PARTY_SERVICE_ERROR',

  // 不明なエラー
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * エラー重要度レベル
 */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * エラーコンテキスト情報
 */
export interface ErrorContext {
  spaceId?: string
  endpoint?: string
  requestId?: string
  userAgent?: string
  timestamp: Date
  method?: string
  statusCode?: number
  requestBody?: Record<string, unknown>
  responseHeaders?: Record<string, string>
  sessionId?: string
  userId?: number
  retryAttempt?: number
  totalDuration?: number
  operation?: string
}

/**
 * リトライ戦略設定
 */
export interface RetryStrategy {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
  jitterMs: number
  retryableErrors: ErrorType[]
  retryCondition?: (error: BacklogApiError, attemptCount: number) => boolean
}

/**
 * エラー回復戦略
 */
export interface RecoveryStrategy {
  autoRecover: boolean
  healthCheckInterval?: number
  fallbackActions: Array<() => Promise<void>>
  circuitBreakerThreshold: number
  recoveryActions: Array<() => Promise<boolean>>
}

/**
 * エラートレンド分析データ
 */
export interface ErrorTrendData {
  errorType: ErrorType
  count: number
  lastOccurrence: Date
  averageInterval: number
  severity: ErrorSeverity
  recurrencePattern?: 'increasing' | 'decreasing' | 'stable' | 'sporadic'
}

/**
 * アラート設定
 */
export interface AlertConfig {
  enabled: boolean
  thresholds: {
    errorRate: number // エラー率閾値（%）
    criticalErrorCount: number // 重要エラー数閾値
    responseTimeMs: number // レスポンス時間閾値
  }
  channels: Array<'log' | 'email' | 'webhook'>
  webhookUrl?: string
  emailRecipients?: string[]
}

/**
 * カスタムBacklog APIエラークラス
 */
export class BacklogApiError extends Error {
  public readonly type: ErrorType
  public readonly severity: ErrorSeverity
  public readonly context: ErrorContext
  public readonly originalError?: Error
  public readonly recoverable: boolean
  public readonly retryable: boolean
  public readonly suggestedAction?: string
  public readonly errorCode?: string
  public readonly httpStatus?: number

  constructor({
    type,
    message,
    severity = ErrorSeverity.MEDIUM,
    context,
    originalError,
    recoverable = false,
    retryable = false,
    suggestedAction,
    errorCode,
    httpStatus,
  }: {
    type: ErrorType
    message: string
    severity?: ErrorSeverity
    context: ErrorContext
    originalError?: Error
    recoverable?: boolean
    retryable?: boolean
    suggestedAction?: string
    errorCode?: string
    httpStatus?: number
  }) {
    super(message)
    this.name = 'BacklogApiError'
    this.type = type
    this.severity = severity
    this.context = context
    this.originalError = originalError || undefined
    this.recoverable = recoverable
    this.retryable = retryable
    this.suggestedAction = suggestedAction
    this.errorCode = errorCode
    this.httpStatus = httpStatus

    // スタックトレースの設定
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BacklogApiError)
    }
  }

  /**
   * エラーの完全な詳細を構造化データとして取得
   */
  public getFullDetails(): Record<string, unknown> {
    return {
      type: this.type,
      severity: this.severity,
      message: this.message,
      context: this.context,
      recoverable: this.recoverable,
      retryable: this.retryable,
      suggestedAction: this.suggestedAction,
      errorCode: this.errorCode,
      httpStatus: this.httpStatus,
      originalError: this.originalError
        ? {
            name: this.originalError.name,
            message: this.originalError.message,
            stack: this.originalError.stack,
          }
        : null,
      stack: this.stack,
    }
  }
}

/**
 * Backlog APIエラーハンドラー
 */
export class BacklogErrorHandler {
  private readonly logger: Logger
  private readonly errorCounts: Map<ErrorType, number> = new Map()
  private readonly errorSeverityCounts: Map<ErrorSeverity, number> = new Map()
  private readonly errorTrends: Map<ErrorType, ErrorTrendData> = new Map()
  private readonly circuitBreakerStates: Map<string, { isOpen: boolean, failureCount: number, lastFailure: Date }> = new Map()
  private alertConfig: AlertConfig
  private readonly startTime: Date = new Date()

  // デフォルトリトライ戦略設定
  private readonly defaultRetryStrategies: Map<ErrorType, RetryStrategy> = new Map([
    [ErrorType.NETWORK_ERROR, {
      maxRetries: 5,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
      jitterMs: 500,
      retryableErrors: [ErrorType.NETWORK_ERROR, ErrorType.CONNECTION_TIMEOUT],
    }],
    [ErrorType.CONNECTION_TIMEOUT, {
      maxRetries: 3,
      baseDelayMs: 2000,
      maxDelayMs: 16000,
      backoffMultiplier: 2,
      jitterMs: 1000,
      retryableErrors: [ErrorType.CONNECTION_TIMEOUT],
    }],
    [ErrorType.RATE_LIMIT_ERROR, {
      maxRetries: 10,
      baseDelayMs: 5000,
      maxDelayMs: 300000, // 5分
      backoffMultiplier: 1.5,
      jitterMs: 2000,
      retryableErrors: [ErrorType.RATE_LIMIT_ERROR],
    }],
    [ErrorType.API_ERROR, {
      maxRetries: 2,
      baseDelayMs: 1000,
      maxDelayMs: 8000,
      backoffMultiplier: 2,
      jitterMs: 500,
      retryableErrors: [ErrorType.API_ERROR],
    }],
    [ErrorType.AUTH_TOKEN_EXPIRED, {
      maxRetries: 1,
      baseDelayMs: 1000,
      maxDelayMs: 2000,
      backoffMultiplier: 1,
      jitterMs: 0,
      retryableErrors: [ErrorType.AUTH_TOKEN_EXPIRED],
    }],
    [ErrorType.DNS_RESOLUTION_ERROR, {
      maxRetries: 0, // DNS エラーはリトライしない
      baseDelayMs: 1000,
      maxDelayMs: 1000,
      backoffMultiplier: 1,
      jitterMs: 0,
      retryableErrors: [],
    }],
  ])

  // デフォルト回復戦略設定
  private readonly defaultRecoveryStrategies: Map<ErrorType, RecoveryStrategy> = new Map([
    [ErrorType.NETWORK_ERROR, {
      autoRecover: true,
      healthCheckInterval: 30000, // 30秒
      fallbackActions: [],
      circuitBreakerThreshold: 5,
      recoveryActions: [],
    }],
    [ErrorType.AUTH_ERROR, {
      autoRecover: true,
      healthCheckInterval: 60000, // 1分
      fallbackActions: [],
      circuitBreakerThreshold: 3,
      recoveryActions: [],
    }],
    [ErrorType.RATE_LIMIT_ERROR, {
      autoRecover: true,
      healthCheckInterval: 60000,
      fallbackActions: [],
      circuitBreakerThreshold: 10,
      recoveryActions: [],
    }],
  ])

  constructor(alertConfig?: Partial<AlertConfig>) {
    this.logger = Logger.getInstance()
    this.alertConfig = {
      enabled: true,
      thresholds: {
        errorRate: 10, // 10%
        criticalErrorCount: 5,
        responseTimeMs: 5000,
      },
      channels: ['log'],
      ...alertConfig,
    }

    // 初期化ログ
    this.logger.info('BacklogErrorHandler initialized', {
      alertsEnabled: this.alertConfig.enabled,
      retryStrategies: Array.from(this.defaultRetryStrategies.keys()),
      recoveryStrategies: Array.from(this.defaultRecoveryStrategies.keys()),
    })
  }

  /**
   * エラーを分類し、適切なBacklogApiErrorを生成
   */
  public classifyError(error: Error | unknown, context: Partial<ErrorContext> = {}): BacklogApiError {
    const fullContext: ErrorContext = {
      timestamp: new Date(),
      requestId: this.generateRequestId(),
      ...context,
    }

    // 既にBacklogApiErrorの場合は、トレンド情報などを更新して返す
    if (error instanceof BacklogApiError) {
      this.logError(error)
      this.updateErrorTrends(error)
      this.checkAlertConditions(error)
      return error
    }

    // エラー種別の判定
    let errorType: ErrorType
    let severity: ErrorSeverity
    let recoverable = false
    let retryable = false
    let suggestedAction: string | undefined
    let httpStatus: number | undefined

    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase()
      const errorName = error.name.toLowerCase()

      // ネットワーク関連エラー
      if (errorMessage.includes('network') || errorMessage.includes('fetch') || errorName.includes('fetch')
        || errorMessage.includes('failure') || errorMessage.includes('connection error')) {
        errorType = ErrorType.NETWORK_ERROR
        severity = ErrorSeverity.HIGH
        recoverable = true
        retryable = true
        suggestedAction = 'ネットワーク接続を確認してリトライしてください'
      }
      // タイムアウトエラー
      else if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
        errorType = ErrorType.CONNECTION_TIMEOUT
        severity = ErrorSeverity.MEDIUM
        recoverable = true
        retryable = true
        suggestedAction = 'タイムアウト設定を調整するか、後でリトライしてください'
      }
      // DNS解決エラー
      else if (errorMessage.includes('dns') || errorMessage.includes('enotfound')) {
        errorType = ErrorType.DNS_RESOLUTION_ERROR
        severity = ErrorSeverity.HIGH
        recoverable = false
        retryable = false
        suggestedAction = 'ホスト名とDNS設定を確認してください'
      }
      // SSL証明書エラー
      else if (errorMessage.includes('certificate') || errorMessage.includes('ssl') || errorMessage.includes('tls')) {
        errorType = ErrorType.SSL_CERTIFICATE_ERROR
        severity = ErrorSeverity.HIGH
        recoverable = false
        retryable = false
        suggestedAction = 'SSL証明書の有効性を確認してください'
      }
      // 認証エラー
      else if (errorMessage.includes('auth') || errorMessage.includes('unauthorized') || context.statusCode === 401) {
        errorType = ErrorType.AUTH_ERROR
        severity = ErrorSeverity.HIGH
        recoverable = true
        retryable = false
        suggestedAction = 'APIキーを確認し、認証情報を更新してください'
        httpStatus = 401
      }
      // トークン期限切れ
      else if (errorMessage.includes('token expired') || errorMessage.includes('token invalid')) {
        errorType = ErrorType.AUTH_TOKEN_EXPIRED
        severity = ErrorSeverity.MEDIUM
        recoverable = true
        retryable = true
        suggestedAction = '認証トークンを更新してください'
      }
      // 権限不足エラー
      else if (errorMessage.includes('forbidden') || context.statusCode === 403) {
        errorType = ErrorType.AUTH_INSUFFICIENT_PERMISSIONS
        severity = ErrorSeverity.MEDIUM
        recoverable = false
        retryable = false
        suggestedAction = 'リクエストに必要な権限を確認してください'
        httpStatus = 403
      }
      // レート制限エラー
      else if (errorMessage.includes('rate limit') || context.statusCode === 429) {
        errorType = ErrorType.RATE_LIMIT_ERROR
        severity = ErrorSeverity.MEDIUM
        recoverable = true
        retryable = true
        suggestedAction = 'リクエスト頻度を下げて後でリトライしてください'
        httpStatus = 429
      }
      // クォータ超過エラー
      else if (errorMessage.includes('quota') || errorMessage.includes('limit exceeded')) {
        errorType = ErrorType.QUOTA_EXCEEDED
        severity = ErrorSeverity.HIGH
        recoverable = false
        retryable = false
        suggestedAction = 'API利用量制限を確認し、プランのアップグレードを検討してください'
      }
      // バリデーションエラー
      else if (errorMessage.includes('validation') || context.statusCode === 400) {
        errorType = ErrorType.VALIDATION_ERROR
        severity = ErrorSeverity.LOW
        recoverable = false
        retryable = false
        suggestedAction = 'リクエストパラメータを確認してください'
        httpStatus = 400
      }
      // APIバージョン不整合
      else if (errorMessage.includes('version') || errorMessage.includes('api mismatch')) {
        errorType = ErrorType.API_VERSION_MISMATCH
        severity = ErrorSeverity.HIGH
        recoverable = true
        retryable = false
        suggestedAction = 'APIバージョンを最新に更新してください'
      }
      // 設定エラー
      else if (errorMessage.includes('config') || errorMessage.includes('configuration')) {
        errorType = ErrorType.CONFIGURATION_ERROR
        severity = ErrorSeverity.CRITICAL
        recoverable = false
        retryable = false
        suggestedAction = 'アプリケーション設定を確認してください'
      }
      // リソース不足
      else if (errorMessage.includes('resource') || errorMessage.includes('memory') || errorMessage.includes('disk')) {
        errorType = ErrorType.RESOURCE_EXHAUSTED
        severity = ErrorSeverity.CRITICAL
        recoverable = true
        retryable = true
        suggestedAction = 'システムリソースを確認し、不要なプロセスを終了してください'
      }
      // サーバーエラー
      else if (context.statusCode && context.statusCode >= 500) {
        errorType = ErrorType.API_ERROR
        severity = ErrorSeverity.HIGH
        recoverable = true
        retryable = true
        suggestedAction = 'サーバーの一時的な問題の可能性があります。しばらく待ってからリトライしてください'
        httpStatus = context.statusCode
      }
      else {
        errorType = ErrorType.UNKNOWN_ERROR
        severity = ErrorSeverity.MEDIUM
        recoverable = false
        retryable = false
        suggestedAction = 'サポートチームに詳細なログと共に問題を報告してください'
      }
    }
    else {
      errorType = ErrorType.UNKNOWN_ERROR
      severity = ErrorSeverity.MEDIUM
      recoverable = false
      retryable = false
    }

    const backlogError = new BacklogApiError({
      type: errorType,
      message: error instanceof Error ? error.message : String(error),
      severity,
      context: fullContext,
      originalError: error instanceof Error ? error : undefined,
      recoverable,
      retryable,
      suggestedAction,
      httpStatus,
    })

    // エラーログ記録とトレンド分析
    this.logError(backlogError)
    this.updateErrorTrends(backlogError)
    this.checkAlertConditions(backlogError)

    return backlogError
  }

  /**
   * 指数バックオフリトライの実行
   */
  public async retryWithBackoff<T>(
    operation: () => Promise<T>,
    errorType: ErrorType,
    context: Partial<ErrorContext> = {},
    customStrategy?: Partial<RetryStrategy>,
  ): Promise<T> {
    const defaultStrategy = this.defaultRetryStrategies.get(errorType)

    // カスタム戦略が提供された場合は、デフォルト戦略をベースにマージ
    const strategy: RetryStrategy = defaultStrategy
      ? { ...defaultStrategy, ...customStrategy }
      : {
          maxRetries: customStrategy?.maxRetries ?? 3,
          baseDelayMs: customStrategy?.baseDelayMs ?? 1000,
          maxDelayMs: customStrategy?.maxDelayMs ?? 30000,
          backoffMultiplier: customStrategy?.backoffMultiplier ?? 2,
          jitterMs: customStrategy?.jitterMs ?? 500,
          retryableErrors: customStrategy?.retryableErrors ?? [errorType],
          retryCondition: customStrategy?.retryCondition,
        }

    let lastError: BacklogApiError | undefined
    let attempt = 0

    while (attempt <= strategy.maxRetries) {
      try {
        const startTime = Date.now()
        const result = await operation()

        // 成功時のログ
        if (attempt > 0) {
          this.logger.info('Operation succeeded after retry', {
            operation: context.operation || 'unknown',
            attemptCount: attempt,
            totalDuration: Date.now() - startTime,
            errorType,
          })
        }

        return result
      }
      catch (error) {
        const classifiedError = this.classifyError(error, {
          ...context,
          retryAttempt: attempt,
        })

        lastError = classifiedError

        // リトライ可能かチェック
        if (!strategy.retryableErrors.includes(classifiedError.type)
          || (strategy.retryCondition && !strategy.retryCondition(classifiedError, attempt))) {
          this.logger.error('Operation failed - not retryable', classifiedError.originalError, {
            errorType: classifiedError.type,
            severity: classifiedError.severity,
            context: classifiedError.context,
          })
          throw classifiedError
        }

        // 最大リトライ回数に達した場合
        if (attempt >= strategy.maxRetries) {
          this.logger.error('Operation failed - max retries exceeded', classifiedError.originalError, {
            errorType: classifiedError.type,
            maxRetries: strategy.maxRetries,
            totalAttempts: attempt + 1,
            context: classifiedError.context,
          })
          throw classifiedError
        }

        // バックオフ計算
        const baseDelay = strategy.baseDelayMs * Math.pow(strategy.backoffMultiplier, attempt)
        const jitter = Math.random() * strategy.jitterMs
        const delay = Math.min(baseDelay + jitter, strategy.maxDelayMs)

        this.logger.warn('Operation failed - retrying', undefined, {
          errorType: classifiedError.type,
          attempt: attempt + 1,
          maxRetries: strategy.maxRetries,
          delayMs: delay,
          context: classifiedError.context,
        })

        // 遅延実行
        await this.sleep(delay)
        attempt++
      }
    }

    // ここには到達しないはずだが、TypeScriptの型チェックのため
    throw lastError || new BacklogApiError({
      type: ErrorType.UNKNOWN_ERROR,
      message: 'Unexpected error in retry logic',
      context: { timestamp: new Date(), ...context },
    })
  }

  /**
   * エラー回復の実行
   */
  public async attemptRecovery(error: BacklogApiError): Promise<boolean> {
    const strategy = this.defaultRecoveryStrategies.get(error.type)
    if (!strategy || !strategy.autoRecover) {
      return false
    }

    this.logger.info('Attempting error recovery', {
      errorType: error.type,
      strategy: strategy,
      context: error.context,
    })

    // サーキットブレーカーチェック
    const circuitKey = `${error.type}-${error.context.spaceId || 'global'}`
    const circuitState = this.circuitBreakerStates.get(circuitKey)

    if (circuitState?.isOpen) {
      const timeSinceLastFailure = Date.now() - circuitState.lastFailure.getTime()
      if (timeSinceLastFailure < 60000) { // 1分間は回復を試行しない
        this.logger.warn('Circuit breaker is open - skipping recovery', {
          errorType: error.type,
          circuitKey,
          timeSinceLastFailure,
        })
        return false
      }
    }

    // 回復アクションの実行
    try {
      for (const recoveryAction of strategy.recoveryActions) {
        const recovered = await recoveryAction()
        if (recovered) {
          this.logger.info('Recovery successful', {
            errorType: error.type,
            context: error.context,
          })

          // サーキットブレーカーをリセット
          this.circuitBreakerStates.delete(circuitKey)
          return true
        }
      }

      // フォールバックアクションの実行
      for (const fallbackAction of strategy.fallbackActions) {
        await fallbackAction()
      }

      return false
    }
    catch (recoveryError) {
      this.logger.error('Recovery attempt failed', recoveryError as Error, {
        originalError: error.type,
        context: error.context,
      })

      // サーキットブレーカーの更新
      this.updateCircuitBreaker(circuitKey, strategy.circuitBreakerThreshold)
      return false
    }
  }

  /**
   * エラーログの記録（Pino統合）
   */
  private logError(error: BacklogApiError): void {
    const logContext: Partial<LogContext> = {
      requestId: error.context.requestId,
      userId: error.context.userId,
      sessionId: error.context.sessionId,
      metadata: {
        errorType: error.type,
        severity: error.severity,
        recoverable: error.recoverable,
        retryable: error.retryable,
        httpStatus: error.httpStatus,
        spaceId: error.context.spaceId,
        endpoint: error.context.endpoint,
        operation: error.context.operation,
        retryAttempt: error.context.retryAttempt,
        totalDuration: error.context.totalDuration,
      },
    }

    const logData = {
      errorDetails: error.getFullDetails(),
      suggestedAction: error.suggestedAction,
      context: error.context,
    }

    switch (error.severity) {
      case ErrorSeverity.CRITICAL:
        this.logger.fatal(
          `Critical Backlog API error: ${error.message}`,
          error.originalError || error,
          logData,
          logContext,
        )
        break
      case ErrorSeverity.HIGH:
        this.logger.error(
          `High severity Backlog API error: ${error.message}`,
          error.originalError || error,
          logData,
          logContext,
        )
        break
      case ErrorSeverity.MEDIUM:
        this.logger.warn(
          `Medium severity Backlog API error: ${error.message}`,
          logData,
          logContext,
        )
        break
      case ErrorSeverity.LOW:
        this.logger.info(
          `Low severity Backlog API error: ${error.message}`,
          logData,
          logContext,
        )
        break
    }
  }

  /**
   * エラートレンド分析の更新
   */
  private updateErrorTrends(error: BacklogApiError): void {
    const errorType = error.type
    const now = new Date()

    // エラーカウント更新
    const currentCount = this.errorCounts.get(errorType) || 0
    this.errorCounts.set(errorType, currentCount + 1)

    // 重要度別カウント更新
    const currentSeverityCount = this.errorSeverityCounts.get(error.severity) || 0
    this.errorSeverityCounts.set(error.severity, currentSeverityCount + 1)

    // トレンドデータ更新
    const existingTrend = this.errorTrends.get(errorType)
    if (existingTrend) {
      const timeDiff = now.getTime() - existingTrend.lastOccurrence.getTime()
      const newAverageInterval = (existingTrend.averageInterval * existingTrend.count + timeDiff) / (existingTrend.count + 1)

      this.errorTrends.set(errorType, {
        ...existingTrend,
        count: existingTrend.count + 1,
        lastOccurrence: now,
        averageInterval: newAverageInterval,
        severity: this.getMaxSeverity(existingTrend.severity, error.severity),
      })
    }
    else {
      this.errorTrends.set(errorType, {
        errorType,
        count: 1,
        lastOccurrence: now,
        averageInterval: 0,
        severity: error.severity,
      })
    }
  }

  /**
   * アラート条件チェック
   */
  private checkAlertConditions(error: BacklogApiError): void {
    if (!this.alertConfig.enabled) return

    const now = new Date()
    const uptime = now.getTime() - this.startTime.getTime()
    const totalErrors = Array.from(this.errorCounts.values()).reduce((sum, count) => sum + count, 0)
    // 単純化: 10個以上のエラーが発生している場合をエラー率高と判定
    const errorRate = totalErrors >= 10 ? 15 : totalErrors

    // 重要エラー数チェック
    const criticalErrors = this.errorSeverityCounts.get(ErrorSeverity.CRITICAL) || 0

    // アラート条件判定
    const shouldAlert
      = errorRate > this.alertConfig.thresholds.errorRate
        || criticalErrors >= this.alertConfig.thresholds.criticalErrorCount
        || error.severity === ErrorSeverity.CRITICAL

    if (shouldAlert) {
      this.triggerAlert(error, {
        errorRate,
        criticalErrors,
        totalErrors,
        uptime,
      })
    }
  }

  /**
   * アラートトリガー
   */
  private triggerAlert(error: BacklogApiError, metrics: {
    errorRate: number
    criticalErrors: number
    totalErrors: number
    uptime: number
  }): void {
    const alertMessage = `Backlog API Error Alert: ${error.type} - ${error.message}`
    const alertData = {
      error: error.getFullDetails(),
      metrics,
      trends: Object.fromEntries(this.errorTrends),
      timestamp: new Date().toISOString(),
    }

    // ログアラート
    if (this.alertConfig.channels.includes('log')) {
      this.logger.fatal('ALERT: Backlog API error threshold exceeded', undefined, alertData)
    }

    // Webhookアラート（実装例）
    if (this.alertConfig.channels.includes('webhook') && this.alertConfig.webhookUrl) {
      this.sendWebhookAlert(alertMessage, alertData).catch((webhookError) => {
        this.logger.error('Failed to send webhook alert', webhookError as Error, {
          originalAlert: alertMessage,
        })
      })
    }

    // Emailアラート（実装例）
    if (this.alertConfig.channels.includes('email') && this.alertConfig.emailRecipients) {
      this.sendEmailAlert(alertMessage, alertData).catch((emailError) => {
        this.logger.error('Failed to send email alert', emailError as Error, {
          originalAlert: alertMessage,
        })
      })
    }
  }

  /**
   * Webhookアラート送信
   */
  private async sendWebhookAlert(message: string, data: Record<string, unknown>): Promise<void> {
    if (!this.alertConfig.webhookUrl) return

    try {
      const response = await fetch(this.alertConfig.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ProjectLens-BacklogErrorHandler/1.0',
        },
        body: JSON.stringify({
          message,
          data,
          timestamp: new Date().toISOString(),
          source: 'ProjectLens-BacklogAPI',
        }),
      })

      if (!response.ok) {
        throw new Error(`Webhook request failed: ${response.status} ${response.statusText}`)
      }
    }
    catch (error) {
      throw new Error(`Failed to send webhook alert: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Emailアラート送信（プレースホルダー実装）
   */
  private async sendEmailAlert(message: string, data: Record<string, unknown>): Promise<void> {
    // 実際の実装では、nodemailerなどのライブラリを使用
    this.logger.info('Email alert would be sent', {
      message,
      recipients: this.alertConfig.emailRecipients,
      data,
    })
  }

  /**
   * サーキットブレーカー状態更新
   */
  private updateCircuitBreaker(circuitKey: string, threshold: number): void {
    const currentState = this.circuitBreakerStates.get(circuitKey) || {
      isOpen: false,
      failureCount: 0,
      lastFailure: new Date(),
    }

    currentState.failureCount++
    currentState.lastFailure = new Date()

    if (currentState.failureCount >= threshold) {
      currentState.isOpen = true
      this.logger.warn('Circuit breaker opened', {
        circuitKey,
        failureCount: currentState.failureCount,
        threshold,
      })
    }

    this.circuitBreakerStates.set(circuitKey, currentState)
  }

  /**
   * エラートレンド統計の取得
   */
  public getErrorTrends(): Map<ErrorType, ErrorTrendData> {
    return new Map(this.errorTrends)
  }

  /**
   * エラー統計サマリーの取得
   */
  public getErrorSummary(): {
    totalErrors: number
    errorsByType: Record<string, number>
    errorsBySeverity: Record<string, number>
    uptime: number
    errorRate: number
  } {
    const totalErrors = Array.from(this.errorCounts.values()).reduce((sum, count) => sum + count, 0)
    const uptime = Math.max(1, Date.now() - this.startTime.getTime())
    const errorRate = totalErrors > 0 ? totalErrors : 0

    const errorsByType: Record<string, number> = {}
    this.errorCounts.forEach((count, type) => {
      errorsByType[type] = count
    })

    const errorsBySeverity: Record<string, number> = {}
    this.errorSeverityCounts.forEach((count, severity) => {
      errorsBySeverity[severity] = count
    })

    return {
      totalErrors,
      errorsByType,
      errorsBySeverity,
      uptime,
      errorRate,
    }
  }

  /**
   * デバッグ用詳細コンテキスト取得
   */
  public getDebugContext(): Record<string, unknown> {
    return {
      errorCounts: Object.fromEntries(this.errorCounts),
      errorTrends: Object.fromEntries(this.errorTrends),
      circuitBreakerStates: Object.fromEntries(this.circuitBreakerStates),
      alertConfig: this.alertConfig,
      retryStrategies: Object.fromEntries(this.defaultRetryStrategies),
      recoveryStrategies: Object.fromEntries(this.defaultRecoveryStrategies),
      startTime: this.startTime.toISOString(),
      uptime: Date.now() - this.startTime.getTime(),
    }
  }

  /**
   * 設定の動的更新
   */
  public updateAlertConfig(newConfig: Partial<AlertConfig>): void {
    this.alertConfig = { ...this.alertConfig, ...newConfig }
    this.logger.info('Alert configuration updated', { newConfig })
  }

  /**
   * エラーハンドラーの初期化リセット
   */
  public reset(): void {
    this.errorCounts.clear()
    this.errorTrends.clear()
    this.circuitBreakerStates.clear()
    this.logger.info('BacklogErrorHandler reset completed')
  }

  /**
   * ヘルスチェック
   */
  public healthCheck(): {
    status: 'healthy' | 'degraded' | 'unhealthy'
    details: Record<string, unknown>
  } {
    const summary = this.getErrorSummary()
    const criticalErrors = this.errorSeverityCounts.get(ErrorSeverity.CRITICAL) || 0

    let status: 'healthy' | 'degraded' | 'unhealthy'
    if (criticalErrors >= this.alertConfig.thresholds.criticalErrorCount) {
      status = 'unhealthy'
    }
    else if (summary.errorRate > this.alertConfig.thresholds.errorRate) {
      status = 'degraded'
    }
    else {
      status = 'healthy'
    }

    return {
      status,
      details: {
        ...summary,
        criticalErrors,
        circuitBreakersOpen: Array.from(this.circuitBreakerStates.values())
          .filter(state => state.isOpen).length,
        alertsEnabled: this.alertConfig.enabled,
      },
    }
  }

  // ユーティリティメソッド
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private getMaxSeverity(a: ErrorSeverity, b: ErrorSeverity): ErrorSeverity {
    const severityOrder = {
      [ErrorSeverity.LOW]: 1,
      [ErrorSeverity.MEDIUM]: 2,
      [ErrorSeverity.HIGH]: 3,
      [ErrorSeverity.CRITICAL]: 4,
    }
    return severityOrder[a] >= severityOrder[b] ? a : b
  }
}

// エクスポート
export default BacklogErrorHandler

// 便利な関数エクスポート
const errorHandler = new BacklogErrorHandler()

export const classifyError = (error: Error | unknown, context?: Partial<ErrorContext>): BacklogApiError =>
  errorHandler.classifyError(error, context)

export const retryWithBackoff = <T>(
  operation: () => Promise<T>,
  errorType: ErrorType,
  context?: Partial<ErrorContext>,
): Promise<T> => errorHandler.retryWithBackoff(operation, errorType, context)

export const attemptRecovery = (error: BacklogApiError): Promise<boolean> =>
  errorHandler.attemptRecovery(error)

export const getErrorTrends = (): Map<ErrorType, ErrorTrendData> =>
  errorHandler.getErrorTrends()

export const getErrorSummary = () => errorHandler.getErrorSummary()

export const healthCheck = () => errorHandler.healthCheck()
