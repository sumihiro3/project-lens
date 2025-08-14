/**
 * Logger Usage Examples
 *
 * ProjectLens Pinoログシステムの使用例を示すファイル
 * このファイルは実際のアプリケーションでは使用されません
 */

import logger, {
  trace, debug, info, warn, error, fatal,
  withPerformance, withAsyncPerformance,
  logDatabaseError,
} from './logger'
import { handleDatabaseError } from '../database/utils/error-handler'

/**
 * 基本的なログ出力例
 */
export function basicLoggingExamples(): void {
  console.log('\n=== 基本的なログ出力例 ===\n')

  // 異なるレベルのログ
  trace('デバッグ情報: 細かい処理フロー')
  debug('デバッグ: 変数値の確認', { userId: 123, action: 'login' })
  info('情報: ユーザーログイン成功', { userId: 123, timestamp: new Date() })
  warn('警告: 非推奨APIの使用', { api: 'legacyEndpoint', version: '1.0' })
  error('エラー: データベース接続失敗', new Error('接続タイムアウト'))
  fatal('致命的エラー: アプリケーション停止', new Error('メモリ不足'))
}

/**
 * コンテキスト付きログ例
 */
export function contextualLoggingExamples(): void {
  console.log('\n=== コンテキスト付きログ例 ===\n')

  // ソース情報付き
  logger.info('ユーザー認証開始',
    { userId: 456, method: 'oauth' },
    {
      source: { file: 'auth.ts', line: 125, function: 'authenticateUser' },
      requestId: 'req-789',
    },
  )

  // ユーザー固有情報付き
  logger.debug('ユーザー設定読み込み',
    { settings: { theme: 'dark', language: 'ja' } },
    { userId: 456 },
  )
}

/**
 * パフォーマンス計測例
 */
export function performanceLoggingExamples(): void {
  console.log('\n=== パフォーマンス計測例 ===\n')

  // 同期処理のパフォーマンス計測
  const result1 = withPerformance('heavy-calculation', () => {
    // 重い計算のシミュレーション
    let sum = 0
    for (let i = 0; i < 1000000; i++) {
      sum += Math.sqrt(i)
    }
    return sum
  })
  info('計算結果', { result: result1 })

  // 非同期処理のパフォーマンス計測
  withAsyncPerformance('database-query', async () => {
    // データベースクエリのシミュレーション
    await new Promise(resolve => setTimeout(resolve, 100))
    return { records: 150 }
  }).then((result) => {
    info('データベースクエリ完了', { result })
  })

  // 遅い操作のシミュレーション（警告が出る）
  withPerformance('slow-operation', () => {
    // 1.5秒の遅延（デフォルト闾値は1秒）
    const start = Date.now()
    while (Date.now() - start < 1500) {
      // ブロッキング処理
    }
    return 'completed'
  })
}

/**
 * 機密情報マスキング例
 */
export function sensitiveDataMaskingExamples(): void {
  console.log('\n=== 機密情報マスキング例 ===\n')

  // パスワードやトークンがマスクされる
  info('ユーザー認証データ', {
    username: 'john.doe',
    password: 'secret123',
    token: 'bearer-token-abc123',
    apiKey: 'api-key-xyz789',
  })

  // メッセージ内の機密情報もマスクされる
  warn('認証エラー: password=wrongpass token=invalid-token')
}

/**
 * データベースエラーログ例
 */
export function databaseErrorLoggingExamples(): void {
  console.log('\n=== データベースエラーログ例 ===\n')

  // データベース接続エラーのシミュレーション
  try {
    throw new Error('SQLITE_CANTOPEN: unable to open database file')
  }
  catch (err) {
    const dbError = handleDatabaseError(err, {
      operation: 'connect',
      filePath: '/path/to/database.sqlite',
    })

    // 特化したデータベースエラーログ
    logDatabaseError(dbError)
  }

  // データ制約違反エラー
  try {
    throw new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed')
  }
  catch (err) {
    const dbError = handleDatabaseError(err, {
      operation: 'insert',
      table: 'users',
      query: 'INSERT INTO users (email) VALUES (?)',
    })
    logDatabaseError(dbError)
  }
}

/**
 * ログ設定管理例
 */
export function configurationExamples(): void {
  console.log('\n=== ログ設定管理例 ===\n')

  // 現在の設定表示
  const currentConfig = logger.getConfig()
  info('現在のログ設定', {
    environment: currentConfig.currentEnvironment,
    minLevel: currentConfig.environments[currentConfig.currentEnvironment].minLevel,
  })

  // ログレベルの動的変更
  logger.setLevel('warn')
  info('このメッセージは表示されないはず') // warnレベルなので非表示
  warn('この警告メッセージは表示される')

  // レベルを元に戻す
  logger.setLevel('debug')
  debug('デバッグレベルに戻しました')

  // ヘルスチェック
  const health = logger.healthCheck()
  info('ロガーヘルスチェック', health)
}

/**
 * すべての例を実行
 */
export function runAllExamples(): void {
  console.log('🚀 ProjectLens Logger Examples 開始\n')

  basicLoggingExamples()
  contextualLoggingExamples()
  performanceLoggingExamples()
  sensitiveDataMaskingExamples()
  databaseErrorLoggingExamples()
  configurationExamples()

  console.log('\n✓ すべての例を実行完了\n')
}

// 直接実行された場合のみ例を実行
if (require.main === module) {
  runAllExamples()
}
