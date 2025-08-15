# ProjectLens エラーハンドリングガイド

## 概要

ProjectLensは統一されたエラーハンドリング基盤を提供し、エラーの分類、ログ記録、ユーザーへのフィードバック、復旧処理を体系的に管理します。

## エラーハンドリングの階層

### 1. データベースエラー層

SQLiteデータベース操作で発生するエラーを専門的に処理します。

```typescript
import { handleDatabaseError, DatabaseErrorType } from '@/electron/main/database/utils/error-handler'

try {
  const result = await db.select().from(users)
} catch (error) {
  const dbError = handleDatabaseError(error, {
    operation: 'select',
    table: 'users',
    query: 'SELECT * FROM users'
  })
  
  // エラー情報の活用
  console.log('エラータイプ:', dbError.type)
  console.log('重要度:', dbError.severity)
  console.log('復旧可能:', dbError.recoverable)
  console.log('推奨対処:', dbError.suggestedAction)
}
```

### 2. アプリケーションエラー層

ビジネスロジックレベルのエラーを処理します。

```typescript
class ApplicationError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public isOperational: boolean = true
  ) {
    super(message)
    this.name = 'ApplicationError'
  }
}

// 使用例
throw new ApplicationError(
  'ユーザーが見つかりません',
  'USER_NOT_FOUND',
  404,
  true
)
```

## エラーの分類と重要度

### 重要度レベル

| レベル | 説明 | 対応 |
|--------|------|------|
| `critical` | システム停止レベル | 即座に対応必要、アラート送信 |
| `high` | 主要機能の障害 | 早急な対応必要 |
| `medium` | 一部機能の障害 | 計画的な対応 |
| `low` | 軽微な問題 | 次回更新時に対応 |

### データベースエラーの自動分類

```typescript
enum DatabaseErrorType {
  CONNECTION_FAILED,    // critical - 接続不可
  PERMISSION_DENIED,    // critical - 権限なし
  DISK_FULL,           // high - ディスク満杯
  DATABASE_LOCKED,     // medium - ロック競合
  CORRUPTION,          // critical - データ破損
  MIGRATION_FAILED,    // high - マイグレーション失敗
  QUERY_ERROR,         // low - クエリエラー
  CONSTRAINT_VIOLATION,// low - 制約違反
  TRANSACTION_FAILED,  // medium - トランザクション失敗
  UNKNOWN             // medium - 不明なエラー
}
```

## エラーリトライ機能

### 自動リトライ

```typescript
import { executeWithRetry } from '@/electron/main/database/utils/error-handler'

// 3回まで自動リトライ、指数バックオフ付き
const result = await executeWithRetry(
  async () => {
    return await db.select().from(users)
  },
  3,      // 最大リトライ回数
  1000,   // 初期待機時間(ms)
  2       // バックオフ乗数
)
```

### カスタムリトライロジック

```typescript
async function robustDatabaseOperation() {
  let lastError: Error | undefined
  
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await performOperation()
    } catch (error) {
      lastError = error as Error
      const dbError = handleDatabaseError(error)
      
      // 復旧不可能なエラーは即座に失敗
      if (!dbError.recoverable) {
        throw error
      }
      
      // リトライ前に待機
      await new Promise(resolve => 
        setTimeout(resolve, 1000 * Math.pow(2, attempt))
      )
    }
  }
  
  throw lastError
}
```

## ユーザーフレンドリーなエラーメッセージ

### エラーメッセージの変換

```typescript
function getUserFriendlyMessage(error: DatabaseError): string {
  switch (error.type) {
    case DatabaseErrorType.CONNECTION_FAILED:
      return 'データベースに接続できませんでした。アプリケーションを再起動してください。'
    
    case DatabaseErrorType.DISK_FULL:
      return 'ディスク容量が不足しています。不要なファイルを削除してください。'
    
    case DatabaseErrorType.DATABASE_LOCKED:
      return 'データベースが使用中です。しばらくお待ちください。'
    
    default:
      return 'エラーが発生しました。サポートにお問い合わせください。'
  }
}
```

### Electronでのエラー通知

```typescript
import { dialog } from 'electron'

function showErrorDialog(error: DatabaseError) {
  const buttons = error.recoverable 
    ? ['再試行', 'キャンセル']
    : ['OK']
  
  const response = dialog.showMessageBoxSync({
    type: 'error',
    title: 'エラー',
    message: error.message,
    detail: error.suggestedAction,
    buttons
  })
  
  return response === 0 && error.recoverable
}
```

## エラーモニタリング

### エラー履歴の管理

```typescript
const errorHandler = DatabaseErrorHandler.getInstance()

// エラー履歴の取得
const recentErrors = errorHandler.getErrorHistory()

// 重要度別のエラー取得
const criticalErrors = errorHandler.getErrorsBySeverity('critical')

// エラー履歴のクリア
errorHandler.clearHistory()
```

### エラー統計

```typescript
interface ErrorStats {
  totalErrors: number
  errorsByType: Record<DatabaseErrorType, number>
  errorsBySeverity: Record<string, number>
  averageRecoveryTime: number
  mostCommonError: DatabaseErrorType
}

function calculateErrorStats(errors: DatabaseError[]): ErrorStats {
  // エラー統計の計算
  return {
    totalErrors: errors.length,
    errorsByType: groupByType(errors),
    errorsBySeverity: groupBySeverity(errors),
    averageRecoveryTime: calculateAvgRecovery(errors),
    mostCommonError: findMostCommon(errors)
  }
}
```

## 診断とトラブルシューティング

### システムチェック

```typescript
// ディスク容量チェック
const diskSpace = await DatabaseErrorHandler.checkDiskSpace('/path/to/db')
if (diskSpace.available < 100 * 1024 * 1024) {
  warn('ディスク容量が少なくなっています', {
    available: diskSpace.available,
    total: diskSpace.total
  })
}

// ファイル権限チェック
const permissions = await DatabaseErrorHandler.checkFilePermissions('/path/to/db')
if (!permissions.writable) {
  error('データベースファイルへの書き込み権限がありません')
}
```

### デバッグ情報の収集

```typescript
function collectDebugInfo(error: DatabaseError): DebugInfo {
  return {
    error: {
      type: error.type,
      message: error.message,
      stack: error.originalError.stack
    },
    system: {
      platform: process.platform,
      nodeVersion: process.version,
      memory: process.memoryUsage(),
      uptime: process.uptime()
    },
    database: {
      path: error.context?.filePath,
      operation: error.context?.operation,
      table: error.context?.table
    },
    timestamp: new Date().toISOString()
  }
}
```

## ベストプラクティス

### 1. 早期リターンパターン

```typescript
async function getUserById(id: string) {
  if (!id) {
    throw new ApplicationError('IDが必要です', 'INVALID_ID', 400)
  }
  
  try {
    const user = await db.select().from(users).where(eq(users.id, id))
    if (!user) {
      throw new ApplicationError('ユーザーが見つかりません', 'USER_NOT_FOUND', 404)
    }
    return user
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw error
    }
    const dbError = handleDatabaseError(error)
    throw new ApplicationError(
      dbError.message,
      'DATABASE_ERROR',
      500,
      dbError.recoverable
    )
  }
}
```

### 2. エラー境界の実装

```typescript
class ErrorBoundary {
  static async wrap<T>(
    operation: () => Promise<T>,
    fallback?: T
  ): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      error('操作が失敗しました', error)
      if (fallback !== undefined) {
        return fallback
      }
      throw error
    }
  }
}

// 使用例
const data = await ErrorBoundary.wrap(
  () => fetchDataFromAPI(),
  []  // フォールバック値
)
```

### 3. コンテキスト情報の充実

```typescript
// ❌ 悪い例
throw new Error('エラー')

// ✅ 良い例
throw new ApplicationError(
  'データ取得に失敗しました',
  'FETCH_ERROR',
  500,
  true,
  {
    userId,
    endpoint: '/api/data',
    timestamp: Date.now(),
    retryCount: 3
  }
)
```

## 関連ドキュメント

- [ログシステムガイド](./logging-system.md)
- [データベース接続ガイド](./database.md)
- [テストガイド](./testing.md)