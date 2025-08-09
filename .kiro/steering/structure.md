# プロジェクト構造 (Project Structure)

## ルートディレクトリ構成

```
ProjectLens/
├── .claude/                    # Claude Code設定・コマンド・エージェント
│   ├── agents/                 # カスタムエージェント定義
│   └── commands/               # カスタムスラッシュコマンド
├── .kiro/                      # Kiroスペック駆動開発
│   ├── steering/               # プロジェクト全体のガイダンス
│   └── specs/                  # 機能別仕様書
├── src/                        # ソースコード
│   ├── main/                   # Electron メインプロセス
│   ├── renderer/               # Nuxt 3 アプリケーション
│   └── shared/                 # 共通ユーティリティ・型定義
├── dist/                       # ビルド生成物（Nuxt）
├── dist-electron/              # Electron ビルド生成物
├── release/                    # パッケージング出力
├── docs/                       # ドキュメント
├── package.json                # プロジェクト設定
├── tsconfig.json              # TypeScript設定
├── nuxt.config.ts             # Nuxt 3設定
├── electron-vite.config.ts    # Electron Vite設定
└── CLAUDE.md                  # Claude Code プロジェクト指示書
```

## 主要ディレクトリ詳細

### `/src/main/` - Electron メインプロセス

```
src/main/
├── index.ts                   # メインプロセスエントリーポイント
├── services/                  # バックエンドサービス
│   ├── mcp-manager.ts         # MCP接続・管理
│   ├── scoring-engine.ts      # チケット関連度スコアリング
│   ├── notification-service.ts # 通知システム
│   ├── background-worker.ts   # バックグラウンド処理
│   └── settings-manager.ts    # 設定管理
├── database/                  # データベース関連
│   ├── connection.ts          # SQLite接続設定
│   ├── migrations/            # データベースマイグレーション
│   └── models/                # Drizzle ORM スキーマ定義
├── ai/                        # AI・LLM統合
│   ├── mastra-service.ts      # Mastra AI サービス
│   ├── fallback-manager.ts    # フォールバック処理
│   └── local-processor.ts     # ローカルAI処理
└── utils/                     # ユーティリティ関数
    ├── logger.ts              # Pino ログ設定
    ├── encryption.ts          # 暗号化処理
    └── error-handler.ts       # エラーハンドリング
```

### `/src/renderer/` - Nuxt 3 アプリケーション

```
src/renderer/
├── nuxt.config.ts             # Nuxt設定（レンダラープロセス用）
├── app.vue                    # ルートコンポーネント
├── layouts/                   # レイアウト
│   ├── default.vue            # デフォルトレイアウト
│   └── minimal.vue            # ミニマルレイアウト
├── pages/                     # ページコンポーネント
│   ├── index.vue              # メインダッシュボード
│   ├── settings.vue           # 設定画面
│   ├── ticket/                # チケット関連ページ
│   │   └── [id].vue           # チケット詳細
│   └── logs.vue               # ログ表示画面
├── components/                # 再利用可能コンポーネント
│   ├── issue/                 # チケット関連コンポーネント
│   │   ├── IssueCard.vue      # チケットカード表示
│   │   ├── IssueList.vue      # チケットリスト
│   │   └── IssueDetail.vue    # チケット詳細表示
│   ├── ai/                    # AI関連コンポーネント
│   │   ├── SummaryDisplay.vue # AI要約表示
│   │   └── AdvicePanel.vue    # 対応アドバイス表示
│   ├── settings/              # 設定関連コンポーネント
│   │   ├── BacklogSettings.vue # Backlog接続設定
│   │   ├── LLMSettings.vue    # LLM設定
│   │   └── NotificationSettings.vue # 通知設定
│   └── common/                # 共通コンポーネント
│       ├── LanguageSelector.vue # 言語切り替え
│       ├── NotificationToast.vue # 通知UI
│       └── StatusIndicator.vue # ステータス表示
├── composables/               # Composition API関数
│   ├── useBacklogData.ts      # Backlogデータ操作
│   ├── useNotification.ts     # 通知機能
│   ├── useSettings.ts         # 設定管理
│   └── useAI.ts               # AI機能統合
├── stores/                    # Pinia ストア
│   ├── backlog.ts             # Backlogデータストア
│   ├── settings.ts            # 設定ストア
│   ├── notification.ts        # 通知ストア
│   └── ai.ts                  # AIサービスストア
├── locales/                   # 多言語化ファイル
│   ├── ja.json                # 日本語
│   └── en.json                # 英語
├── assets/                    # 静的アセット
│   ├── css/                   # カスタムCSS
│   └── icons/                 # アイコンファイル
└── plugins/                   # Nuxt プラグイン
    ├── vuetify.client.ts      # Vuetify設定
    ├── i18n.client.ts         # 国際化設定
    └── electron.client.ts     # Electron統合
```

### `/src/shared/` - 共通コード

```
src/shared/
├── types/                     # TypeScript型定義
│   ├── backlog.ts             # Backlog API型定義
│   ├── mcp.ts                 # MCP関連型定義
│   ├── settings.ts            # 設定型定義
│   └── ai.ts                  # AI関連型定義
├── constants/                 # 定数定義
│   ├── api.ts                 # API関連定数
│   ├── scoring.ts             # スコアリング定数
│   └── notification.ts        # 通知関連定数
└── utils/                     # 共通ユーティリティ
    ├── date.ts                # 日付操作
    ├── validation.ts          # バリデーション
    └── formatting.ts          # フォーマット処理
```

## ファイル命名規則

### Vue コンポーネント

- **PascalCase**: `IssueCard.vue`, `SettingsDialog.vue`
- **プレフィックス統一**: 機能毎のプレフィックス使用
- **明確な役割表現**: 責任範囲が分かる名前

### TypeScript ファイル

- **kebab-case**: `mcp-manager.ts`, `scoring-engine.ts`
- **機能別グループ**: サービス、ユーティリティ、型定義で分類
- **拡張子統一**: `.ts` (TypeScript), `.vue` (Vue SFC)

### ディレクトリ

- **kebab-case**: `issue-management/`, `ai-services/`
- **機能単位**: 関連する機能をまとめて配置
- **階層制限**: 深すぎるネストの回避（3層まで推奨）

## インポート構成パターン

### 絶対パス設定

```typescript
// tsconfig.json での設定
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "~/*": ["./src/*"],
      "@/*": ["./src/*"],
      "#shared/*": ["./src/shared/*"],
      "#main/*": ["./src/main/*"],
      "#renderer/*": ["./src/renderer/*"]
    }
  }
}
```

### インポート順序

1. **外部ライブラリ**: Vue, Electron, Nuxt等
2. **内部共通モジュール**: `#shared/` から
3. **同一層モジュール**: 相対パス
4. **型インポート**: `import type` で分離

```typescript
// 良い例
import { ref, computed } from 'vue'
import { useNuxtApp } from '#app'
import type { BacklogIssue } from '#shared/types/backlog'
import { useScoringEngine } from './scoring-engine'
import './component.css'
```

## コード組織パターン

### Composition API パターン

- **単一責任**: 1つのcomposableは1つの機能に特化
- **リアクティブ管理**: ref/reactive の適切な使い分け
- **型安全性**: TypeScriptの厳密な型付け

### サービスレイヤー設計

- **依存性注入**: インターフェイスベースの設計
- **エラーハンドリング**: 統一されたエラー処理
- **ログ統合**: Pinoによる構造化ログ

### ストア設計（Pinia）

- **機能単位分割**: Backlog、Settings、AIで分離
- **状態正規化**: 重複データの回避
- **アクション統合**: 非同期処理の適切な管理

## 主要アーキテクチャ原則

### 単一責任原則

- **コンポーネント**: 1つの明確な責任
- **サービス**: 特定ドメインに特化
- **ユーティリティ**: 再利用可能な純粋関数

### 依存関係の方向

- **上位レイヤー → 下位レイヤー**: UI → Service → Data
- **抽象化**: インターフェイス経由の依存
- **結合度最小化**: 疎結合設計

### 型安全性確保

- **strict モード**: TypeScript厳密設定
- **型定義ファースト**: 実装前の型定義
- **ランタイム検証**: zod等による実行時型検証

## 設定ファイル管理

### 設定ファイル場所

```
~/.config/project-lens/
├── database.sqlite3          # SQLiteデータベース
├── config.json              # アプリケーション設定
└── logs/                    # ログファイル
    ├── app.log              # アプリケーションログ
    └── error.log            # エラーログ
```

### 設定項目組織化

- **階層構造**: 機能毎の設定グループ化
- **デフォルト値**: 適切な初期値設定
- **バリデーション**: 設定値の検証
