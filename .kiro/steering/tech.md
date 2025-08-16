# ProjectLens 技術スタック

## アーキテクチャ概要

ProjectLensは、モダンなElectronアーキテクチャを採用したハイブリッドデスクトップアプリケーションです。フロントエンドにNuxt 3、バックエンドにElectronメインプロセス、データ永続化にSQLiteを使用した三層構造を持ちます。

```
┌─────────────────────────────────────┐
│           Electron Shell            │
├─────────────────────────────────────┤
│  Renderer Process    │ Main Process │
│  (Nuxt 3 + Vue 3)   │ (Node.js)    │
├─────────────────────────────────────┤
│            SQLite Database          │
└─────────────────────────────────────┘
```

## フロントエンド技術

### コアフレームワーク

- **Nuxt 3 (v3.18.1+)** - Vue.js 3ベースのフルスタックフレームワーク
  - サーバーサイドレンダリング（SSR）対応
  - 自動ルーティングと型安全性
  - 最適化されたバンドリング
- **Vue 3 (v3.5.0+)** - Composition API中心のリアクティブフレームワーク
- **TypeScript (v5.7.2+)** - 型安全な開発環境

### UIフレームワーク・ライブラリ

- **Vuetify 3 (v3.9.4+)** - Material Design 3準拠のコンポーネントライブラリ
- **@mdi/font** - Material Design Icons
- **Sass (v1.80.0+)** - CSSプリプロセッサ
- **Pug (v3.0.3+)** - HTMLテンプレートエンジン（オプション）

### 状態管理・ユーティリティ

- **Pinia (v3.0.3+)** - Vue 3公式状態管理ライブラリ
- **@vueuse/core (v13.6.0+)** - Vue Composition ユーティリティ集
- **@nuxtjs/i18n (v10.0.4+)** - 国際化対応

## バックエンド技術

### Electronアーキテクチャ

- **Electron (v33.0.0)** - デスクトップアプリケーションフレームワーク
- **@electron-toolkit/preload** - プリロードスクリプト用ユーティリティ
- **@electron-toolkit/utils** - Electron開発用ユーティリティ

### データベース・ORM

- **Better SQLite3 (v12.2.0+)** - 高性能同期SQLiteドライバー
- **Drizzle ORM (v0.44.4+)** - TypeScript-first ORM
- **Drizzle Kit (v0.31.4+)** - マイグレーションとスキーマ管理

### ログシステム

- **Pino (v8.21.0+)** - 高性能構造化ログライブラリ
- **Pino Pretty (v10.3.1+)** - 開発用ログフォーマッター

### API連携・サービス層

- **Backlog API Client** - 段階的データ取得とレート制限管理
- **Enhanced Rate Limiter** - API呼び出し最適化とエラーハンドリング
- **Cache Manager** - 効率的なローカルキャッシュ管理
- **Incremental Sync Manager** - 差分データ同期システム

## 開発環境

### 必須ツール

- **Node.js 18.0.0+** - JavaScript実行環境
- **npm 9.0.0+** - パッケージマネージャー
- **Git** - バージョン管理

### エディター・IDE

- **Visual Studio Code** - 推奨エディター
  - TypeScript拡張
  - Vue Language Features (Volar)
  - ESLint拡張
  - Prettier拡張

### ビルドツール・開発支援

- **Electron Builder (v25.1.8+)** - アプリケーションパッケージング
- **Electron Vite (v4.0.0+)** - 開発用ビルドツール
- **Vite** - 高速ビルドツール（Nuxt 3内包）
- **Concurrently (v9.2.0+)** - 複数プロセス並列実行

## 品質保証・テスト

### コード品質

- **ESLint** - JavaScriptリンター
  - @nuxt/eslint設定
  - TypeScript対応
  - Prettier統合
- **Prettier (v3.6.2+)** - コードフォーマッター

### テストフレームワーク

- **Vitest (v3.2.0+)** - 高速テストランナー
- **@vue/test-utils (v2.4.6+)** - Vueコンポーネントテスト
- **Happy DOM (v16.3.0+)** - 軽量DOMエミュレーション
- **Playwright Core (v1.49.0+)** - E2Eテスト対応

## 開発コマンド

### 基本コマンド

```bash
npm run dev                  # Nuxt開発サーバー起動 (http://localhost:3000)
npm run dev:electron         # Electron開発モード起動
npm run dev:fast            # 高速Electron開発モード
npm run dev:watch           # ファイル監視付きElectron開発
```

### ビルド・パッケージング

```bash
npm run build               # 本番ビルド
npm run build:electron      # Electronビルド
npm run compile:electron    # Electronコードコンパイル
npm run dist               # アプリケーションパッケージング
npm run build:all          # 全プラットフォームビルド
```

### テスト・品質チェック

```bash
npm test                   # テスト実行
npm run test:run          # テスト単発実行
npm run test:coverage      # カバレッジ付きテスト
npm run test:integration   # 統合テスト実行
npm run test:stage        # Stage統合テスト
npm run test:electron     # Electronテスト
npm run lint              # ESLintチェック
npm run type-check        # TypeScript型チェック
```

### パフォーマンス監視

```bash
npm run perf:monitor       # パフォーマンス監視
npm run perf:startup       # 起動時間測定
npm run perf:memory        # メモリ使用量測定
npm run perf:bundle        # バンドルサイズ分析
```

## 環境変数

### 開発環境

- `NODE_ENV` - 実行環境 (`development`, `production`, `test`)
- `NUXT_HOST` - 開発サーバーホスト (デフォルト: `localhost`)
- `NUXT_PORT` - 開発サーバーポート (デフォルト: `3000`)

### AI機能

- `GROQ_API_KEY` - Groq API認証キー
- `GROQ_MODEL` - 使用するLLMモデル (デフォルト: `mixtral-8x7b-32768`)

### Backlog API連携

- `BACKLOG_API_KEY` - Backlog API認証キー
- `BACKLOG_SPACE_URL` - BacklogスペースのベースURL
- `BACKLOG_RATE_LIMIT` - APIレート制限設定 (リクエスト/分)

### データベース

- `DATABASE_PATH` - SQLiteデータベースファイルパス
- `DATABASE_TIMEOUT` - データベースタイムアウト (ms)

### ログシステム

- `LOG_LEVEL` - ログレベル (`debug`, `info`, `warn`, `error`)
- `LOG_DIR` - ログファイル出力ディレクトリ

## ポート設定

### 開発環境

- **3000** - Nuxt開発サーバー
- **24678** - Vite HMR WebSocket
- **9229** - Node.js デバッガー

### プロダクション

- すべてのサービスはElectron内部で動作し、外部ポートは使用しません

## 依存関係管理

### パッケージマネージャー戦略

- `npm` を標準パッケージマネージャーとして使用
- `package-lock.json` をバージョン管理に含める
- 定期的な脆弱性監査（`npm audit`）を実施

### 更新戦略

- **メジャーバージョン**: 慎重な評価後に更新
- **マイナーバージョン**: 月次で更新検討
- **パッチバージョン**: セキュリティ修正は即座に適用

## パフォーマンス考慮事項

### 起動最適化

- Electronプリロードによる高速初期化
- 必要最小限のモジュールロード
- レイジーローディングの活用

### メモリ効率

- SQLiteメモリマップド・ファイル
- Vueコンポーネントの適切な破棄
- 大容量データの仮想化

### バンドルサイズ

- Tree-shakingによる未使用コード除去
- 動的インポートによるコード分割
- Electron Builder最適化設定
