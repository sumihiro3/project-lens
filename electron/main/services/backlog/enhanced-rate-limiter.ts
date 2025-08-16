/**
 * Enhanced Backlog APIレート制限管理機能
 *
 * BacklogRateLimiterを基底として、Stage別並列数調整、
 * 高度な負荷分散、予測的リクエスト制御機能を追加します。
 * 複数スペース同時処理と動的パフォーマンス最適化に対応。
 */

import { BacklogRateLimiter, type ConcurrencyConfig, type RateLimitStatus, type RateLimitEvent } from './rate-limiter'
import type Database from '../../database/connection'

/**
 * Stage別並列処理設定
 */
export interface StageConfig {
  name: string
  description: string
  maxConcurrency: number
  priority: number // 1-10, 高いほど優先度が高い
  loadFactor: number // 0.1-1.0, リソース負荷係数
  adaptiveScaling: boolean // 動的スケーリング有効/無効
}

/**
 * Enhanced動的並列数調整設定
 */
export interface EnhancedConcurrencyConfig extends ConcurrencyConfig {
  globalMaxConcurrency: number // グローバル最大並列数
  stageConcurrencyRatio: number // Stage別並列数比率
  loadBalancingEnabled: boolean // 負荷分散有効化
  predictiveScaling: boolean // 予測的スケーリング
  emergencyThrottle: number // 緊急時スロットル比率
}

/**
 * 利用率分析結果
 */
export interface UtilizationAnalysis {
  currentUtilization: number // 現在の利用率 (0-1)
  projectedUtilization: number // 予測利用率 (0-1)
  trend: 'increasing' | 'decreasing' | 'stable' // トレンド
  riskLevel: 'low' | 'medium' | 'high' | 'critical' // リスクレベル
  recommendedAction: 'maintain' | 'reduce' | 'throttle' | 'emergency_stop' // 推奨アクション
  timeToLimit: number // 制限到達予測時間（ミリ秒）
}

/**
 * Stage別パフォーマンス統計
 */
export interface StagePerformanceStats {
  stageName: string
  activeRequests: number
  completedRequests: number
  failedRequests: number
  averageResponseTime: number
  throughputPerMinute: number
  utilizationRate: number
  lastOptimization: Date
}

/**
 * 拡張レート制限イベント
 */
export interface EnhancedRateLimitEvent extends RateLimitEvent {
  stageInfo?: {
    stageName: string
    concurrency: number
    utilization: UtilizationAnalysis
  }
  performanceMetrics?: StagePerformanceStats
  prediction?: {
    timeToLimit: number
    recommendedConcurrency: number
    riskAssessment: string
  }
}

/**
 * Enhanced Backlog APIレート制限管理サービス
 *
 * Stage別最適化、動的負荷調整、予測的制御、
 * マルチスペース対応を提供する高機能レートリミッター
 */
export class EnhancedRateLimiter extends BacklogRateLimiter {
  private readonly enhancedConfig: EnhancedConcurrencyConfig
  private readonly stageConfigs: Map<string, StageConfig> = new Map()
  private readonly performanceMetrics: Map<string, StagePerformanceStats> = new Map()
  private readonly utilizationHistory: Map<string, number[]> = new Map()
  private readonly globalConcurrencyTracker = new Map<string, number>()
  private optimizationInterval: NodeJS.Timeout | null = null

  /**
   * デフォルトStage設定
   */
  private static readonly DEFAULT_STAGE_CONFIGS: StageConfig[] = [
    {
      name: 'stage1',
      description: '高速並列処理（チケット一覧取得など）',
      maxConcurrency: 8,
      priority: 9,
      loadFactor: 0.8,
      adaptiveScaling: true,
    },
    {
      name: 'stage2',
      description: 'バランス型並列処理（チケット詳細取得など）',
      maxConcurrency: 3,
      priority: 7,
      loadFactor: 0.6,
      adaptiveScaling: true,
    },
    {
      name: 'stage3',
      description: '軽負荷並列処理（添付ファイル取得など）',
      maxConcurrency: 1,
      priority: 5,
      loadFactor: 0.3,
      adaptiveScaling: false,
    },
  ]

  /**
   * Enhanced設定のデフォルト値
   */
  private static readonly DEFAULT_ENHANCED_CONFIG: EnhancedConcurrencyConfig = {
    baseRate: 150,
    maxConcurrency: 10,
    minConcurrency: 1,
    safetyMargin: 0.2,
    warningThreshold: 0.1,
    globalMaxConcurrency: 20,
    stageConcurrencyRatio: 0.7,
    loadBalancingEnabled: true,
    predictiveScaling: true,
    emergencyThrottle: 0.1,
  }

  /**
   * コンストラクター
   *
   * @param db - データベース接続インスタンス
   * @param config - Enhanced動的並列数調整設定（オプション）
   */
  constructor(
    db: Database,
    config: Partial<EnhancedConcurrencyConfig> = {},
  ) {
    super(db, config)
    this.enhancedConfig = { ...EnhancedRateLimiter.DEFAULT_ENHANCED_CONFIG, ...config }

    // Stage設定を初期化
    this.initializeStageConfigs()

    // パフォーマンス監視を開始
    this.startPerformanceMonitoring()

    console.log('Enhanced レートリミッターを初期化しました', {
      globalMaxConcurrency: this.enhancedConfig.globalMaxConcurrency,
      loadBalancingEnabled: this.enhancedConfig.loadBalancingEnabled,
      predictiveScaling: this.enhancedConfig.predictiveScaling,
      stageCount: this.stageConfigs.size,
    })
  }

  /**
   * Stage別の最適並列数計算
   *
   * @param stageName - Stage名
   * @param spaceId - BacklogスペースID
   * @param endpoint - APIエンドポイント（オプション）
   * @param method - HTTPメソッド
   * @returns Stage専用の推奨並列数
   */
  public async calculateOptimalConcurrencyForStage(
    stageName: string,
    spaceId: string,
    endpoint?: string,
    method: string = 'GET',
  ): Promise<number> {
    try {
      const stageConfig = this.stageConfigs.get(stageName)
      if (!stageConfig) {
        console.warn('不明なStage名です、デフォルト並列数を返します', { stageName })
        return await this.calculateOptimalConcurrency(spaceId, endpoint, method)
      }

      // 基本的な並列数を取得
      const baseConcurrency = await this.calculateOptimalConcurrency(spaceId, endpoint, method)

      // 利用率分析を実行
      const utilization = await this.analyzeUtilizationRate(spaceId, endpoint, method)

      // Stage固有の調整を適用
      let stageConcurrency = this.applyStageConcurrencyLogic(
        baseConcurrency,
        stageConfig,
        utilization,
      )

      // グローバル並列数制限を適用
      stageConcurrency = await this.applyGlobalConcurrencyLimit(
        stageName,
        spaceId,
        stageConcurrency,
      )

      // 動的負荷調整を適用
      if (this.enhancedConfig.loadBalancingEnabled) {
        stageConcurrency = await this.applyLoadBalancing(
          stageName,
          spaceId,
          stageConcurrency,
          utilization,
        )
      }

      // パフォーマンス統計を更新
      await this.updateStagePerformanceStats(stageName, stageConcurrency, utilization)

      console.log('Stage別最適並列数を計算しました', {
        stageName,
        spaceId,
        endpoint,
        method,
        baseConcurrency,
        stageConcurrency,
        utilizationRate: utilization.currentUtilization,
        riskLevel: utilization.riskLevel,
      })

      return stageConcurrency
    }
    catch (error) {
      console.error('Stage別並列数計算に失敗しました', {
        stageName,
        spaceId,
        endpoint,
        method,
        error: error instanceof Error ? error.message : String(error),
      })
      return this.enhancedConfig.minConcurrency
    }
  }

  /**
   * 利用率分析とリスク評価
   *
   * @param spaceId - BacklogスペースID
   * @param endpoint - APIエンドポイント（オプション）
   * @param method - HTTPメソッド
   * @returns 詳細な利用率分析結果
   */
  public async analyzeUtilizationRate(
    spaceId: string,
    endpoint?: string,
    method: string = 'GET',
  ): Promise<UtilizationAnalysis> {
    try {
      const status = await this.getRateLimitStatus(spaceId, endpoint, method)
      const historyKey = this.getUtilizationHistoryKey(spaceId, endpoint, method)

      if (!status) {
        return this.createDefaultUtilizationAnalysis()
      }

      const currentUtilization = status.utilizationPercent / 100

      // 利用率履歴を更新
      this.updateUtilizationHistory(historyKey, currentUtilization)

      // トレンド分析
      const trend = this.analyzeTrend(historyKey)

      // 予測利用率を計算
      const projectedUtilization = this.calculateProjectedUtilization(
        historyKey,
        currentUtilization,
        trend,
      )

      // リスクレベルを評価
      const riskLevel = this.assessRiskLevel(currentUtilization, projectedUtilization, trend)

      // 推奨アクションを決定
      const recommendedAction = this.determineRecommendedAction(riskLevel, currentUtilization)

      // 制限到達予測時間を計算
      const timeToLimit = this.calculateTimeToLimit(status, trend)

      const analysis: UtilizationAnalysis = {
        currentUtilization,
        projectedUtilization,
        trend,
        riskLevel,
        recommendedAction,
        timeToLimit,
      }

      console.log('利用率分析を完了しました', {
        spaceId,
        endpoint,
        method,
        analysis,
      })

      return analysis
    }
    catch (error) {
      console.error('利用率分析に失敗しました', {
        spaceId,
        endpoint,
        method,
        error: error instanceof Error ? error.message : String(error),
      })
      return this.createDefaultUtilizationAnalysis()
    }
  }

  /**
   * 動的負荷調整アルゴリズム
   *
   * @param stageName - Stage名
   * @param spaceId - BacklogスペースID
   * @param baseConcurrency - 基本並列数
   * @param utilization - 利用率分析結果
   * @returns 調整後の並列数
   */
  public async applyLoadBalancing(
    stageName: string,
    spaceId: string,
    baseConcurrency: number,
    utilization: UtilizationAnalysis,
  ): Promise<number> {
    try {
      const stageConfig = this.stageConfigs.get(stageName)
      if (!stageConfig) {
        return baseConcurrency
      }

      let adjustedConcurrency = baseConcurrency

      // リスクレベルに基づく調整
      switch (utilization.riskLevel) {
        case 'critical':
          adjustedConcurrency = Math.max(1, Math.floor(baseConcurrency * this.enhancedConfig.emergencyThrottle))
          break
        case 'high':
          adjustedConcurrency = Math.max(1, Math.floor(baseConcurrency * 0.3))
          break
        case 'medium':
          adjustedConcurrency = Math.max(1, Math.floor(baseConcurrency * 0.6))
          break
        case 'low':
          // 低リスクの場合は通常通り
          break
      }

      // 推奨アクションに基づく調整
      switch (utilization.recommendedAction) {
        case 'emergency_stop':
          adjustedConcurrency = 0 // 完全停止
          break
        case 'throttle':
          adjustedConcurrency = Math.max(1, Math.floor(adjustedConcurrency * 0.2))
          break
        case 'reduce':
          adjustedConcurrency = Math.max(1, Math.floor(adjustedConcurrency * 0.5))
          break
        case 'maintain':
          // 維持
          break
      }

      // Stage優先度に基づく調整
      if (this.enhancedConfig.predictiveScaling && stageConfig.adaptiveScaling) {
        const priorityFactor = stageConfig.priority / 10 // 0.1-1.0の範囲に正規化
        adjustedConcurrency = Math.floor(adjustedConcurrency * priorityFactor)
      }

      // 最小値チェック
      adjustedConcurrency = Math.max(
        utilization.recommendedAction === 'emergency_stop' ? 0 : 1,
        adjustedConcurrency,
      )

      console.log('動的負荷調整を適用しました', {
        stageName,
        spaceId,
        baseConcurrency,
        adjustedConcurrency,
        riskLevel: utilization.riskLevel,
        recommendedAction: utilization.recommendedAction,
        priority: stageConfig.priority,
      })

      return adjustedConcurrency
    }
    catch (error) {
      console.error('動的負荷調整に失敗しました', {
        stageName,
        spaceId,
        baseConcurrency,
        error: error instanceof Error ? error.message : String(error),
      })
      return baseConcurrency
    }
  }

  /**
   * 予測的リクエスト制御（拡張版）
   *
   * @param stageName - Stage名
   * @param spaceId - BacklogスペースID
   * @param endpoint - APIエンドポイント（オプション）
   * @param method - HTTPメソッド
   * @returns 推奨遅延時間（ミリ秒）と予測情報
   */
  public async checkRequestPermissionWithPrediction(
    stageName: string,
    spaceId: string,
    endpoint?: string,
    method: string = 'GET',
  ): Promise<{
    delay: number
    prediction: {
      timeToLimit: number
      recommendedConcurrency: number
      riskAssessment: string
    }
  }> {
    try {
      const baseDelay = await this.checkRequestPermission(spaceId, endpoint, method)
      const utilization = await this.analyzeUtilizationRate(spaceId, endpoint, method)
      const optimalConcurrency = await this.calculateOptimalConcurrencyForStage(
        stageName,
        spaceId,
        endpoint,
        method,
      )

      let predictiveDelay = baseDelay

      // 予測的遅延調整
      if (this.enhancedConfig.predictiveScaling) {
        if (utilization.riskLevel === 'critical') {
          predictiveDelay = Math.max(predictiveDelay, utilization.timeToLimit)
        }
        else if (utilization.riskLevel === 'high' && utilization.trend === 'increasing') {
          // トレンドが増加傾向の場合は早めに遅延を適用
          predictiveDelay = Math.max(predictiveDelay, 2000) // 2秒の遅延
        }
      }

      const prediction = {
        timeToLimit: utilization.timeToLimit,
        recommendedConcurrency: optimalConcurrency,
        riskAssessment: `${utilization.riskLevel} risk with ${utilization.trend} trend`,
      }

      console.log('予測的リクエスト制御を実行しました', {
        stageName,
        spaceId,
        endpoint,
        method,
        baseDelay,
        predictiveDelay,
        prediction,
      })

      return {
        delay: predictiveDelay,
        prediction,
      }
    }
    catch (error) {
      console.error('予測的リクエスト制御に失敗しました', {
        stageName,
        spaceId,
        endpoint,
        method,
        error: error instanceof Error ? error.message : String(error),
      })

      return {
        delay: 0,
        prediction: {
          timeToLimit: 0,
          recommendedConcurrency: 1,
          riskAssessment: 'unknown due to error',
        },
      }
    }
  }

  /**
   * Stage設定を取得
   *
   * @param stageName - Stage名
   * @returns Stage設定
   */
  public getStageConfig(stageName: string): StageConfig | null {
    return this.stageConfigs.get(stageName) || null
  }

  /**
   * 全Stageの設定一覧を取得
   *
   * @returns Stage設定の配列
   */
  public getAllStageConfigs(): StageConfig[] {
    return Array.from(this.stageConfigs.values())
  }

  /**
   * Stage設定を更新
   *
   * @param stageName - Stage名
   * @param config - 新しいStage設定
   */
  public updateStageConfig(stageName: string, config: Partial<StageConfig>): void {
    const existingConfig = this.stageConfigs.get(stageName)
    if (existingConfig) {
      const updatedConfig = { ...existingConfig, ...config }
      this.stageConfigs.set(stageName, updatedConfig)
      console.log('Stage設定を更新しました', { stageName, updatedConfig })
    }
    else {
      console.warn('存在しないStage名です', { stageName })
    }
  }

  /**
   * Stageパフォーマンス統計を取得
   *
   * @param stageName - Stage名
   * @returns パフォーマンス統計
   */
  public getStagePerformanceStats(stageName: string): StagePerformanceStats | null {
    return this.performanceMetrics.get(stageName) || null
  }

  /**
   * 全Stageのパフォーマンス統計を取得
   *
   * @returns 全Stageのパフォーマンス統計配列
   */
  public getAllStagePerformanceStats(): StagePerformanceStats[] {
    return Array.from(this.performanceMetrics.values())
  }

  /**
   * サービスを終了し、リソースをクリーンアップ
   */
  public async destroy(): Promise<void> {
    if (this.optimizationInterval) {
      clearInterval(this.optimizationInterval)
      this.optimizationInterval = null
    }

    this.stageConfigs.clear()
    this.performanceMetrics.clear()
    this.utilizationHistory.clear()
    this.globalConcurrencyTracker.clear()

    await super.destroy()

    console.log('Enhanced レートリミッターを終了しました')
  }

  // ===================
  // プライベートメソッド
  // ===================

  /**
   * Stage設定を初期化
   */
  private initializeStageConfigs(): void {
    for (const config of EnhancedRateLimiter.DEFAULT_STAGE_CONFIGS) {
      this.stageConfigs.set(config.name, { ...config })

      // パフォーマンス統計を初期化
      this.performanceMetrics.set(config.name, {
        stageName: config.name,
        activeRequests: 0,
        completedRequests: 0,
        failedRequests: 0,
        averageResponseTime: 0,
        throughputPerMinute: 0,
        utilizationRate: 0,
        lastOptimization: new Date(),
      })
    }

    console.log('Stage設定を初期化しました', {
      stageCount: this.stageConfigs.size,
      stages: Array.from(this.stageConfigs.keys()),
    })
  }

  /**
   * Stage固有の並列数ロジックを適用
   */
  private applyStageConcurrencyLogic(
    baseConcurrency: number,
    stageConfig: StageConfig,
    utilization: UtilizationAnalysis,
  ): number {
    let stageConcurrency = baseConcurrency

    // Stage最大並列数制限
    stageConcurrency = Math.min(stageConcurrency, stageConfig.maxConcurrency)

    // 負荷係数を適用
    stageConcurrency = Math.floor(stageConcurrency * stageConfig.loadFactor)

    // 適応的スケーリング
    if (stageConfig.adaptiveScaling) {
      if (utilization.riskLevel === 'low' && utilization.trend === 'decreasing') {
        // 負荷が軽い場合は少し増加
        stageConcurrency = Math.min(
          stageConfig.maxConcurrency,
          Math.floor(stageConcurrency * 1.2),
        )
      }
      else if (utilization.riskLevel === 'high' || utilization.riskLevel === 'critical') {
        // 負荷が高い場合は削減
        stageConcurrency = Math.max(1, Math.floor(stageConcurrency * 0.5))
      }
    }

    return Math.max(1, stageConcurrency)
  }

  /**
   * グローバル並列数制限を適用
   */
  private async applyGlobalConcurrencyLimit(
    stageName: string,
    spaceId: string,
    desiredConcurrency: number,
  ): Promise<number> {
    // 現在のグローバル並列数を計算
    let currentGlobalConcurrency = 0
    for (const concurrency of this.globalConcurrencyTracker.values()) {
      currentGlobalConcurrency += concurrency
    }

    // 利用可能な並列数を計算
    const availableConcurrency = Math.max(
      0,
      this.enhancedConfig.globalMaxConcurrency - currentGlobalConcurrency,
    )

    // Stage比率を適用
    const stageAllocation = Math.floor(
      availableConcurrency * this.enhancedConfig.stageConcurrencyRatio,
    )

    const limitedConcurrency = Math.min(desiredConcurrency, stageAllocation)

    // トラッカーを更新
    const trackerKey = `${spaceId}:${stageName}`
    this.globalConcurrencyTracker.set(trackerKey, limitedConcurrency)

    console.log('グローバル並列数制限を適用しました', {
      stageName,
      spaceId,
      desiredConcurrency,
      currentGlobalConcurrency,
      availableConcurrency,
      stageAllocation,
      limitedConcurrency,
    })

    return limitedConcurrency
  }

  /**
   * 利用率履歴キーを生成
   */
  private getUtilizationHistoryKey(spaceId: string, endpoint?: string, method: string = 'GET'): string {
    return `${spaceId}:${endpoint || 'global'}:${method}`
  }

  /**
   * 利用率履歴を更新
   */
  private updateUtilizationHistory(key: string, utilization: number): void {
    let history = this.utilizationHistory.get(key) || []
    history.push(utilization)

    // 最大100件の履歴を保持
    if (history.length > 100) {
      history = history.slice(-100)
    }

    this.utilizationHistory.set(key, history)
  }

  /**
   * トレンド分析
   */
  private analyzeTrend(historyKey: string): 'increasing' | 'decreasing' | 'stable' {
    const history = this.utilizationHistory.get(historyKey) || []
    if (history.length < 3) {
      return 'stable'
    }

    const recent = history.slice(-10) // 最新10件
    const firstHalf = recent.slice(0, Math.floor(recent.length / 2))
    const secondHalf = recent.slice(Math.floor(recent.length / 2))

    const firstAvg = firstHalf.reduce((sum, val) => sum + val, 0) / firstHalf.length
    const secondAvg = secondHalf.reduce((sum, val) => sum + val, 0) / secondHalf.length

    const difference = secondAvg - firstAvg
    const threshold = 0.05 // 5%の閾値

    if (difference > threshold) {
      return 'increasing'
    }
    else if (difference < -threshold) {
      return 'decreasing'
    }
    else {
      return 'stable'
    }
  }

  /**
   * 予測利用率を計算
   */
  private calculateProjectedUtilization(
    historyKey: string,
    current: number,
    trend: 'increasing' | 'decreasing' | 'stable',
  ): number {
    const history = this.utilizationHistory.get(historyKey) || []
    if (history.length < 5) {
      return current
    }

    const recent = history.slice(-10)
    let projection = current

    switch (trend) {
      case 'increasing': {
        const increaseRate = this.calculateIncreaseRate(recent)
        projection = Math.min(1, current + increaseRate * 5) // 5分後の予測
        break
      }
      case 'decreasing': {
        const decreaseRate = this.calculateDecreaseRate(recent)
        projection = Math.max(0, current - decreaseRate * 5) // 5分後の予測
        break
      }
      case 'stable':
        projection = current
        break
    }

    return projection
  }

  /**
   * 増加率を計算
   */
  private calculateIncreaseRate(values: number[]): number {
    if (values.length < 2) return 0

    let totalIncrease = 0
    let increaseCount = 0

    for (let i = 1; i < values.length; i++) {
      const increase = values[i] - values[i - 1]
      if (increase > 0) {
        totalIncrease += increase
        increaseCount++
      }
    }

    return increaseCount > 0 ? totalIncrease / increaseCount : 0
  }

  /**
   * 減少率を計算
   */
  private calculateDecreaseRate(values: number[]): number {
    if (values.length < 2) return 0

    let totalDecrease = 0
    let decreaseCount = 0

    for (let i = 1; i < values.length; i++) {
      const decrease = values[i - 1] - values[i]
      if (decrease > 0) {
        totalDecrease += decrease
        decreaseCount++
      }
    }

    return decreaseCount > 0 ? totalDecrease / decreaseCount : 0
  }

  /**
   * リスクレベルを評価
   */
  private assessRiskLevel(
    current: number,
    projected: number,
    trend: 'increasing' | 'decreasing' | 'stable',
  ): 'low' | 'medium' | 'high' | 'critical' {
    const maxUtilization = Math.max(current, projected)

    if (maxUtilization >= 0.95) {
      return 'critical'
    }
    else if (maxUtilization >= 0.8) {
      return 'high'
    }
    else if (maxUtilization >= 0.6 || (trend === 'increasing' && maxUtilization >= 0.4)) {
      return 'medium'
    }
    else {
      return 'low'
    }
  }

  /**
   * 推奨アクションを決定
   */
  private determineRecommendedAction(
    riskLevel: 'low' | 'medium' | 'high' | 'critical',
    utilization: number,
  ): 'maintain' | 'reduce' | 'throttle' | 'emergency_stop' {
    switch (riskLevel) {
      case 'critical':
        return utilization >= 0.98 ? 'emergency_stop' : 'throttle'
      case 'high':
        return 'throttle'
      case 'medium':
        return 'reduce'
      case 'low':
      default:
        return 'maintain'
    }
  }

  /**
   * 制限到達予測時間を計算
   */
  private calculateTimeToLimit(
    status: RateLimitStatus,
    trend: 'increasing' | 'decreasing' | 'stable',
  ): number {
    if (trend === 'decreasing') {
      return Infinity // 減少傾向の場合は制限到達しない
    }

    if (status.remaining <= 0) {
      return 0 // 既に制限到達
    }

    // 現在のペースでの制限到達予測
    const utilizationRate = status.utilizationPercent / 100
    const remainingRate = 1 - utilizationRate

    if (remainingRate <= 0) {
      return 0
    }

    // 簡易的な線形予測（実際はより複雑なアルゴリズムが望ましい）
    const estimatedTimeToLimit = status.timeToReset * (remainingRate / utilizationRate)

    return Math.max(0, estimatedTimeToLimit)
  }

  /**
   * デフォルト利用率分析を作成
   */
  private createDefaultUtilizationAnalysis(): UtilizationAnalysis {
    return {
      currentUtilization: 0,
      projectedUtilization: 0,
      trend: 'stable',
      riskLevel: 'low',
      recommendedAction: 'maintain',
      timeToLimit: Infinity,
    }
  }

  /**
   * Stageパフォーマンス統計を更新
   */
  private async updateStagePerformanceStats(
    stageName: string,
    concurrency: number,
    utilization: UtilizationAnalysis,
  ): Promise<void> {
    const stats = this.performanceMetrics.get(stageName)
    if (!stats) return

    stats.activeRequests = concurrency
    stats.utilizationRate = utilization.currentUtilization
    stats.lastOptimization = new Date()

    // 実際の実装では、リクエスト完了時にcompletedRequests、failedRequests、
    // averageResponseTime、throughputPerMinuteを更新する必要があります

    this.performanceMetrics.set(stageName, stats)
  }

  /**
   * パフォーマンス監視を開始
   */
  private startPerformanceMonitoring(): void {
    // 5分毎に最適化を実行
    this.optimizationInterval = setInterval(async () => {
      try {
        await this.performGlobalOptimization()
      }
      catch (error) {
        console.error('グローバル最適化でエラーが発生しました', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }, 5 * 60 * 1000) // 5分

    console.log('パフォーマンス監視を開始しました')
  }

  /**
   * グローバル最適化を実行
   */
  private async performGlobalOptimization(): Promise<void> {
    console.log('グローバル最適化を開始しています')

    // 各Stageの統計を更新
    for (const [stageName, stats] of this.performanceMetrics.entries()) {
      // ここで実際のパフォーマンス監視ロジックを実装
      // 例：アクティブリクエスト数の調整、失敗率の監視など
      console.log('Stage統計を最適化しました', {
        stageName,
        utilizationRate: stats.utilizationRate,
        activeRequests: stats.activeRequests,
      })
    }

    // 古い利用率履歴をクリーンアップ
    for (const [key, history] of this.utilizationHistory.entries()) {
      if (history.length > 100) {
        this.utilizationHistory.set(key, history.slice(-100))
      }
    }

    console.log('グローバル最適化を完了しました')
  }
}

/**
 * Enhanced レートリミッターファクトリー関数
 *
 * @param db - データベース接続
 * @param config - Enhanced設定（オプション）
 * @returns EnhancedRateLimiterインスタンス
 */
export function createEnhancedRateLimiter(
  db: Database,
  config: Partial<EnhancedConcurrencyConfig> = {},
): EnhancedRateLimiter {
  return new EnhancedRateLimiter(db, config)
}

/**
 * デフォルトエクスポート
 */
export default EnhancedRateLimiter