# ProjectLens プロジェクト構造

## ルートディレクトリ構成

```
ProjectLens/
├── .claude/              # Claude Code設定・コマンド
├── .kiro/                # Spec-Driven Development設定
├── .nuxt/                # Nuxt自動生成ファイル（無視）
├── .output/              # Nuxtビルド出力（無視）
├── docs/                 # プロジェクトドキュメント
├── electron/             # Electronアプリケーションコード
├── release/              # ビルド済みアプリケーション（無視）
├── shared/               # 共通型定義・ユーティリティ
├── src/                  # Nuxtフロントエンドコード
├── tests/                # テストコード
├── dist-electron/        # Electron TypeScriptビルド出力（無視）
├── node_modules/         # 依存関係（無視）
└── 設定ファイル群
```

## 主要ディレクトリ詳細

### `/electron/` - Electronアプリケーション

```
electron/
├── main/                 # メインプロセス
│   ├── database/        # データベース関連
│   │   ├── connection-manager.ts    # 接続管理
│   │   ├── connection.ts           # データベース接続
│   │   ├── health-checker.ts       # ヘルスチェック
│   │   ├── schema/                 # データベーススキーマ
│   │   └── utils/                  # DB関連ユーティリティ
│   ├── utils/           # メインプロセス用ユーティリティ
│   │   ├── logger.ts              # ログシステム
│   │   └── logger-example.ts      # ログ使用例
│   └── index.ts         # メインプロセスエントリーポイント
└── preload/             # プリロードスクリプト
    └── index.ts         # レンダラープロセス連携
```

### `/src/` - Nuxtフロントエンド

```
src/
├── components/          # Vueコンポーネント
│   ├── common/         # 共通コンポーネント
│   ├── layout/         # レイアウトコンポーネント
│   └── pages/          # ページ専用コンポーネント
├── pages/              # ページルーティング（Nuxt自動）
├── layouts/            # ページレイアウト
├── stores/             # Piniaストア
│   └── app.ts         # アプリケーション状態
├── plugins/            # Nuxtプラグイン
│   └── vuetify.client.ts  # Vuetify設定
├── assets/             # 静的アセット
├── public/             # 公開ディレクトリ
└── utils/              # フロントエンド用ユーティリティ
    └── performance.ts  # パフォーマンス計測
```

### `/shared/` - 共通定義

```
shared/
└── types/              # TypeScript型定義
    ├── index.ts       # 型定義のエクスポート
    ├── common.ts      # 共通型
    ├── backlog.ts     # Backlog関連型
    ├── database.ts    # データベース型
    ├── electron.ts    # Electron関連型
    ├── logging.ts     # ログ関連型
    ├── settings.ts    # 設定関連型
    └── ai.ts          # AI機能関連型
```

### `/tests/` - テストコード

```
tests/
├── unit/               # ユニットテスト
│   ├── basic.test.ts  # 基本機能テスト
│   └── electron.test.ts  # Electronテスト
├── electron/           # Electron専用テスト
│   └── utils/         # Electronユーティリティテスト
└── setup.ts           # テスト環境設定
```

### `/docs/` - ドキュメント

```
docs/
├── logging-system.md     # ログシステムガイド
├── error-handling.md     # エラーハンドリングガイド
├── performance-guide.md  # パフォーマンスガイド
├── memo.md              # 開発メモ
└── code-reviews/        # コードレビュー記録
```

### `/.claude/` - Claude Code設定

```
.claude/
├── agents/             # カスタムエージェント
├── commands/           # カスタムコマンド
└── settings.local.json # ローカル設定
```

### `/.kiro/` - Spec-Driven Development

```
.kiro/
├── steering/           # プロジェクトステアリング
│   ├── product.md     # プロダクト概要
│   ├── tech.md        # 技術スタック
│   └── structure.md   # プロジェクト構造
└── specs/             # 機能仕様書（今後追加）
```

## コード組織パターン

### 型定義パターン

```typescript
// shared/types/feature.ts
export interface FeatureConfig {
  // 設定型定義
}

export type FeatureStatus = 'pending' | 'active' | 'completed'

// 使用側での導入
import type { FeatureConfig, FeatureStatus } from '~/shared/types/feature'
```

### Electronメインプロセス

```typescript
// electron/main/modules/feature.ts
import { logger } from '../utils/logger'
import type { FeatureConfig } from '../../shared/types/feature'

export class FeatureManager {
  constructor(private config: FeatureConfig) {}
  
  async initialize(): Promise<void> {
    logger.info('Feature initializing')
    // 実装
  }
}
```

### Nuxtコンポーネント

```typescript
// src/components/Feature/FeatureCard.vue
<script setup lang="ts">
import type { FeatureConfig } from '~/shared/types/feature'

interface Props {
  config: FeatureConfig
}

const props = defineProps<Props>()
</script>

<template>
  <v-card>
    <!-- コンポーネント実装 -->
  </v-card>
</template>
```

### Piniaストア

```typescript
// src/stores/feature.ts
import type { FeatureConfig, FeatureStatus } from '~/shared/types/feature'

export const useFeatureStore = defineStore('feature', () => {
  const status = ref<FeatureStatus>('pending')
  const config = ref<FeatureConfig | null>(null)
  
  const initialize = async () => {
    // ストアロジック
  }
  
  return {
    status: readonly(status),
    config: readonly(config),
    initialize
  }
})
```

## ファイル命名規則

### TypeScript/JavaScript
- **PascalCase**: クラス、インターフェース、型エイリアス
- **camelCase**: 変数、関数、メソッド
- **kebab-case**: ファイル名、ディレクトリ名

### Vue コンポーネント
- **PascalCase**: コンポーネントファイル名（`FeatureCard.vue`）
- **kebab-case**: テンプレート内でのコンポーネント使用

### データベース関連
- **snake_case**: テーブル名、カラム名
- **camelCase**: TypeScript内でのプロパティ名

### 設定・ドキュメント
- **kebab-case**: 設定ファイル（`nuxt.config.ts`）
- **lowercase + hyphen**: ドキュメント（`logging-system.md`）

## インポート組織規則

### インポート順序
```typescript
// 1. Node.js組み込みモジュール
import path from 'path'
import fs from 'fs'

// 2. 外部ライブラリ
import { app, BrowserWindow } from 'electron'
import pino from 'pino'

// 3. 内部モジュール（絶対パス）
import { logger } from '~/electron/main/utils/logger'
import type { Config } from '~/shared/types/common'

// 4. 相対パス（同階層・下位階層）
import { DatabaseManager } from './database/connection-manager'
import { validateConfig } from '../utils/validator'
```

### パスエイリアス設定
```typescript
// tsconfig.json
{
  "paths": {
    "~/*": ["./src/*"],           // Nuxtソース
    "@/*": ["./src/*"],           // 同上（代替）
    "~~/*": ["./*"],              // プロジェクトルート
    "@@/*": ["./*"]               // 同上（代替）
  }
}
```

## アーキテクチャ設計原則

### 関心の分離
- **Presentation**: Vue/Nuxtコンポーネント（UIロジック）
- **Business**: Piniaストア（ビジネスロジック）
- **Data**: Electronメインプロセス（データアクセス）

### 依存関係の方向
```
src/ (Presentation)
  ↓
shared/ (Common Types)
  ↑
electron/ (Data & Platform)
```

### モジュール設計
- **高凝集**: 関連する機能を同一モジュールに集約
- **疎結合**: モジュール間の依存を最小限に抑制
- **単一責任**: 各モジュールは一つの責任のみを持つ

### エラーハンドリング
- **境界での処理**: レイヤー境界でエラーをキャッチ
- **適切なレベル**: ユーザーレベルとシステムレベルの区別
- **ログとの連携**: エラー発生時の自動ログ出力

### パフォーマンス考慮
- **レイジーローディング**: 必要時にのみモジュール読み込み
- **メモリ効率**: 不要なオブジェクト参照の削除
- **非同期処理**: UIブロッキングの回避

### テスタビリティ
- **依存性注入**: モック化可能な構造
- **純粋関数**: 副作用のない関数の推奨
- **単体テスト**: 各モジュールの独立テスト可能性