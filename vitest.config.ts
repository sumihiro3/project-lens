import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 10000, // 10秒のタイムアウト
    include: [
      'tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'electron/test/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'
    ],
    exclude: [
      'node_modules',
      'dist',
      '.nuxt',
      '.output',
      'dist-electron'
    ],
    // Electronのテスト用設定
    pool: 'forks',
    isolate: true,
    // より詳細なテストレポート
    reporter: ['verbose', 'json'],
    // カバレッジ設定
    coverage: {
      enabled: true,
      provider: 'v8',
      include: [
        'electron/main/services/**/*.ts',
        'electron/main/database/**/*.ts'
      ],
      exclude: [
        'node_modules',
        'tests',
        'electron/test',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts'
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      '~': resolve(__dirname, '.'),
      '@@': resolve(__dirname, '.'),
      '~~': resolve(__dirname, '.'),
      'electron-main': resolve(__dirname, 'electron/main'),
      'shared': resolve(__dirname, 'shared')
    }
  },
  esbuild: {
    target: 'node18'
  }
})
