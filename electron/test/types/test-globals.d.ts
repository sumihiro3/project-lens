/**
 * テスト環境用のグローバル型定義
 *
 * Vitest環境でのTypeScript型サポートを提供します。
 */

import type { MockedFunction } from 'vitest'

declare global {
  /**
   * テストユーティリティ関数群
   */
  var testUtils: {
    waitFor: (ms: number) => Promise<void>
    generateMockSpaceId: () => string
    generateMockExecutionId: () => string
    isTestEnvironment: () => boolean
  }

  /**
   * Electronメインプロセス用のグローバル型
   */
  namespace NodeJS {
    interface Global {
      testUtils: typeof testUtils
    }
  }

  /**
   * Vitest拡張マッチャー
   */
  namespace Vi {
    interface AsymmetricMatchersContaining {
      toBeOneOf<T>(values: T[]): T
    }
  }
}

/**
 * モックされたDatabase型
 */
export interface MockDatabase {
  getDrizzle: MockedFunction<any>
  testConnection: MockedFunction<() => Promise<boolean>>
  initialize: MockedFunction<(config?: any) => Promise<boolean>>
  cleanup: MockedFunction<() => Promise<boolean>>
  healthCheck: MockedFunction<() => Promise<{ isHealthy: boolean; issues: string[] }>>
  getStatus: MockedFunction<() => any>
}

/**
 * モックされたAPIClient型
 */
export interface MockApiClient {
  request: MockedFunction<any>
  get: MockedFunction<any>
  post: MockedFunction<any>
  put: MockedFunction<any>
  delete: MockedFunction<any>
  getRateLimitStatus: MockedFunction<any>
}

/**
 * モックされたRequestQueue型
 */
export interface MockRequestQueue {
  enqueue: MockedFunction<any>
  dequeue: MockedFunction<any>
  peek: MockedFunction<any>
  getSize: MockedFunction<() => number>
  clear: MockedFunction<() => Promise<void>>
  getStats: MockedFunction<() => any>
}

/**
 * モックされたCacheService型
 */
export interface MockCacheService {
  get: MockedFunction<any>
  set: MockedFunction<any>
  delete: MockedFunction<any>
  clear: MockedFunction<any>
  has: MockedFunction<any>
  getStats: MockedFunction<() => any>
}

/**
 * パフォーマンス測定結果
 */
export interface PerformanceMeasurement {
  duration: number
  memoryDelta: number
  result: any
}

/**
 * Stage実行統計
 */
export interface StageExecutionStats {
  stage1Duration: number
  stage2Duration: number
  stage3Duration: number
  totalMemoryUsage: number
  concurrentRequests: number
  successRate: number
  errorCount: number
}

/**
 * テスト用のBacklogレスポンス型
 */
export interface MockBacklogResponse<T = any> {
  success: boolean
  data: T
  statusCode: number
  headers?: Record<string, string>
}

/**
 * レート制限モックデータ
 */
export interface MockRateLimitStatus {
  limit: number
  remaining: number
  resetTime: number
  utilizationPercent: number
  timeToReset: number
}

/**
 * エラーシミュレーション用データ
 */
export interface ErrorSimulation {
  type: 'network' | 'ratelimit' | 'timeout' | 'server' | 'auth'
  message: string
  delay?: number
  retryable?: boolean
}

export {}