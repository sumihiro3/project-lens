/**
 * テスト環境用のグローバル型定義
 *
 * Vitest環境でのTypeScript型サポートを提供します。
 */

import type { MockedFunction } from 'vitest'
import type { ApiResponse } from '../../../shared/types/common'

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
  getDrizzle: MockedFunction<() => unknown>
  testConnection: MockedFunction<() => Promise<boolean>>
  initialize: MockedFunction<(config?: Record<string, unknown>) => Promise<boolean>>
  cleanup: MockedFunction<() => Promise<boolean>>
  healthCheck: MockedFunction<() => Promise<{ isHealthy: boolean, issues: string[] }>>
  getStatus: MockedFunction<() => Record<string, unknown>>
}

/**
 * モックされたAPIClient型
 */
export interface MockApiClient {
  request: MockedFunction<<T = unknown>(url: string, options?: RequestInit) => Promise<ApiResponse<T>>>
  get: MockedFunction<<T = unknown>(url: string, params?: Record<string, unknown>) => Promise<ApiResponse<T>>>
  post: MockedFunction<<T = unknown>(url: string, data?: Record<string, unknown>) => Promise<ApiResponse<T>>>
  put: MockedFunction<<T = unknown>(url: string, data?: Record<string, unknown>) => Promise<ApiResponse<T>>>
  delete: MockedFunction<<T = unknown>(url: string) => Promise<ApiResponse<T>>>
  getRateLimitStatus: MockedFunction<() => Promise<{ limit: number, remaining: number, resetTime: number }>>
}

/**
 * モックされたRequestQueue型
 */
export interface MockRequestQueue {
  enqueue: MockedFunction<(request: { url: string, priority: 'high' | 'normal' | 'low', data?: Record<string, unknown> }) => Promise<void>>
  dequeue: MockedFunction<() => Promise<{ url: string, priority: string, data?: Record<string, unknown> } | null>>
  peek: MockedFunction<() => { url: string, priority: string, data?: Record<string, unknown> } | null>
  getSize: MockedFunction<() => number>
  clear: MockedFunction<() => Promise<void>>
  getStats: MockedFunction<() => { total: number, pending: number, processed: number }>
}

/**
 * モックされたCacheService型
 */
export interface MockCacheService {
  get: MockedFunction<<T = unknown>(key: string) => Promise<T | null>>
  set: MockedFunction<<T = unknown>(key: string, value: T, ttl?: number) => Promise<void>>
  delete: MockedFunction<(key: string) => Promise<boolean>>
  clear: MockedFunction<() => Promise<void>>
  has: MockedFunction<(key: string) => Promise<boolean>>
  getStats: MockedFunction<() => { hits: number, misses: number, size: number }>
}

/**
 * パフォーマンス測定結果
 */
export interface PerformanceMeasurement {
  duration: number
  memoryDelta: number
  result: unknown
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
export interface MockBacklogResponse<T = unknown> {
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
