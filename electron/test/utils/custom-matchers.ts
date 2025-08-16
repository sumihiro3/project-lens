/**
 * Vitest カスタムマッチャー
 *
 * Stage統合テスト用のカスタムマッチャーを提供します。
 */

import { expect } from 'vitest'
import type { StageResult } from '../../main/services/backlog/stage-data-fetcher'
import type { UtilizationAnalysis } from '../../main/services/backlog/enhanced-rate-limiter'
import type { ErrorRecoveryResult } from '../../main/services/backlog/stage-error-handler'

/**
 * StageResult用のカスタムマッチャー
 */
expect.extend({
  /**
   * StageResultが成功しているかチェック
   */
  toBeSuccessfulStageResult(received: StageResult) {
    const pass = received.successfulRequests > 0 && 
                 received.failedRequests === 0 && 
                 received.errors.length === 0

    if (pass) {
      return {
        message: () => `expected stage result not to be successful`,
        pass: true,
      }
    } else {
      return {
        message: () => 
          `expected stage result to be successful, but got: ` +
          `successful=${received.successfulRequests}, ` +
          `failed=${received.failedRequests}, ` +
          `errors=${received.errors.length}`,
        pass: false,
      }
    }
  },

  /**
   * StageResultのパフォーマンスが許容範囲内かチェック
   */
  toHaveAcceptablePerformance(received: StageResult, expectedMaxDuration: number) {
    const actualDuration = received.endTime.getTime() - received.startTime.getTime()
    const pass = actualDuration <= expectedMaxDuration

    if (pass) {
      return {
        message: () => 
          `expected stage result not to have acceptable performance (${actualDuration}ms <= ${expectedMaxDuration}ms)`,
        pass: true,
      }
    } else {
      return {
        message: () => 
          `expected stage result to complete within ${expectedMaxDuration}ms, but took ${actualDuration}ms`,
        pass: false,
      }
    }
  },

  /**
   * StageResultのデータ取得数が期待範囲内かチェック
   */
  toHaveDataInRange(received: StageResult, minData: number, maxData?: number) {
    const totalData = received.dataSummary.projects + 
                     received.dataSummary.issues + 
                     received.dataSummary.users + 
                     received.dataSummary.other

    const pass = totalData >= minData && (maxData === undefined || totalData <= maxData)

    if (pass) {
      return {
        message: () => 
          `expected stage result not to have data in range ${minData}-${maxData || '∞'}, but got ${totalData}`,
        pass: true,
      }
    } else {
      return {
        message: () => 
          `expected stage result to have data in range ${minData}-${maxData || '∞'}, but got ${totalData}`,
        pass: false,
      }
    }
  },
})

/**
 * UtilizationAnalysis用のカスタムマッチャー
 */
expect.extend({
  /**
   * 利用率分析が高リスクかチェック
   */
  toBeHighRiskUtilization(received: UtilizationAnalysis) {
    const pass = received.riskLevel === 'high' || received.riskLevel === 'critical'

    if (pass) {
      return {
        message: () => `expected utilization analysis not to be high risk, but got ${received.riskLevel}`,
        pass: true,
      }
    } else {
      return {
        message: () => `expected utilization analysis to be high risk, but got ${received.riskLevel}`,
        pass: false,
      }
    }
  },

  /**
   * 利用率が閾値を超えているかチェック
   */
  toExceedUtilizationThreshold(received: UtilizationAnalysis, threshold: number) {
    const pass = received.currentUtilization > threshold

    if (pass) {
      return {
        message: () => 
          `expected utilization ${received.currentUtilization} not to exceed threshold ${threshold}`,
        pass: true,
      }
    } else {
      return {
        message: () => 
          `expected utilization ${received.currentUtilization} to exceed threshold ${threshold}`,
        pass: false,
      }
    }
  },
})

/**
 * ErrorRecoveryResult用のカスタムマッチャー
 */
expect.extend({
  /**
   * エラー回復が成功したかチェック
   */
  toBeSuccessfulRecovery(received: ErrorRecoveryResult) {
    const pass = received.recovered === true && received.recoveryMethod !== 'abort'

    if (pass) {
      return {
        message: () => `expected error recovery not to be successful`,
        pass: true,
      }
    } else {
      return {
        message: () => 
          `expected error recovery to be successful, but got: ` +
          `recovered=${received.recovered}, method=${received.recoveryMethod}`,
        pass: false,
      }
    }
  },

  /**
   * エラー回復時間が許容範囲内かチェック
   */
  toRecoverWithinTime(received: ErrorRecoveryResult, maxDuration: number) {
    const pass = received.recoveryDuration <= maxDuration

    if (pass) {
      return {
        message: () => 
          `expected error recovery not to complete within ${maxDuration}ms, but took ${received.recoveryDuration}ms`,
        pass: true,
      }
    } else {
      return {
        message: () => 
          `expected error recovery to complete within ${maxDuration}ms, but took ${received.recoveryDuration}ms`,
        pass: false,
      }
    }
  },
})

/**
 * 汎用的な範囲チェックマッチャー
 */
expect.extend({
  /**
   * 値が指定された配列の中の一つかチェック
   */
  toBeOneOf<T>(received: T, validValues: T[]) {
    const pass = validValues.includes(received)

    if (pass) {
      return {
        message: () => `expected ${received} not to be one of [${validValues.join(', ')}]`,
        pass: true,
      }
    } else {
      return {
        message: () => `expected ${received} to be one of [${validValues.join(', ')}]`,
        pass: false,
      }
    }
  },

  /**
   * 数値が範囲内かチェック
   */
  toBeInRange(received: number, min: number, max: number) {
    const pass = received >= min && received <= max

    if (pass) {
      return {
        message: () => `expected ${received} not to be in range [${min}, ${max}]`,
        pass: true,
      }
    } else {
      return {
        message: () => `expected ${received} to be in range [${min}, ${max}]`,
        pass: false,
      }
    }
  },

  /**
   * パフォーマンス指標が許容範囲内かチェック
   */
  toMeetPerformanceStandards(received: {
    duration: number
    memoryDelta: number
    concurrency: number
  }, standards: {
    maxDuration: number
    maxMemoryMB: number
    maxConcurrency: number
  }) {
    const memoryMB = received.memoryDelta / (1024 * 1024)
    const durationPass = received.duration <= standards.maxDuration
    const memoryPass = memoryMB <= standards.maxMemoryMB
    const concurrencyPass = received.concurrency <= standards.maxConcurrency

    const pass = durationPass && memoryPass && concurrencyPass

    if (pass) {
      return {
        message: () => `expected performance metrics not to meet standards`,
        pass: true,
      }
    } else {
      const failures = []
      if (!durationPass) failures.push(`duration: ${received.duration}ms > ${standards.maxDuration}ms`)
      if (!memoryPass) failures.push(`memory: ${memoryMB.toFixed(1)}MB > ${standards.maxMemoryMB}MB`)
      if (!concurrencyPass) failures.push(`concurrency: ${received.concurrency} > ${standards.maxConcurrency}`)

      return {
        message: () => `expected performance metrics to meet standards, but failed: ${failures.join(', ')}`,
        pass: false,
      }
    }
  },
})

/**
 * TypeScript型定義の拡張
 */
declare module 'vitest' {
  interface Assertion<T = any> {
    toBeSuccessfulStageResult(): T
    toHaveAcceptablePerformance(maxDuration: number): T
    toHaveDataInRange(minData: number, maxData?: number): T
    toBeHighRiskUtilization(): T
    toExceedUtilizationThreshold(threshold: number): T
    toBeSuccessfulRecovery(): T
    toRecoverWithinTime(maxDuration: number): T
    toBeOneOf<U>(validValues: U[]): T
    toBeInRange(min: number, max: number): T
    toMeetPerformanceStandards(standards: {
      maxDuration: number
      maxMemoryMB: number
      maxConcurrency: number
    }): T
  }

  interface AsymmetricMatchersContaining {
    toBeSuccessfulStageResult(): any
    toHaveAcceptablePerformance(maxDuration: number): any
    toHaveDataInRange(minData: number, maxData?: number): any
    toBeHighRiskUtilization(): any
    toExceedUtilizationThreshold(threshold: number): any
    toBeSuccessfulRecovery(): any
    toRecoverWithinTime(maxDuration: number): any
    toBeOneOf<T>(validValues: T[]): any
    toBeInRange(min: number, max: number): any
    toMeetPerformanceStandards(standards: {
      maxDuration: number
      maxMemoryMB: number
      maxConcurrency: number
    }): any
  }
}

export {}