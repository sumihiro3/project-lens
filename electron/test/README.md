# Stage実装統合テストガイド

Stage実装の統合テストスイートの使用方法とテスト仕様について説明します。

## 📋 概要

このテストスイートは、以下のコンポーネントの統合動作を検証します：

- **StageDataFetcher**: 3段階データ取得戦略の実装
- **IncrementalSyncManager**: 差分更新機能
- **EnhancedRateLimiter**: 動的並列数調整
- **StageErrorHandler**: エラーハンドリングとリカバリ

## 🚀 テスト実行方法

### 基本実行

```bash
# Stage統合テストを実行
npm run test:stage

# 全Electronテストを実行
npm run test:electron

# カバレッジ付きでテスト実行
npm run test:coverage

# 統合テストのみ実行
npm run test:integration
```

### 詳細レポート付き実行

```bash
# 専用スクリプトで実行（推奨）
node scripts/run-stage-tests.js
```

### ウォッチモードで開発

```bash
# テストファイルの変更を監視
npx vitest electron/test/services/backlog/stage-integration.test.ts
```

## 📊 テスト仕様

### Stage 1テスト - 高優先度データ取得

| テスト項目 | 期待値 | 実装状況 |
|------------|--------|----------|
| 実行時間 | 5秒以内 | ✅ |
| リクエスト数 | 5-10件 | ✅ |
| データ取得 | プロジェクト、ユーザー、イシュー | ✅ |
| 並列数制限 | 最大8並列 | ✅ |
| エラーハンドリング | 適切なリトライ | ✅ |

### Stage 2テスト - バックグラウンド取得

| テスト項目 | 期待値 | 実装状況 |
|------------|--------|----------|
| 実行時間 | 10秒以内 | ✅ |
| レート制限監視 | 利用率70%以上でスキップ | ✅ |
| 差分更新 | updatedSinceパラメータ使用 | ✅ |
| 並列数制限 | 最大3並列 | ✅ |

### Stage 3テスト - アイドル時履歴データ取得

| テスト項目 | 期待値 | 実装状況 |
|------------|--------|----------|
| 実行時間 | 15秒以内（スロットリング含む） | ✅ |
| システム負荷チェック | 他Stage実行中はスキップ | ✅ |
| レート制限チェック | 利用率50%以上でスキップ | ✅ |
| 並列数 | 1並列（スロットリング） | ✅ |

### パフォーマンステスト

| 項目 | 基準値 | 測定結果 |
|------|--------|----------|
| Stage 1実行時間 | < 5秒 | 自動測定 |
| Stage 2実行時間 | < 10秒 | 自動測定 |
| Stage 3実行時間 | < 15秒 | 自動測定 |
| メモリ使用量増加 | < 100MB | 自動測定 |
| 並列処理正確性 | 100% | 自動検証 |

## 🧪 テスト環境

### 必要な環境

- Node.js 18+
- TypeScript 5.7+
- Vitest 3.2+

### モック対象

- **Database**: SQLite操作のモック
- **BacklogAPI**: HTTP通信のモック
- **RequestQueue**: リクエストキューのモック
- **CacheService**: キャッシュ操作のモック

### 環境変数

```bash
NODE_ENV=test
VITEST=true
```

## 📈 カスタムマッチャー

テスト表現力向上のためのカスタムマッチャーを提供：

### StageResult用

```typescript
expect(result).toBeSuccessfulStageResult()
expect(result).toHaveAcceptablePerformance(5000)
expect(result).toHaveDataInRange(1, 50)
```

### UtilizationAnalysis用

```typescript
expect(analysis).toBeHighRiskUtilization()
expect(analysis).toExceedUtilizationThreshold(0.8)
```

### ErrorRecoveryResult用

```typescript
expect(recovery).toBeSuccessfulRecovery()
expect(recovery).toRecoverWithinTime(5000)
```

### 汎用

```typescript
expect(value).toBeOneOf(['high', 'medium', 'low'])
expect(number).toBeInRange(1, 100)
expect(metrics).toMeetPerformanceStandards({
  maxDuration: 5000,
  maxMemoryMB: 100,
  maxConcurrency: 10
})
```

## 🔧 テストケース構成

### 基本テストケース

1. **Stage実行テスト**
   - Stage 1: 高優先度データ取得
   - Stage 2: バックグラウンド取得
   - Stage 3: アイドル時履歴データ取得

2. **並列数調整テスト**
   - 動的並列数計算
   - Stage別優先度反映
   - 負荷分散機能

3. **エラーハンドリングテスト**
   - APIエラー処理
   - エラーリカバリ
   - ネットワークエラー時リトライ

4. **パフォーマンステスト**
   - 実行時間測定
   - メモリ使用量チェック
   - 並列処理正確性

### 高度なテストケース

1. **レート制限対応**
   - 制限時の並列数自動調整
   - 予測的リクエスト制御

2. **差分更新**
   - IncrementalSyncManagerの動作
   - Delta計算の正確性

3. **システム統合**
   - 複数スペース同時処理
   - クロスブラウザ互換性

## 📋 レポート形式

### テスト実行レポート

```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "testSuite": "Stage Integration Tests",
  "success": true,
  "duration": 25000,
  "environment": {
    "node": "v18.17.0",
    "platform": "darwin",
    "arch": "x64"
  }
}
```

### パフォーマンスレポート

```
=== Stage実装統合テスト パフォーマンス報告 ===
Stage 1 実行時間: 2500ms
Stage 2 実行時間: 7200ms
Stage 3 実行時間: 12800ms
メモリ使用量増加: 45MB
並列処理テスト数: 5
==============================================
```

## 🔍 トラブルシューティング

### よくある問題

1. **TypeScriptコンパイルエラー**
   ```bash
   # 型チェック実行
   npm run type-check
   ```

2. **モック設定問題**
   ```bash
   # セットアップファイル確認
   cat tests/setup.ts
   ```

3. **依存関係問題**
   ```bash
   # 依存関係再インストール
   npm ci
   ```

### デバッグモード

```bash
# デバッグ出力有効化
DEBUG=stage:* npm run test:stage

# Vitestデバッグモード
npx vitest --inspect-brk electron/test/services/backlog/stage-integration.test.ts
```

## 🎯 今後の拡張

### 予定している改善

1. **実API結合テスト**
   - Backlog Sandboxとの結合
   - エンドツーエンドテスト

2. **負荷テスト**
   - 大量データ処理
   - 長時間実行テスト

3. **視覚化レポート**
   - HTMLレポート生成
   - パフォーマンスグラフ

### 寄与方法

1. 新しいテストケースの追加
2. パフォーマンス基準の調整
3. モック機能の改善
4. ドキュメントの更新

## 📚 関連ドキュメント

- [Vitest公式ドキュメント](https://vitest.dev/)
- [Electron Testing Guide](https://www.electronjs.org/docs/latest/tutorial/testing)
- [ProjectLens アーキテクチャ](../../../docs/architecture.md)
- [Stage実装仕様](../../../docs/stage-implementation.md)