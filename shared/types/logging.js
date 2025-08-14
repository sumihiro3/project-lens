'use strict'
/**
 * ログ関連型定義
 * アプリケーションのログ機能に必要な型を定義
 */
Object.defineProperty(exports, '__esModule', { value: true })
exports.defaultLoggingConfig = void 0
/**
 * デフォルトログ設定
 */
exports.defaultLoggingConfig = {
  currentEnvironment: 'development',
  environments: {
    development: {
      environment: 'development',
      minLevel: 'debug',
      console: {
        enabled: true,
        colorize: true,
        timestampFormat: 'local',
        format: 'text',
      },
      file: {
        filePath: './logs/app.log',
        rotation: {
          maxSize: 10,
          maxFiles: 5,
          frequency: 'daily',
        },
        compression: {
          enabled: false,
          method: 'gzip',
        },
      },
      debug: true,
    },
    production: {
      environment: 'production',
      minLevel: 'info',
      console: {
        enabled: false,
        colorize: false,
        timestampFormat: 'iso',
        format: 'json',
      },
      file: {
        filePath: './logs/app.log',
        rotation: {
          maxSize: 50,
          maxFiles: 30,
          frequency: 'daily',
        },
        compression: {
          enabled: true,
          method: 'gzip',
        },
      },
      debug: false,
    },
    test: {
      environment: 'test',
      minLevel: 'warn',
      console: {
        enabled: true,
        colorize: false,
        timestampFormat: 'none',
        format: 'compact',
      },
      debug: false,
    },
    staging: {
      environment: 'staging',
      minLevel: 'debug',
      console: {
        enabled: true,
        colorize: true,
        timestampFormat: 'iso',
        format: 'json',
      },
      file: {
        filePath: './logs/app.log',
        rotation: {
          maxSize: 25,
          maxFiles: 10,
          frequency: 'daily',
        },
        compression: {
          enabled: true,
          method: 'gzip',
        },
      },
      debug: true,
    },
  },
  global: {
    appName: 'ProjectLens',
    appVersion: '1.0.0',
    maxRetentionDays: 90,
    sensitiveDataMask: {
      enabled: true,
      patterns: [
        'password\\s*[=:]\\s*[^\\s]+',
        'token\\s*[=:]\\s*[^\\s]+',
        'key\\s*[=:]\\s*[^\\s]+',
        'secret\\s*[=:]\\s*[^\\s]+',
      ],
      replacement: '[REDACTED]',
    },
    performance: {
      enabled: true,
      slowOperationThreshold: 1000,
    },
  },
}
