# ProjectLens ログシステムガイド

## 概要

ProjectLensは高性能な構造化ログシステムを搭載しています。[Pino](https://github.com/pinojs/pino)ライブラリをベースに、環境別設定、ファイル出力、ローテーション機能、機密情報マスキングなどエンタープライズレベルの機能を提供します。

## 主な機能

- **高性能**: Pinoベースの低オーバーヘッドロギング
- **構造化ログ**: JSON形式での出力により解析・検索が容易
- **環境別設定**: development/production/staging/test環境ごとの最適化
- **ファイルローテーション**: 自動的なログファイルのローテーションと圧縮
- **機密情報マスキング**: パスワードやトークンの自動マスキング
- **パフォーマンス計測**: 処理時間の自動計測と遅い処理の検出
- **データベースエラー統合**: SQLiteエラーの詳細な分類と対処法提案
- **クロスプラットフォーム**: Windows/macOS/Linux対応

## 基本的な使い方

### ログのインポート

```typescript
// TypeScript
import { Logger, info, error, warn, debug } from '@/electron/main/utils/logger'

// CommonJS
const { Logger, info, error, warn, debug } = require('./utils/logger.cjs')
```

### ログレベル別の出力

```typescript
// TRACE: 最も詳細なデバッグ情報
trace('詳細なデバッグ情報', { userId: 123 })

// DEBUG: デバッグ情報
debug('処理開始', { action: 'fetchUser', userId: 123 })

// INFO: 一般的な情報
info('ユーザーログイン成功', { userId: 123, timestamp: new Date() })

// WARN: 警告
warn('非推奨APIの使用', { api: 'legacyEndpoint', version: '1.0' })

// ERROR: エラー（処理は継続可能）
error('API呼び出し失敗', new Error('Connection timeout'), { retryCount: 3 })

// FATAL: 致命的エラー（アプリケーション停止レベル）
fatal('メモリ不足', new Error('Out of memory'), { availableMemory: 1024 })
```

### コンテキスト付きログ

```typescript
const logger = Logger.getInstance()

// ソース情報とリクエストIDを付加
logger.info('ユーザー認証開始',
  { userId: 456, method: 'oauth' },
  {
    source: { file: 'auth.ts', line: 125, function: 'authenticateUser' },
    requestId: 'req-789'
  }
)
```

## パフォーマンス計測

### 同期処理の計測

```typescript
import { withPerformance } from '@/electron/main/utils/logger'

const result = withPerformance('heavy-calculation', () => {
  // 重い処理
  return calculateComplexData()
})
// 自動的に処理時間がログに記録される
// 1秒以上かかると警告が出力される
```

### 非同期処理の計測

```typescript
import { withAsyncPerformance } from '@/electron/main/utils/logger'

const data = await withAsyncPerformance('database-query', async () => {
  return await db.select().from(users).where(eq(users.id, userId))
})
// 非同期処理の実行時間が自動記録される
```

## データベースエラーの統合

```typescript
import { handleDatabaseError, logDatabaseError } from '@/electron/main/utils/logger'

try {
  await db.insert(users).values({ email: 'user@example.com' })
} catch (error) {
  // エラーを分析して構造化
  const dbError = handleDatabaseError(error, {
    operation: 'insert',
    table: 'users'
  })

  // 専用のデータベースエラーログ出力
  logDatabaseError(dbError)
  // エラーの種類、重要度、推奨対処法が自動的に付加される
}
```

### データベースエラーの種類

- `CONNECTION_FAILED`: 接続エラー
- `PERMISSION_DENIED`: 権限不足
- `DISK_FULL`: ディスク容量不足
- `DATABASE_LOCKED`: ロック競合
- `CORRUPTION`: データ破損
- `MIGRATION_FAILED`: マイグレーション失敗
- `CONSTRAINT_VIOLATION`: 制約違反
- `TRANSACTION_FAILED`: トランザクション失敗

## 環境別設定

### Development環境

- カラフルなコンソール出力（pino-pretty）
- DEBUGレベル以上を出力
- ファイル出力: `~/Library/Logs/project-lens/logs/app.log` (macOS)
- ローテーション: 10MB / 5ファイル

### Production環境

- JSON形式での出力
- INFOレベル以上を出力
- ファイル出力あり
- ローテーション: 50MB / 30ファイル
- 圧縮機能有効

### Test環境

- WARNレベル以上のみ出力
- ファイル出力なし
- 最小限のログ出力

## 機密情報のマスキング

以下のパターンは自動的にマスクされます：

```typescript
// パスワードやトークンは自動的に [REDACTED] に置換
info('ユーザー認証', {
  username: 'john.doe',
  password: 'secret123',      // → [REDACTED]
  token: 'bearer-abc123',      // → [REDACTED]
  apiKey: 'key-xyz789'         // → [REDACTED]
})
```

## ログファイルの場所

### macOS

```
~/Library/Logs/project-lens/logs/app.log
```

### Windows

```
%USERPROFILE%\AppData\Local\project-lens\logs\app.log
```

### Linux

```
~/.config/project-lens/logs/app.log
```

## 設定の動的変更

```typescript
const logger = Logger.getInstance()

// ログレベルの変更
logger.setLevel('warn')  // WARN以上のみ出力

// 設定の確認
const config = logger.getConfig()
console.log('現在の環境:', config.currentEnvironment)

// ヘルスチェック
const health = logger.healthCheck()
console.log('ログシステムステータス:', health.status)
```

## ベストプラクティス

### 1. 適切なログレベルの使用

```typescript
// ❌ 悪い例: すべてをinfoで出力
info('エラーが発生しました')
info('デバッグ: 変数の値')

// ✅ 良い例: 適切なレベル分け
error('API呼び出しエラー', error)
debug('変数の値', { value })
```

### 2. 構造化データの活用

```typescript
// ❌ 悪い例: 文字列連結
info(`ユーザー ${userId} がログインしました`)

// ✅ 良い例: 構造化データ
info('ユーザーログイン', { userId, timestamp: Date.now() })
```

### 3. エラーオブジェクトの適切な渡し方

```typescript
// ❌ 悪い例: エラーメッセージのみ
error('エラー: ' + err.message)

// ✅ 良い例: エラーオブジェクト全体
error('処理エラー', err, { context: 'userRegistration' })
```

### 4. パフォーマンス計測の活用

```typescript
// 重要な処理には必ずパフォーマンス計測を追加
await withAsyncPerformance('critical-operation', async () => {
  // 重要な処理
  await processImportantData()
})
```

## トラブルシューティング

### ログが出力されない場合

1. 環境変数 `NODE_ENV` を確認
2. ログレベル設定を確認（該当レベル以上のみ出力）
3. ログディレクトリの権限を確認

### ログファイルが大きくなりすぎる場合

1. ローテーション設定を確認（maxSize, maxFiles）
2. ログレベルを上げる（debug → info）
3. 不要な詳細ログを削減

### パフォーマンスへの影響

1. Production環境では適切なログレベル（info以上）を使用
2. 大量のデータをログに含めない
3. ループ内での過度なログ出力を避ける

## 実装例

完全な実装例は以下のファイルを参照してください：

- `/electron/main/utils/logger.ts` - メインのロガー実装
- `/electron/main/utils/logger-example.ts` - 使用例集
- `/tests/electron/utils/logger.test.ts` - テストケース

## 関連ドキュメント

- [Pino公式ドキュメント](https://getpino.io/)
- [エラーハンドリングガイド](./error-handling.md)
- [データベース接続ガイド](./database.md)
