import { beforeAll, vi } from 'vitest'

// Mock defineI18nConfig for @nuxtjs/i18n
vi.stubGlobal('defineI18nConfig', (config: () => any) => config)

// Mock global objects for Electron environment
beforeAll(() => {
  // Mock window.api for Electron preload
  global.window = {
    api: {
      platform: 'test',
      versions: {
        electron: '33.0.0'
      }
    }
  } as any

  // Mock process.env
  process.env.NODE_ENV = 'test'
})