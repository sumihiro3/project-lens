/**
 * データベース接続管理システムの動作確認テスト
 * 
 * 実装したデータベース接続管理、エラーハンドリング、
 * マイグレーション機能の基本動作をテストします。
 */

import { getDatabase, initializeDatabase, executeQuery } from './connection'
import { DatabaseErrorHandler } from './utils/error-handler'

/**
 * 基本的なデータベース操作テスト
 */
async function testBasicDatabaseOperations() {
  console.log('=== データベース基本操作テスト開始 ===')
  
  try {
    // テスト環境でデータベースを初期化
    await initializeDatabase({
      environment: 'test',
      enableMigrations: false // テストではマイグレーションをスキップ
    })
    
    console.log('✓ データベース初期化成功')
    
    // 接続テスト
    const db = getDatabase()
    const isConnected = await db.testConnection()
    console.log(`✓ 接続テスト: ${isConnected ? '成功' : '失敗'}`)
    
    // スキーマテーブル作成テスト
    await executeQuery(async (db) => {
      // ユーザーテーブルを作成
      await db.run(/* sql */`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          backlog_user_id TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          email TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `)
      
      // プロジェクトテーブルを作成
      await db.run(/* sql */`
        CREATE TABLE IF NOT EXISTS projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          backlog_project_id INTEGER NOT NULL UNIQUE,
          project_key TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `)
      
      return true
    })
    
    console.log('✓ スキーマテーブル作成成功')
    
    // データ挿入テスト
    await executeQuery(async (db) => {
      const result = await db.run(/* sql */`
        INSERT INTO users (backlog_user_id, name, email) 
        VALUES ('test_user_1', 'テストユーザー1', 'test1@example.com')
      `)
      return result
    })
    
    console.log('✓ データ挿入成功')
    
    // データ検索テスト
    const users = await executeQuery(async (db) => {
      const result = await db.all(/* sql */`SELECT * FROM users`)
      return result
    })
    
    console.log(`✓ データ検索成功: ${users.length}件のユーザーを取得`)
    
    // パフォーマンス統計の確認
    const status = db.getStatus()
    console.log(`✓ パフォーマンス統計: クエリ数=${status.performance.queryCount}, 平均実行時間=${status.performance.averageQueryTime.toFixed(2)}ms`)
    
    // ヘルスチェックテスト
    const healthCheck = await db.healthCheck()
    console.log(`✓ ヘルスチェック: ${healthCheck.isHealthy ? '正常' : '問題あり'}`)
    if (!healthCheck.isHealthy) {
      console.log('  問題:', healthCheck.issues.join(', '))
    }
    
    await db.cleanup()
    console.log('✓ クリーンアップ成功')
    
  } catch (error) {
    console.error('✗ テスト失敗:', error instanceof Error ? error.message : String(error))
    throw error
  }
  
  console.log('=== データベース基本操作テスト完了 ===')
}

/**
 * エラーハンドリングテスト
 */
async function testErrorHandling() {
  console.log('=== エラーハンドリングテスト開始 ===')
  
  const errorHandler = DatabaseErrorHandler.getInstance()
  
  // 様々なエラーシナリオをテスト
  const testErrors = [
    new Error('SQLITE_CANTOPEN: unable to open database file'),
    new Error('SQLITE_PERM: access permission denied'),
    new Error('SQLITE_FULL: database or disk is full'),
    new Error('SQLITE_BUSY: database is locked'),
    new Error('SQLITE_CORRUPT: database disk image is malformed'),
    new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed'),
    new Error('Unknown database error')
  ]
  
  testErrors.forEach((error, index) => {
    const dbError = errorHandler.analyzeError(error, {
      operation: `test_operation_${index}`,
      table: 'test_table'
    })
    
    console.log(`✓ エラー${index + 1}: 種類=${dbError.type}, 重要度=${dbError.severity}, 復旧可能=${dbError.recoverable}`)
    console.log(`  メッセージ: ${dbError.message}`)
    console.log(`  推奨アクション: ${dbError.suggestedAction}`)
  })
  
  // エラー履歴の確認
  const errorHistory = errorHandler.getErrorHistory()
  console.log(`✓ エラー履歴: ${errorHistory.length}件記録済み`)
  
  // 重要度別のエラー統計
  const criticalErrors = errorHandler.getErrorsBySeverity('critical')
  const highErrors = errorHandler.getErrorsBySeverity('high')
  console.log(`✓ 重要度別統計: クリティカル=${criticalErrors.length}件, 高=${highErrors.length}件`)
  
  console.log('=== エラーハンドリングテスト完了 ===')
}

/**
 * 環境別テスト
 */
async function testEnvironmentConfigurations() {
  console.log('=== 環境別設定テスト開始 ===')
  
  const environments = ['test', 'development'] as const
  
  for (const env of environments) {
    console.log(`--- ${env}環境テスト ---`)
    
    try {
      // 異なる環境でデータベースを初期化
      const db = getDatabase()
      await db.initialize({
        environment: env,
        enableMigrations: false
      })
      
      const status = db.getStatus()
      console.log(`✓ ${env}環境初期化成功`)
      console.log(`  初期化状態: ${status.isInitialized}`)
      console.log(`  環境: ${status.environment}`)
      
      await db.cleanup()
      console.log(`✓ ${env}環境クリーンアップ成功`)
      
    } catch (error) {
      console.error(`✗ ${env}環境テスト失敗:`, error instanceof Error ? error.message : String(error))
    }
  }
  
  console.log('=== 環境別設定テスト完了 ===')
}

/**
 * メインテスト関数
 */
export async function runDatabaseTests() {
  console.log('\n📊 ProjectLens データベース接続管理システムテスト開始')
  console.log('=' .repeat(60))
  
  try {
    await testBasicDatabaseOperations()
    console.log()
    
    await testErrorHandling()
    console.log()
    
    await testEnvironmentConfigurations()
    console.log()
    
    console.log('🎉 すべてのテストが成功しました！')
    console.log('=' .repeat(60))
    
    return true
    
  } catch (error) {
    console.error('\n☠️ テスト実行中にエラーが発生しました:')
    console.error(error)
    console.log('=' .repeat(60))
    
    return false
  }
}

// スクリプトとして直接実行された場合
if (import.meta.url === `file://${process.argv[1]}`) {
  runDatabaseTests()
    .then((success) => {
      console.log('\n🚀 テスト完了')
      process.exit(success ? 0 : 1)
    })
    .catch((error) => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
}

export default { runDatabaseTests }
