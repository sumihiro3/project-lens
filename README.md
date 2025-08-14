# ProjectLens

Backlogチケット管理ツール - チケットの可視化と効率的な管理を実現するデスクトップアプリケーション

## 概要

ProjectLensは、Backlogのチケット管理を強化するElectronベースのデスクトップアプリケーションです。複数プロジェクトの統合管理、高度な検索・フィルタリング、カンバンビューなどの機能により、チーム全体の生産性を向上させます。

## 主な機能

- 📊 **統合ダッシュボード** - 複数プロジェクトのチケットを一元管理
- 🔍 **高度な検索** - SQLiteによる高速検索とフィルタリング
- 📋 **カンバンビュー** - ドラッグ&ドロップでステータス変更
- 🤖 **AI支援** - LLMによるチケット要約と分析
- 📈 **分析機能** - チケットの統計情報とトレンド分析
- 🌐 **オフライン対応** - ローカルキャッシュによるオフライン閲覧
- 🎨 **カスタマイズ** - テーマとレイアウトのカスタマイズ

## 技術スタック

### フロントエンド

- **Nuxt 3** - Vue.js 3ベースのフレームワーク
- **Vuetify 3** - Material Designコンポーネント
- **TypeScript** - 型安全な開発

### バックエンド

- **Electron** - デスクトップアプリケーション
- **SQLite** - ローカルデータベース
- **Drizzle ORM** - TypeScript向けORM
- **Pino** - 高性能ログシステム

### AI連携

- **Groq API** - LLMによるチケット分析

## システム要件

- **OS**: Windows 10+, macOS 10.14+, Linux (Ubuntu 18.04+)
- **メモリ**: 4GB以上推奨
- **ディスク**: 500MB以上の空き容量

## インストール

### リリース版（推奨）

[Releases](https://github.com/sumihiro3/ProjectLens/releases)から最新版をダウンロードしてください。

- **Windows**: `ProjectLens-Setup-x.x.x.exe`
- **macOS**: `ProjectLens-x.x.x.dmg`
- **Linux**: `ProjectLens-x.x.x.AppImage`

### 開発環境のセットアップ

```bash
# リポジトリのクローン
git clone https://github.com/sumihiro3/ProjectLens.git
cd ProjectLens

# 依存関係のインストール
npm install

# 開発サーバーの起動
npm run dev

# Electronアプリの起動
npm run electron:dev
```

## 開発ガイド

### プロジェクト構成

```sh
ProjectLens/
├── electron/          # Electronメインプロセス
│   ├── main/         # メインプロセスコード
│   │   ├── database/ # データベース関連
│   │   └── utils/    # ユーティリティ
│   └── preload/      # プリロードスクリプト
├── src/              # Nuxtフロントエンド
│   ├── components/   # Vueコンポーネント
│   ├── pages/        # ページコンポーネント
│   └── stores/       # Piniaストア
├── shared/           # 共通型定義
│   └── types/       # TypeScript型定義
├── docs/            # ドキュメント
└── tests/           # テストコード
```

### 利用可能なコマンド

```bash
# 開発
npm run dev              # Nuxt開発サーバー
npm run electron:dev     # Electron開発モード
npm run electron:build   # TypeScriptコンパイル

# ビルド
npm run build           # 本番ビルド
npm run dist           # アプリケーションパッケージング

# テスト
npm test               # テスト実行
npm run test:watch     # テスト監視モード

# コード品質
npm run lint          # ESLintチェック
npm run typecheck     # TypeScript型チェック
```

## ドキュメント

### システムドキュメント

- [ログシステムガイド](docs/logging-system.md) - Pinoベースのログシステムの使い方
- [エラーハンドリングガイド](docs/error-handling.md) - 統一されたエラー処理の実装
- [パフォーマンスガイド](docs/performance-guide.md) - パフォーマンス最適化のベストプラクティス

### API連携

- Backlog API設定方法
- Groq API設定方法

## ログシステム

ProjectLensは包括的なログシステムを搭載しています：

- **構造化ログ**: JSON形式での出力
- **環境別設定**: development/production/test環境ごとの最適化
- **自動ローテーション**: ログファイルの自動管理
- **機密情報マスキング**: パスワードやトークンの自動隠蔽
- **パフォーマンス計測**: 処理時間の自動記録

詳細は[ログシステムガイド](docs/logging-system.md)を参照してください。

## エラーハンドリング

統一されたエラーハンドリング基盤により：

- **エラー分類**: 自動的なエラー種別判定
- **リトライ機能**: 復旧可能なエラーの自動リトライ
- **ユーザーフィードバック**: 分かりやすいエラーメッセージ
- **診断情報**: デバッグ用の詳細情報収集

詳細は[エラーハンドリングガイド](docs/error-handling.md)を参照してください。

## トラブルシューティング

### よくある問題

#### データベース接続エラー

- ログファイルを確認: `~/Library/Logs/project-lens/logs/app.log` (macOS)
- データベースファイルの権限を確認
- ディスク容量を確認

#### パフォーマンス問題

- [パフォーマンスガイド](docs/performance-guide.md)を参照
- ログレベルを調整（debug → info）
- キャッシュをクリア

## セキュリティ

- APIキーは暗号化して保存
- ログファイルの機密情報は自動マスキング
- ローカルデータベースへのアクセス制限

## ライセンス

[MIT License](LICENSE)

## コントリビューション

プルリクエストを歓迎します。大きな変更の場合は、まずissueを開いて変更内容を議論してください。

## サポート

- [Issues](https://github.com/sumihiro3/ProjectLens/issues) - バグ報告と機能リクエスト
- [Discussions](https://github.com/sumihiro3/ProjectLens/discussions) - 質問と議論

## 開発者

- [@sumihiro3](https://github.com/sumihiro3)

## 謝辞

このプロジェクトは以下のオープンソースプロジェクトを使用しています：

- [Electron](https://www.electronjs.org/)
- [Nuxt](https://nuxt.com/)
- [Vuetify](https://vuetifyjs.com/)
- [Pino](https://getpino.io/)
- [Drizzle ORM](https://orm.drizzle.team/)
