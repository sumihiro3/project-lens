# 技術スタック (Technology Stack)

## アーキテクチャ概要

ProjectLens は Electron + Nuxt 3 + Vuetify の技術スタックを採用し、Backlog Direct APIを使用したシンプルなアーキテクチャで、効率的なタスク管理を実現するデスクトップアプリケーションです。現在は基本的なプロジェクト構造とUI基盤が構築済みで、今後SQLiteキャッシュとLLM統合機能を段階的に実装予定です。

## フロントエンド技術

### コアフレームワーク

- **Electron 33.0.0**: クロスプラットフォームデスクトップアプリケーション
- **Nuxt 3.18.1**: Vue 3ベースのフレームワーク、SSR無効設定
- **Vue 3.5.0**: Composition APIによるリアクティブUI
- **TypeScript 5.7.2**: 型安全性の確保

### UIライブラリ・テンプレート

- **Vuetify 3.9.4**: Material Designコンポーネントライブラリ
- **vite-plugin-vuetify 2.0.4**: Nuxt 3統合プラグイン
- **Pug 3.0.3**: HTMLテンプレートエンジン（Vue SFCで使用可能）
- **Sass 1.80.0**: CSSプリプロセッサー（SCSS/Sass記法対応）

### 状態管理・ユーティリティ

- **Pinia 3.0.3**: Vue 3対応の軽量状態管理
- **@pinia/nuxt 0.11.2**: Nuxt 3統合
- **@vueuse/core 13.6.0**: Vue Composition API ユーティリティ
- **@vueuse/nuxt 13.6.0**: Nuxt 3統合

## バックエンド・データ技術

### ランタイム・データベース

- **Node.js 22+**: JavaScriptランタイム
- **[予定] SQLite3 + better-sqlite3**: 高速同期SQLiteドライバー（今後実装予定）
- **[予定] Drizzle ORM**: TypeScript-firstの軽量ORM（今後実装予定）

### AI・コミュニケーション

- **[予定] @mastra/core**: AI Agentフレームワーク（今後実装予定）
- **[予定] axios**: HTTPクライアント（Backlog Direct API接続、今後実装予定）

### ユーティリティライブラリ

- **[予定] Pino**: 構造化ログライブラリ（今後実装予定）
- **[予定] node-notifier**: クロスプラットフォーム通知（今後実装予定）
- **[予定] node-cron**: バッチ処理スケジューリング（今後実装予定）

## 多言語化

### i18n技術スタック

- **@nuxtjs/i18n 10.0.4**: Nuxt 3公式国際化モジュール
- **vue-i18n 9.14.5**: Vue 3対応の国際化ライブラリ

### 対応言語

- **日本語**: プライマリ言語
- **英語**: セカンダリ言語

## 開発・ビルド環境

### ビルドツール

- **electron-vite 4.0.0**: Electron専用Viteビルドツール、高速HMR対応
- **electron-builder 25.1.8**: アプリケーションパッケージング

### 開発支援ツール

- **@nuxt/devtools**: 最新版開発ツール
- **@nuxt/eslint 1.8.0**: 統合ESLint設定
- **TypeScript**: 厳密な型チェック

## 共通開発コマンド

### 開発・ビルドコマンド

```bash
# 開発サーバー起動（Nuxt単体）
npm run dev

# Electron開発サーバー起動
npm run dev:electron

# プロダクションビルド（Nuxt）
npm run build

# Electronビルド
npm run build:electron

# プレビューモード
npm run preview

# 型チェック実行
npm run type-check

# ESLint実行
npm run lint

# ESLint自動修正
npm run lint:fix

# テスト実行
npm run test

# テスト実行（一回のみ）
npm run test:run

# カバレッジ付きテスト
npm run test:coverage
```

### プラットフォーム別ビルド

```bash
# Windows版ビルド
npm run build:win

# macOS版ビルド
npm run build:mac

# Linux版ビルド
npm run build:linux
```

## 環境変数

### 必須環境変数

- `BACKLOG_DOMAIN`: Backlogスペースドメイン
- `BACKLOG_API_KEY`: Backlog APIキー

### LLM設定

- `CLAUDE_API_KEY`: Claude APIキー（オプション）
- `OPENAI_API_KEY`: OpenAI APIキー（オプション）
- `GEMINI_API_KEY`: Gemini APIキー（オプション）

### 開発設定

- `NODE_ENV`: 環境モード (development/production)
- `LOG_LEVEL`: ログレベル (trace/debug/info/warn/error/fatal)

## ポート構成

### 開発環境

- **Nuxt 3**: `3000` (デフォルト)
- **Electron Main**: システム管理
- **Electron Renderer**: Nuxt 3プロセス統合

### プロダクション

- **パッケージ化済み**: ポート不要
- **システムトレイ**: OS統合

## アーキテクチャ決定根拠

### Direct API Only アーキテクチャ選択理由

- **シンプルさとメンテナンシビリティ**: 中間層なしの直接接続でデバッグとトラブルシューティングが簡素
- **高いパフォーマンス**: HTTP直接通信による低レイテンシと軽量化
- **依存関係削減**: 中間層の除去でバンドルサイズ削減
- **長期安定性**: 標準的なREST APIによる長期サポートと互換性

### SQLiteキャッシュベース冗長性理由

- **オフライン対応**: ネットワークエラー時のキャッシュデータでの継続動作
- **段階的デグラデーション**: エラー時の機能制限での安定動作
- **自動復旧**: 接続復帰時のデータ自動同期

### Electron + Nuxt 3選択理由

- **研究結果**: 2025年現在、electron-viteによる手動統合がもっとも安定
- **開発効率**: electron-viteの高速HMRとViteによる最適化ビルド
- **メンテナンス性**: Nuxtのモジュラーアーキテクチャと拡張性
- **安定性**: nuxt-electronの非互換性問題回避

### Vuetify選択理由

- **Material Design準拠**: 直感的で一貫性のあるUI
- **Treeshaking対応**: 使用コンポーネントのみバンドル
- **高いカスタマイズ性**: デザイントークンシステム
- **国際化対応**: 内蔵多言語化機能とVue I18n連携

### SQLite + Drizzle ORM選択理由

- **ローカルファースト**: ネットワーク依存なしの高速アクセス
- **TypeScript統合**: 完全な型安全性
- **キャッシュ戦略**: 柔軟なキャッシュ機能
- **Electron互換性**: better-sqlite3による安定動作

### Mastra選択理由

- **マルチLLM対応**: プロバイダー切り替えが容易
- **TypeScript native**: 型安全なAI統合

## セキュリティ考慮事項

### データ保護

- **APIキー暗号化**: SQLiteに暗号化保存
- **ローカルデータベース保護**: アクセス制御
- **外部通信安全性**: HTTPS通信の強制

### プライバシー

- **データ最小化**: 必要最小限の情報のみLLMに送信
- **ローカル処理優先**: 可能な限りローカル完結
- **暗号化通信**: API通信時のセキュリティ確保

## パフォーマンス目標

### 起動・応答性能

- **初回起動時間**: < 3秒 (アプリ起動から初期画面表示)
- **初期データ表示**: < 5秒 (高優先度チケット表示)
- **API応答時間 (p95)**: < 200ms (ローカルAPI呼び出し)
- **DB クエリ (p99)**: < 50ms (SQLiteクエリ実行時間)

### リソース使用量

- **メモリ使用量**: < 500MB (通常使用時のRAM消費)
- **同時スペース数**: > 10 (並列Direct API接続数)

## 外部サービス統合

### Backlog Direct API接続

```bash
# HTTPクライアントインストール
npm install axios
```

#### レート制限情報取得

```typescript
// Backlog APIレスポンスヘッダーから取得可能
const rateLimits = {
  limit: response.headers['x-ratelimit-limit'],        // 最大リクエスト数
  remaining: response.headers['x-ratelimit-remaining'], // 残りリクエスト数
  reset: response.headers['x-ratelimit-reset']         // リセット時刻
}
```

### API制限・対応

#### Direct API接続時

- **レート制限**: 150 req/分 × スペース数（ヘッダーで完全監視）
- **課題一覧制約**: 100件/リクエスト上限
- **レスポンスヘッダー**: X-RateLimit-*でリアルタイム監視
- **並列処理**: スペース毎独立取得（レート制限考慮）

#### エラー時のSQLiteキャッシュ対応

- **キャッシュデータ**: オフライン時の継続動作
- **自動復旧**: 接続復帰時のデータ同期
- **段階的デグラデーション**: エラー時の制限機能
