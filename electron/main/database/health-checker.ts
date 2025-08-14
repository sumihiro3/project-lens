/**
 * データベースヘルスチェック機能
 *
 * データベース接続の健全性チェック、パフォーマンス監視、診断機能を提供します。
 */

import type Database from 'better-sqlite3'
import { handleDatabaseError, DatabaseErrorHandler } from './utils/error-handler'
import type { DatabaseConfig } from './connection-config'

/**
 * ヘルスチェック結果
 */
export interface HealthCheckResult {
  isHealthy: boolean
  status: 'healthy' | 'warning' | 'error'
  responseTime: number
  checks: {
    connection: boolean
    diskSpace: boolean
    permissions: boolean
    performance: boolean
  }
  issues: string[]
}

/**
 * パフォーマンス統計
 */
export interface PerformanceStats {
  queryCount: number
  averageQueryTime: number
  slowQueryCount: number
}

/**
 * データベースヘルスチェッククラス
 */
export class DatabaseHealthChecker {
  private connection: Database.Database | undefined
  private config: DatabaseConfig
  private performanceStats: PerformanceStats = {
    queryCount: 0,
    averageQueryTime: 0,
    slowQueryCount: 0,
  }

  constructor(connection: Database.Database | undefined, config: DatabaseConfig) {
    this.connection = connection
    this.config = config
  }

  /**
   * 接続を更新
   */
  updateConnection(connection: Database.Database | undefined): void {
    this.connection = connection
  }

  /**
   * 設定を更新
   */
  updateConfig(config: DatabaseConfig): void {
    this.config = config
  }

  /**
   * データベース接続をテスト
   */
  async testConnection(): Promise<boolean> {
    try {
      if (!this.connection) {
        return false
      }

      const startTime = Date.now()
      this.connection.exec('SELECT 1')
      const endTime = Date.now()

      this.updatePerformanceStats(endTime - startTime)
      return true
    }
    catch (error) {
      const dbError = handleDatabaseError(error, {
        operation: 'testConnection',
      })
      console.error(`データベース接続テストに失敗: ${dbError.message}`)
      return false
    }
  }

  /**
   * データベースのヘルスチェックを実行
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now()
    const issues: string[] = []
    const checks = {
      connection: false,
      diskSpace: false,
      permissions: false,
      performance: false,
    }

    try {
      // 接続テスト
      checks.connection = await this.testConnection()
      if (!checks.connection) {
        issues.push('データベース接続が失敗しました')
      }

      // パフォーマンスチェック
      checks.performance = this.performanceStats.averageQueryTime < 100 // 100ms未満
      if (!checks.performance) {
        issues.push(`クエリの平均実行時間が遅いです: ${this.performanceStats.averageQueryTime.toFixed(2)}ms`)
      }

      // ディスク容量と権限チェック（本番環境のみ）
      if (this.config.environment === 'production' && this.connection?.name) {
        try {
          const diskSpace = await DatabaseErrorHandler.checkDiskSpace(this.connection.name)
          checks.diskSpace = diskSpace.available > 50 * 1024 * 1024 // 50MB以上
          if (!checks.diskSpace) {
            issues.push('ディスク容量が不足しています')
          }

          const permissions = await DatabaseErrorHandler.checkFilePermissions(this.connection.name)
          checks.permissions = permissions.readable && permissions.writable
          if (!checks.permissions) {
            issues.push('ファイル権限に問題があります')
          }
        }
        catch (error) {
          issues.push(`ヘルスチェック中にエラー: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      else {
        // 本番以外はチェックをスキップ
        checks.diskSpace = true
        checks.permissions = true
      }

      const responseTime = Date.now() - startTime
      const isHealthy = Object.values(checks).every(Boolean) && issues.length === 0
      
      let status: 'healthy' | 'warning' | 'error' = 'healthy'
      if (!isHealthy) {
        status = checks.connection ? 'warning' : 'error'
      }

      return {
        isHealthy,
        status,
        responseTime,
        checks,
        issues,
      }
    }
    catch (error) {
      const responseTime = Date.now() - startTime
      issues.push(`ヘルスチェックの実行中にエラー: ${error instanceof Error ? error.message : String(error)}`)
      return {
        isHealthy: false,
        status: 'error',
        responseTime,
        checks,
        issues,
      }
    }
  }

  /**
   * パフォーマンス統計を更新
   */
  updatePerformanceStats(queryTime: number): void {
    const newQueryCount = this.performanceStats.queryCount + 1
    const newAverage = ((this.performanceStats.averageQueryTime * this.performanceStats.queryCount) + queryTime) / newQueryCount
    const newSlowQueryCount = queryTime > 50 ? this.performanceStats.slowQueryCount + 1 : this.performanceStats.slowQueryCount

    this.performanceStats = {
      queryCount: newQueryCount,
      averageQueryTime: newAverage,
      slowQueryCount: newSlowQueryCount,
    }
  }

  /**
   * パフォーマンス統計を取得
   */
  getPerformanceStats(): PerformanceStats {
    return { ...this.performanceStats }
  }

  /**
   * パフォーマンス統計をリセット
   */
  resetPerformanceStats(): void {
    this.performanceStats = {
      queryCount: 0,
      averageQueryTime: 0,
      slowQueryCount: 0,
    }
  }

  /**
   * 詳細なパフォーマンスレポートを生成
   */
  generatePerformanceReport(): {
    stats: PerformanceStats
    analysis: {
      isPerformanceGood: boolean
      recommendations: string[]
    }
  } {
    const stats = this.getPerformanceStats()
    const recommendations: string[] = []
    let isPerformanceGood = true

    // 平均クエリ時間の分析
    if (stats.averageQueryTime > 100) {
      isPerformanceGood = false
      recommendations.push('平均クエリ時間が100msを超えています。インデックスの最適化を検討してください。')
    }

    // 遅いクエリの割合を分析
    if (stats.queryCount > 0) {
      const slowQueryRatio = (stats.slowQueryCount / stats.queryCount) * 100
      if (slowQueryRatio > 10) {
        isPerformanceGood = false
        recommendations.push(`遅いクエリの割合が${slowQueryRatio.toFixed(1)}%です。クエリの最適化を検討してください。`)
      }
    }

    // クエリ数が少ない場合の警告
    if (stats.queryCount < 10) {
      recommendations.push('統計データが不十分です。より多くのクエリ実行後に再度確認してください。')
    }

    return {
      stats,
      analysis: {
        isPerformanceGood,
        recommendations,
      },
    }
  }
}
