# ProjectLens

[English](README.md)

**ProjectLens**は、Backlogの課題を効率的に管理・可視化するためのデスクトップアプリケーションです。AIベースのスコアリングシステムにより、あなたにとって重要な課題を自動的に優先順位付けし、通知します。

## 主な機能

### 📊 スマートスコアリング
- AI駆動の関連度スコアリングシステム
- 優先度、期限、担当者などの要素を考慮
- 高スコア課題（80点以上）の自動通知

### 🎯 高度なフィルタリング & ソート
- ステータス、優先度、担当者、プロジェクトによるフィルタリング
- 期限（期限切れ、今日、今週、今月）でのフィルタリング
- 複数の並び替えオプション（関連度スコア、期限日、優先度、更新日）
- 重み付けされた優先度ソート（高→中→低）

### 🎨 直感的なUI
- プロジェクトごとの色分けリボン
- 相対時間表示（「たった今」「1時間前」など）
- ダークモード対応
- ワンクリックでBacklogのチケットをブラウザで開く

### 🔄 自動同期
- 5分ごとのバックグラウンド同期
- 複数プロジェクトの同時管理（最大5プロジェクト）
- ウィンドウサイズ・位置の自動復元

### 🌐 多言語対応
- 日本語・英語のインターフェース
- 言語切り替え機能

### 🏢 ワークスペース管理
- ワークスペースごとの有効・無効切り替え
- 不要な課題の一時的な非表示

### 📊 システム可観測性
- Backlog API使用状況の視覚化（プログレスバー）
- ログファイルの管理と簡単なアクセス

## 技術スタック

### フロントエンド
- **Nuxt 4** - Vue.jsフレームワーク
- **Vue 3** - リアクティブUIフレームワーク
- **Vuetify 3** - マテリアルデザインコンポーネントライブラリ
- **TypeScript** - 型安全な開発
- **vue-i18n** - 国際化対応

### バックエンド
- **Tauri 2** - デスクトップアプリケーションフレームワーク
- **Rust** - 高速で安全なバックエンド処理
- **SQLite** - ローカルデータベース
- **reqwest** - HTTP通信（Backlog API）

### プラグイン
- `tauri-plugin-sql` - データベース管理
- `tauri-plugin-notification` - システム通知
- `tauri-plugin-shell` - ブラウザ連携
- `tauri-plugin-window-state` - ウィンドウ状態の保存

## セットアップ

### 前提条件
- Node.js 18以上
- Rust 1.77.2以上
- npm または pnpm

### インストール

```bash
# 依存関係のインストール
npm install

# 開発サーバーの起動
npm run tauri:dev

# プロダクションビルド
npm run tauri:build
```

## 使い方

### 初回設定
1. アプリを起動し、設定画面（⚙️アイコン）を開く
2. Backlogのドメイン（例: `example.backlog.com`）を入力
3. APIキーを入力（Backlogの個人設定から取得）
4. 監視するプロジェクトキーを選択（最大5つ）
5. 保存して同期を実行

### 課題の閲覧
- ダッシュボードに関連度スコア順で課題が表示されます
- フィルターバーで条件を絞り込めます
- 並び替えボタンでソート順を変更できます
- チケットタイトルまたは「開く」ボタンでBacklogのチケットページを開けます

### 通知
- 新しい高優先度課題（スコア80点以上）が検出されると通知が表示されます
- 通知音も再生されます（macOS）

## プロジェクト構成

```
ProjectLens/
├── src/                      # フロントエンドソース
│   ├── components/          # Vueコンポーネント
│   ├── composables/         # Vue Composition API
│   ├── locales/            # 多言語リソース
│   ├── pages/              # ページコンポーネント
│   ├── plugins/            # Nuxtプラグイン
│   └── utils/              # ユーティリティ関数
├── src-tauri/               # バックエンドソース（Rust）
│   ├── src/
│   │   ├── backlog.rs      # Backlog APIクライアント
│   │   ├── commands.rs     # Tauriコマンド
│   │   ├── db.rs           # データベースクライアント
│   │   ├── log_commands.rs # ログ管理コマンド
│   │   ├── rate_limit.rs   # APIレートリミット管理
│   │   ├── scheduler.rs    # バックグラウンド同期
│   │   └── scoring.rs      # スコアリングロジック
│   └── Cargo.toml          # Rust依存関係
├── docs/                    # ドキュメント
│   ├── ARCHITECTURE.md     # アーキテクチャ設計
│   ├── COMPONENTS.md       # コンポーネント仕様
│   ├── COMPONENT_RULES.md  # コンポーネント規約
│   └── REQUIREMENTS.md     # 要件定義
├── README.md               # 英語README
└── README_JP.md            # このファイル
```

## ドキュメント

- [要件定義](docs/REQUIREMENTS.md) - プロジェクトの要件と機能仕様
- [アーキテクチャ](docs/ARCHITECTURE.md) - システムアーキテクチャの詳細
- [コンポーネント仕様](docs/COMPONENTS.md) - UIコンポーネントの説明
- [コンポーネント規約](docs/COMPONENT_RULES.md) - 開発規約

## ライセンス

このプロジェクトは個人利用を目的としています。

## 開発者向け情報

### デバッグ
- フロントエンド: ブラウザの開発者ツールを使用
- バックエンド: ログは`tauri-plugin-log`により出力されます

### データベース
- SQLiteデータベースは`~/Library/Application Support/com.tep-lab.project-lens/projectlens.db`に保存されます（macOS）

### ビルド
```bash
# 開発ビルド（デバッグ情報付き）
npm run tauri:dev

# リリースビルド（最適化済み）
npm run tauri:build
```
