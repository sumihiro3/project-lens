/**
 * Backlog Stage Error Handler
 *
 * Stage別データ取得プロセスに特化したエラーハンドリングシステム。
 * Stage 1-3の異なる特性に応じた適応的リトライ戦略と、
 * 詳細なエラー分析・回復機能を提供します。
 *
 * Features:
 * - Stage別適応的エラーハンドリング戦略
 * - 指数バックオフ + ジッター付きリトライアルゴリズム
 * - エラー分類と永続的エラー検出
 * - syncLogsテーブルへの詳細ログ記録
 * - エラー統計とトレンド分析
 * - アラート機能とエスカレーション
 * - 既存BacklogErrorHandlerとの統合
 *
 * Stage特性:
 * - Stage 1: 高優先度 - 即座リトライ、短い間隔
 * - Stage 2: 中優先度 - 遅延リトライ、バックグラウンド処理
 * - Stage 3: 低優先度 - 緩和されたリトライ、負荷制限
 */

import type { Database } from '../../database/connection'
import { syncLogs } from '../../database/schema'
import type { BacklogApiError } from './error-handler'
import { BacklogErrorHandler, ErrorType, ErrorSeverity } from './error-handler'
import { Logger } from '../../utils/logger'

/**
 * Stage種別定義
 */
export enum StageType {
  STAGE_1_HIGH_PRIORITY = 'stage_1_high_priority',
  STAGE_2_BACKGROUND = 'stage_2_background',
  STAGE_3_IDLE = 'stage_3_idle',
}

/**
 * Stage別エラーハンドリング戦略
 */
export interface StageRetryStrategy {
  /** 最大リトライ回数 */
  maxRetries: number
  /** 基本遅延時間（ミリ秒） */
  baseDelayMs: number
  /** 最大遅延時間（ミリ秒） */
  maxDelayMs: number
  /** 指数バックオフ係数 */
  backoffMultiplier: number
  /** ジッター範囲（ミリ秒） */
  jitterRangeMs: number
  /** リトライ対象エラータイプ */
  retryableErrors: ErrorType[]
  /** Stage固有のリトライ条件 */
  customRetryCondition?: (error: BacklogApiError, attemptCount: number, stage: StageType) => boolean
  /** Stage間でのエスカレーション有効化 */
  enableEscalation: boolean
}

/**
 * エラー統計データ
 */
export interface StageErrorStats {
  /** Stage別エラー数 */
  stageErrorCounts: Record<StageType, number>
  /** エラータイプ別統計 */
  errorTypeStats: Record<ErrorType, {
    count: number
    lastOccurrence: Date
    averageRecoveryTime: number
    successfulRetries: number
    failedRetries: number
  }>
  /** Stage別成功率 */
  stageSuccessRates: Record<StageType, number>
  /** 永続的エラーの検出統計 */
  persistentErrors: Array<{
    errorType: ErrorType
    stage: StageType
    consecutiveFailures: number
    firstOccurrence: Date
    lastOccurrence: Date
    spaceId: string
    endpoint: string
  }>
  /** エラーパターン分析 */
  errorPatterns: {
    timeOfDayDistribution: Record<number, number>
    dayOfWeekDistribution: Record<number, number>
    correlatedErrors: Array<{
      primary: ErrorType
      secondary: ErrorType
      correlationStrength: number
    }>
  }
}

/**
 * Stage実行コンテキスト
 */
export interface StageExecutionContext {
  /** スペースID */
  spaceId: string
  /** Stage種別 */
  stage: StageType
  /** 処理対象エンドポイント */
  endpoint: string
  /** リクエストパラメータ */
  params: Record<string, unknown>
  /** 実行開始時刻 */
  startTime: Date
  /** タスクID */
  taskId?: string
  /** 優先度 */
  priority: 'high' | 'medium' | 'low'
  /** 実行コンテキストID */
  executionId: string
  /** 依存関係 */
  dependencies?: string[]
}

/**
 * エラー回復結果
 */
export interface ErrorRecoveryResult {
  /** 回復成功フラグ */
  recovered: boolean
  /** 回復方法 */
  recoveryMethod: 'retry' | 'fallback' | 'escalation' | 'abort'
  /** 回復にかかった時間（ミリ秒） */
  recoveryDuration: number
  /** 実行されたリトライ回数 */
  retriesAttempted: number
  /** 最終的なエラー（回復失敗時） */
  finalError?: BacklogApiError
  /** 回復ログ */
  recoveryLog: string[]
}

/**
 * Stage Error Handler
 *
 * Stage別の特性に応じたエラーハンドリングを提供する専門クラス。
 * 既存のBacklogErrorHandlerと連携し、Stage固有の要件に対応します。
 */
export class StageErrorHandler {
  private readonly database: Database
  private readonly backlogErrorHandler: BacklogErrorHandler
  private readonly logger: Logger

  // Stage別戦略設定
  private readonly stageStrategies: Map<StageType, StageRetryStrategy>

  // エラー統計と状態管理
  private readonly errorStats: StageErrorStats
  private readonly activeRetries = new Map<string, {
    context: StageExecutionContext
    attempt: number
    startTime: Date
    lastRetryTime: Date
  }>()

  // 永続的エラー検出
  private readonly persistentErrorTracker = new Map<string, {
    errorType: ErrorType
    consecutiveFailures: number
    firstFailure: Date
    lastFailure: Date
  }>()

  // アラート制御
  private readonly alertThresholds = {
    persistentErrorThreshold: 5, // 連続失敗回数
    criticalErrorRateThreshold: 0.5, // 50%以上の失敗率でアラート
    escalationTimeoutMs: 300000, // 5分でエスカレーション
  }

  /**
   * デフォルトStage別戦略設定
   */
  private static readonly DEFAULT_STAGE_STRATEGIES: Map<StageType, StageRetryStrategy> = new Map([
    [StageType.STAGE_1_HIGH_PRIORITY, {
      maxRetries: 5,
      baseDelayMs: 500,
      maxDelayMs: 8000,
      backoffMultiplier: 1.8,
      jitterRangeMs: 200,
      retryableErrors: [
        ErrorType.NETWORK_ERROR,
        ErrorType.CONNECTION_TIMEOUT,
        ErrorType.API_ERROR,
        ErrorType.RATE_LIMIT_ERROR,
        ErrorType.MALFORMED_RESPONSE,
      ],
      enableEscalation: true,
    }],
    [StageType.STAGE_2_BACKGROUND, {
      maxRetries: 8,
      baseDelayMs: 2000,
      maxDelayMs: 60000, // 1分
      backoffMultiplier: 2.0,
      jitterRangeMs: 1000,
      retryableErrors: [
        ErrorType.NETWORK_ERROR,
        ErrorType.CONNECTION_TIMEOUT,
        ErrorType.API_ERROR,
        ErrorType.RATE_LIMIT_ERROR,
        ErrorType.MALFORMED_RESPONSE,
        ErrorType.THIRD_PARTY_SERVICE_ERROR,
      ],
      enableEscalation: false,
    }],
    [StageType.STAGE_3_IDLE, {
      maxRetries: 3,
      baseDelayMs: 5000,
      maxDelayMs: 300000, // 5分
      backoffMultiplier: 2.5,
      jitterRangeMs: 2000,
      retryableErrors: [
        ErrorType.NETWORK_ERROR,
        ErrorType.API_ERROR,
        ErrorType.RATE_LIMIT_ERROR,
      ],
      enableEscalation: false,
    }],
  ])

  constructor(
    database: Database,
    backlogErrorHandler?: BacklogErrorHandler,
  ) {
    this.database = database
    this.backlogErrorHandler = backlogErrorHandler || new BacklogErrorHandler()
    this.logger = Logger.getInstance()
    this.stageStrategies = new Map(StageErrorHandler.DEFAULT_STAGE_STRATEGIES)

    // エラー統計の初期化
    this.errorStats = {
      stageErrorCounts: {
        [StageType.STAGE_1_HIGH_PRIORITY]: 0,
        [StageType.STAGE_2_BACKGROUND]: 0,
        [StageType.STAGE_3_IDLE]: 0,
      },
      errorTypeStats: Object.fromEntries(
        Object.values(ErrorType).map(type => [type, {
          count: 0,
          lastOccurrence: new Date(),
          averageRecoveryTime: 0,
          successfulRetries: 0,
          failedRetries: 0,
        }]),
      ) as any,
      stageSuccessRates: {
        [StageType.STAGE_1_HIGH_PRIORITY]: 1.0,
        [StageType.STAGE_2_BACKGROUND]: 1.0,
        [StageType.STAGE_3_IDLE]: 1.0,
      },
      persistentErrors: [],
      errorPatterns: {
        timeOfDayDistribution: {},
        dayOfWeekDistribution: {},
        correlatedErrors: [],
      },
    }

    this.logger.info('StageErrorHandler initialized', {
      strategies: Array.from(this.stageStrategies.keys()),
      alertThresholds: this.alertThresholds,
    })
  }

  /**
   * Stage実行をエラーハンドリング付きで実行
   *
   * @param context Stage実行コンテキスト
   * @param operation 実行する操作
   * @returns 実行結果または回復結果
   */
  async executeWithErrorHandling<T>(
    context: StageExecutionContext,
    operation: () => Promise<T>,
  ): Promise<T> {
    const strategy = this.stageStrategies.get(context.stage)
    if (!strategy) {
      throw new Error(`No strategy defined for stage: ${context.stage}`)
    }

    const executionKey = `${context.spaceId}:${context.stage}:${context.endpoint}:${context.executionId}`
    let lastError: BacklogApiError | null = null
    let attempt = 0

    // アクティブリトライを記録
    this.activeRetries.set(executionKey, {
      context,
      attempt: 0,
      startTime: context.startTime,
      lastRetryTime: context.startTime,
    })

    try {
      while (attempt <= strategy.maxRetries) {
        try {
          const result = await operation()

          // 成功時の処理
          if (attempt > 0) {
            await this.recordSuccessfulRecovery(context, attempt, lastError)
          }

          // 永続的エラートラッカーをリセット
          this.resetPersistentErrorTracking(context)

          return result
        }
        catch (error) {
          const classifiedError = this.backlogErrorHandler.classifyError(error, {
            spaceId: context.spaceId,
            endpoint: context.endpoint,
            operation: `${context.stage}_execution`,
            retryAttempt: attempt,
          })

          lastError = classifiedError

          // エラー統計を更新
          this.updateErrorStats(context, classifiedError, attempt)

          // 永続的エラーを追跡
          this.trackPersistentError(context, classifiedError)

          // リトライ可能性をチェック
          if (!this.shouldRetry(classifiedError, attempt, strategy, context)) {
            await this.recordFinalFailure(context, classifiedError, attempt)
            throw classifiedError
          }

          // 遅延計算とリトライ実行
          const delay = this.calculateRetryDelay(strategy, attempt)

          this.logger.warn('Stage operation failed, retrying', {
            stage: context.stage,
            spaceId: context.spaceId,
            endpoint: context.endpoint,
            errorType: classifiedError.type,
            attempt: attempt + 1,
            maxRetries: strategy.maxRetries,
            delayMs: delay,
            executionId: context.executionId,
          })

          await this.sleep(delay)
          attempt++

          // アクティブリトライ情報を更新
          const retryInfo = this.activeRetries.get(executionKey)
          if (retryInfo) {
            retryInfo.attempt = attempt
            retryInfo.lastRetryTime = new Date()
          }
        }
      }

      // 最大リトライ回数に達した場合
      if (lastError) {
        await this.recordFinalFailure(context, lastError, attempt)

        // エスカレーション判定
        if (strategy.enableEscalation && this.shouldEscalate(context, lastError)) {
          await this.escalateError(context, lastError)
        }

        throw lastError
      }

      throw new Error('Unexpected error: No result and no error')
    }
    finally {
      // アクティブリトライを削除
      this.activeRetries.delete(executionKey)
    }
  }

  /**
   * エラー回復を試行
   *
   * @param context 実行コンテキスト
   * @param error 発生したエラー
   * @returns 回復結果
   */
  async attemptRecovery(
    context: StageExecutionContext,
    error: BacklogApiError,
  ): Promise<ErrorRecoveryResult> {
    const startTime = Date.now()
    const recoveryLog: string[] = []
    const retriesAttempted = 0

    recoveryLog.push(`Starting error recovery for ${context.stage} at ${new Date().toISOString()}`)

    try {
      // 1. 基本的なエラー回復を試行
      const basicRecovery = await this.backlogErrorHandler.attemptRecovery(error)
      if (basicRecovery) {
        recoveryLog.push('Basic error recovery successful')
        return {
          recovered: true,
          recoveryMethod: 'retry',
          recoveryDuration: Date.now() - startTime,
          retriesAttempted: 1,
          recoveryLog,
        }
      }

      // 2. Stage固有の回復戦略
      const stageRecovery = await this.attemptStageSpecificRecovery(context, error)
      if (stageRecovery.recovered) {
        recoveryLog.push(`Stage-specific recovery successful: ${stageRecovery.recoveryMethod}`)
        return {
          ...stageRecovery,
          recoveryDuration: Date.now() - startTime,
          recoveryLog: [...recoveryLog, ...stageRecovery.recoveryLog],
        }
      }

      // 3. フォールバック戦略
      const fallbackRecovery = await this.attemptFallbackRecovery(context, error)
      if (fallbackRecovery.recovered) {
        recoveryLog.push('Fallback recovery successful')
        return {
          ...fallbackRecovery,
          recoveryDuration: Date.now() - startTime,
          recoveryLog: [...recoveryLog, ...fallbackRecovery.recoveryLog],
        }
      }

      recoveryLog.push('All recovery attempts failed')
      return {
        recovered: false,
        recoveryMethod: 'abort',
        recoveryDuration: Date.now() - startTime,
        retriesAttempted,
        finalError: error,
        recoveryLog,
      }
    }
    catch (recoveryError) {
      recoveryLog.push(`Recovery attempt failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`)
      return {
        recovered: false,
        recoveryMethod: 'abort',
        recoveryDuration: Date.now() - startTime,
        retriesAttempted,
        finalError: error,
        recoveryLog,
      }
    }
  }

  /**
   * エラー統計を取得
   *
   * @returns 現在のエラー統計
   */
  getErrorStats(): StageErrorStats {
    return structuredClone(this.errorStats)
  }

  /**
   * Stage別戦略を更新
   *
   * @param stage 対象Stage
   * @param strategy 新しい戦略
   */
  updateStageStrategy(stage: StageType, strategy: Partial<StageRetryStrategy>): void {
    const currentStrategy = this.stageStrategies.get(stage)
    if (currentStrategy) {
      this.stageStrategies.set(stage, { ...currentStrategy, ...strategy })
      this.logger.info('Stage strategy updated', {
        stage,
        updatedFields: Object.keys(strategy),
      })
    }
  }

  /**
   * 永続的エラーをリセット
   *
   * @param spaceId スペースID
   * @param errorType エラータイプ（オプション）
   */
  resetPersistentErrors(spaceId: string, errorType?: ErrorType): void {
    const keysToDelete: string[] = []

    this.persistentErrorTracker.forEach((tracker, key) => {
      if (key.startsWith(spaceId) && (!errorType || tracker.errorType === errorType)) {
        keysToDelete.push(key)
      }
    })

    keysToDelete.forEach(key => this.persistentErrorTracker.delete(key))

    this.logger.info('Persistent errors reset', {
      spaceId,
      errorType,
      resetCount: keysToDelete.length,
    })
  }

  /**
   * リソースクリーンアップ
   */
  async dispose(): Promise<void> {
    this.activeRetries.clear()
    this.persistentErrorTracker.clear()
    this.logger.info('StageErrorHandler disposed')
  }

  // ===================
  // プライベートメソッド
  // ===================

  /**
   * リトライ可能性を判定
   */
  private shouldRetry(
    error: BacklogApiError,
    attempt: number,
    strategy: StageRetryStrategy,
    context: StageExecutionContext,
  ): boolean {
    // 最大リトライ回数チェック
    if (attempt >= strategy.maxRetries) {
      return false
    }

    // エラータイプによるリトライ可能性チェック
    if (!strategy.retryableErrors.includes(error.type)) {
      return false
    }

    // 永続的エラーチェック
    if (this.isPersistentError(context, error)) {
      return false
    }

    // カスタム条件チェック
    if (strategy.customRetryCondition) {
      return strategy.customRetryCondition(error, attempt, context.stage)
    }

    return true
  }

  /**
   * リトライ遅延を計算（指数バックオフ + ジッター）
   */
  private calculateRetryDelay(strategy: StageRetryStrategy, attempt: number): number {
    const exponentialDelay = strategy.baseDelayMs * Math.pow(strategy.backoffMultiplier, attempt)
    const jitter = Math.random() * strategy.jitterRangeMs
    const totalDelay = exponentialDelay + jitter

    return Math.min(totalDelay, strategy.maxDelayMs)
  }

  /**
   * エラー統計を更新
   */
  private updateErrorStats(
    context: StageExecutionContext,
    error: BacklogApiError,
    attempt: number,
  ): void {
    // Stage別エラーカウント
    this.errorStats.stageErrorCounts[context.stage]++

    // エラータイプ統計
    const typeStats = this.errorStats.errorTypeStats[error.type]
    if (typeStats) {
      typeStats.count++
      typeStats.lastOccurrence = new Date()

      if (attempt > 0) {
        typeStats.failedRetries++
      }
    }

    // 時刻パターン分析
    const hour = new Date().getHours()
    const dayOfWeek = new Date().getDay()

    this.errorStats.errorPatterns.timeOfDayDistribution[hour]
      = (this.errorStats.errorPatterns.timeOfDayDistribution[hour] || 0) + 1

    this.errorStats.errorPatterns.dayOfWeekDistribution[dayOfWeek]
      = (this.errorStats.errorPatterns.dayOfWeekDistribution[dayOfWeek] || 0) + 1
  }

  /**
   * 永続的エラーを追跡
   */
  private trackPersistentError(context: StageExecutionContext, error: BacklogApiError): void {
    const key = `${context.spaceId}:${error.type}:${context.endpoint}`
    const existing = this.persistentErrorTracker.get(key)

    if (existing) {
      existing.consecutiveFailures++
      existing.lastFailure = new Date()
    }
    else {
      this.persistentErrorTracker.set(key, {
        errorType: error.type,
        consecutiveFailures: 1,
        firstFailure: new Date(),
        lastFailure: new Date(),
      })
    }

    // 永続的エラーとして記録
    const tracker = this.persistentErrorTracker.get(key)
    if (!tracker) return
    if (tracker.consecutiveFailures >= this.alertThresholds.persistentErrorThreshold) {
      this.errorStats.persistentErrors.push({
        errorType: error.type,
        stage: context.stage,
        consecutiveFailures: tracker.consecutiveFailures,
        firstOccurrence: tracker.firstFailure,
        lastOccurrence: tracker.lastFailure,
        spaceId: context.spaceId,
        endpoint: context.endpoint,
      })
    }
  }

  /**
   * 永続的エラーかどうかを判定
   */
  private isPersistentError(context: StageExecutionContext, error: BacklogApiError): boolean {
    const key = `${context.spaceId}:${error.type}:${context.endpoint}`
    const tracker = this.persistentErrorTracker.get(key)

    return tracker !== undefined
      && tracker.consecutiveFailures >= this.alertThresholds.persistentErrorThreshold
  }

  /**
   * 永続的エラートラッキングをリセット
   */
  private resetPersistentErrorTracking(context: StageExecutionContext): void {
    const keysToDelete: string[] = []

    this.persistentErrorTracker.forEach((_, key) => {
      if (key.startsWith(`${context.spaceId}:`) && key.includes(`:${context.endpoint}`)) {
        keysToDelete.push(key)
      }
    })

    keysToDelete.forEach(key => this.persistentErrorTracker.delete(key))
  }

  /**
   * 成功時の回復を記録
   */
  private async recordSuccessfulRecovery(
    context: StageExecutionContext,
    attempts: number,
    lastError: BacklogApiError | null,
  ): Promise<void> {
    if (lastError) {
      // エラータイプ統計の更新
      const typeStats = this.errorStats.errorTypeStats[lastError.type]
      if (typeStats) {
        typeStats.successfulRetries++
        typeStats.averageRecoveryTime
          = (typeStats.averageRecoveryTime + (Date.now() - context.startTime.getTime())) / 2
      }
    }

    // syncLogsテーブルに記録
    try {
      await this.database.getDrizzle()
        .insert(syncLogs)
        .values({
          connectionId: context.spaceId,
          syncType: `${context.stage}_recovery`,
          status: 'completed',
          startedAt: context.startTime.toISOString(),
          completedAt: new Date().toISOString(),
          itemsProcessed: 1,
          itemsUpdated: 1,
          itemsCreated: 0,
          itemsDeleted: 0,
          errorMessage: null,
          errorDetails: JSON.stringify({
            recoveredFromError: lastError?.type,
            attemptsRequired: attempts,
            stage: context.stage,
            endpoint: context.endpoint,
            executionId: context.executionId,
          }),
        })
    }
    catch (dbError) {
      this.logger.error('Failed to record successful recovery to syncLogs', dbError as Error, {
        context,
        attempts,
        lastErrorType: lastError?.type,
      })
    }
  }

  /**
   * 最終失敗を記録
   */
  private async recordFinalFailure(
    context: StageExecutionContext,
    error: BacklogApiError,
    attempts: number,
  ): Promise<void> {
    // Stage成功率を更新
    const currentRate = this.errorStats.stageSuccessRates[context.stage]
    this.errorStats.stageSuccessRates[context.stage]
      = Math.max(0, currentRate - 0.01) // 1%減少

    // syncLogsテーブルに記録
    try {
      await this.database.getDrizzle()
        .insert(syncLogs)
        .values({
          connectionId: context.spaceId,
          syncType: context.stage,
          status: 'failed',
          startedAt: context.startTime.toISOString(),
          completedAt: new Date().toISOString(),
          itemsProcessed: 0,
          itemsUpdated: 0,
          itemsCreated: 0,
          itemsDeleted: 0,
          errorMessage: error.message,
          errorDetails: JSON.stringify({
            errorType: error.type,
            severity: error.severity,
            attempts,
            stage: context.stage,
            endpoint: context.endpoint,
            executionId: context.executionId,
            context: error.context,
            suggestedAction: error.suggestedAction,
            httpStatus: error.httpStatus,
          }),
        })
    }
    catch (dbError) {
      this.logger.error('Failed to record final failure to syncLogs', dbError as Error, {
        context,
        error: error.getFullDetails(),
      })
    }
  }

  /**
   * エスカレーション判定
   */
  private shouldEscalate(context: StageExecutionContext, error: BacklogApiError): boolean {
    // 重要度による判定
    if (error.severity === ErrorSeverity.CRITICAL) {
      return true
    }

    // Stage 1の場合は積極的にエスカレーション
    if (context.stage === StageType.STAGE_1_HIGH_PRIORITY) {
      return true
    }

    // 実行時間による判定
    const executionDuration = Date.now() - context.startTime.getTime()
    if (executionDuration > this.alertThresholds.escalationTimeoutMs) {
      return true
    }

    return false
  }

  /**
   * エラーエスカレーション実行
   */
  private async escalateError(context: StageExecutionContext, error: BacklogApiError): Promise<void> {
    this.logger.error('Escalating Stage error', error.originalError || error, {
      stage: context.stage,
      spaceId: context.spaceId,
      endpoint: context.endpoint,
      errorType: error.type,
      severity: error.severity,
      executionId: context.executionId,
      escalationReason: this.getEscalationReason(context, error),
    })

    // アラートシステムへの通知（実装は環境に依存）
    // TODO: 実際の実装ではSlack、メール、Webhookなどに通知
  }

  /**
   * エスカレーション理由を取得
   */
  private getEscalationReason(context: StageExecutionContext, error: BacklogApiError): string {
    const reasons: string[] = []

    if (error.severity === ErrorSeverity.CRITICAL) {
      reasons.push('Critical error severity')
    }

    if (context.stage === StageType.STAGE_1_HIGH_PRIORITY) {
      reasons.push('High priority stage failure')
    }

    const executionDuration = Date.now() - context.startTime.getTime()
    if (executionDuration > this.alertThresholds.escalationTimeoutMs) {
      reasons.push(`Execution timeout (${Math.round(executionDuration / 1000)}s)`)
    }

    return reasons.join(', ')
  }

  /**
   * Stage固有の回復を試行
   */
  private async attemptStageSpecificRecovery(
    context: StageExecutionContext,
    _error: BacklogApiError,
  ): Promise<ErrorRecoveryResult> {
    const recoveryLog: string[] = []

    switch (context.stage) {
      case StageType.STAGE_1_HIGH_PRIORITY:
        recoveryLog.push('Attempting high-priority stage recovery')
        // 即座の代替エンドポイント試行など
        break

      case StageType.STAGE_2_BACKGROUND:
        recoveryLog.push('Attempting background stage recovery')
        // より長い待機時間での再試行など
        break

      case StageType.STAGE_3_IDLE:
        recoveryLog.push('Attempting idle stage recovery')
        // 次回実行への延期など
        break
    }

    // 基本的な実装：常に失敗を返す（具体的な回復ロジックは要件に応じて実装）
    return {
      recovered: false,
      recoveryMethod: 'abort',
      recoveryDuration: 0,
      retriesAttempted: 0,
      recoveryLog,
    }
  }

  /**
   * フォールバック回復を試行
   */
  private async attemptFallbackRecovery(
    _context: StageExecutionContext,
    _error: BacklogApiError,
  ): Promise<ErrorRecoveryResult> {
    const recoveryLog: string[] = ['Attempting fallback recovery']

    // 基本的な実装：キャッシュからのデータ取得、デフォルト値の使用など
    // 具体的な実装は要件に応じて追加

    return {
      recovered: false,
      recoveryMethod: 'abort',
      recoveryDuration: 0,
      retriesAttempted: 0,
      recoveryLog,
    }
  }

  /**
   * 遅延実行
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

/**
 * Stage Error Handler ファクトリー関数
 *
 * @param database データベース接続
 * @param backlogErrorHandler 既存のBacklogErrorHandler（オプション）
 * @returns 新しいStageErrorHandlerインスタンス
 */
export function createStageErrorHandler(
  database: Database,
  backlogErrorHandler?: BacklogErrorHandler,
): StageErrorHandler {
  return new StageErrorHandler(database, backlogErrorHandler)
}

export default StageErrorHandler
