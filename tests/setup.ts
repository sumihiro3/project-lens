import { beforeAll, vi } from 'vitest'

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
})
