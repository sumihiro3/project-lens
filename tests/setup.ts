/**
 * Vitest グローバルセットアップ
 *
 * Electron のテスト環境とモック設定を提供します。
 */

import { beforeAll, afterEach, vi } from 'vitest'

/**
 * Mock defineI18nConfig for @nuxtjs/i18n
 * @param config - Configuration function that returns i18n settings
 */
vi.stubGlobal('defineI18nConfig', (config: () => Record<string, unknown>) => config)

/**
 * Electron API interface for testing
 */
interface MockElectronAPI {
  platform: string
  versions: {
    electron: string
  }
}

/**
 * Mock window object with Electron API
 */
interface MockWindow {
  api: MockElectronAPI
}

// Electron API のモック
vi.mock('electron', () => ({
  app: {
    getName: () => 'ProjectLens',
    getVersion: () => '1.0.0',
    getPath: (name: string) => `/mock/${name}`,
    whenReady: () => Promise.resolve(),
    quit: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
  },
  BrowserWindow: vi.fn().mockImplementation(() => ({
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn(),
    webContents: {
      send: vi.fn(),
      on: vi.fn(),
    },
    show: vi.fn(),
    hide: vi.fn(),
    close: vi.fn(),
  })),
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    removeHandler: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn(),
  },
}))

// better-sqlite3 のモック
vi.mock('better-sqlite3', () => {
  const mockDb = {
    prepare: vi.fn(() => ({
      run: vi.fn(() => ({ lastInsertRowid: 1, changes: 1 })),
      get: vi.fn(() => ({ id: 1, name: 'test' })),
      all: vi.fn(() => [{ id: 1, name: 'test' }]),
      iterate: vi.fn(function* () {
        yield { id: 1, name: 'test' }
      }),
    })),
    exec: vi.fn(),
    close: vi.fn(),
    pragma: vi.fn(() => []),
  }

  return {
    default: vi.fn(() => mockDb),
  }
})

// Global test utilities
global.testUtils = {
  // テスト用ヘルパー関数
  waitFor: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),

  // モックスペースID生成
  generateMockSpaceId: () => `test-space-${Date.now()}`,

  // モック実行ID生成
  generateMockExecutionId: () => `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,

  // テスト環境の確認
  isTestEnvironment: () => process.env.NODE_ENV === 'test' || process.env.VITEST === 'true',
}

// TypeScript 型定義の拡張
declare global {
  var testUtils: {
    waitFor: (ms: number) => Promise<void>
    generateMockSpaceId: () => string
    generateMockExecutionId: () => string
    isTestEnvironment: () => boolean
  }
}

// Performance monitoring for tests
const performanceMetrics = {
  testStartTime: Date.now(),
  memoryBaseline: process.memoryUsage(),
}

// Mock global objects for Electron environment
beforeAll(() => {
  // Mock window.api for Electron preload
  global.window = {
    api: {
      platform: 'test',
      versions: {
        electron: '33.0.0',
      },
    },
  } as MockWindow & typeof globalThis

  // Mock process.env
  process.env.NODE_ENV = 'test'

  // テスト環境でのコンソール設定
  if (global.testUtils.isTestEnvironment()) {
    // テスト実行中は一部のコンソールログを無効化
    const originalConsole = { ...console }

    console.log = vi.fn()
    console.debug = vi.fn()

    // エラーと警告は表示
    console.error = originalConsole.error
    console.warn = originalConsole.warn
  }
})

// After each test, check performance
afterEach(() => {
  const currentMemory = process.memoryUsage()
  const memoryDelta = currentMemory.heapUsed - performanceMetrics.memoryBaseline.heapUsed

  // 警告：1テストで50MB以上メモリ使用量が増加した場合
  if (memoryDelta > 50 * 1024 * 1024) {
    console.warn(`⚠️ High memory usage detected: ${Math.round(memoryDelta / 1024 / 1024)}MB`)
  }
})
