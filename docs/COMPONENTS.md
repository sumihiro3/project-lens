# コンポーネント一覧

このドキュメントは、ProjectLensプロジェクトのすべてのコンポーネントとその役割を記録します。
新しいコンポーネントを追加した際は、このファイルを更新してください。

## ページコンポーネント

### `pages/index.vue`
- **役割**: ダッシュボードページ
- **主な機能**:
  - 課題一覧の表示
  - フィルタリング・検索
  - 並び替え
  - リフレッシュ機能
  - 最終同期時刻の表示
- **使用コンポーネント**: 
  - `FilterSummaryBar`
  - `IssueFilterPanel`
  - `IssueList`
  - `IssueCard`
- **使用Composables**:
  - `useIssues`
  - `useIssueFilters`
- **ステータス**: ✅ 実装済み

### `pages/settings.vue`
- **役割**: 設定ページ
- **主な機能**:
  - Backlog認証情報の設定（ドメイン、APIキー）
  - プロジェクト選択（最大5プロジェクト）
  - 言語設定（日本語/英語）
  - 手動同期トリガー
  - 最終同期時刻の表示
- **使用コンポーネント**: なし
- **ステータス**: ✅ 実装済み

## UIコンポーネント

### `components/FilterSummaryBar.vue`
- **役割**: フィルター概要バーと並び替えコントロール
- **Props**:
  - `filters`: フィルター状態オブジェクト
  - `filteredCount`: フィルター後の課題数
  - `totalCount`: 全課題数
- **Emits**: なし（propsを直接変更）
- **主な機能**:
  - フィルター適用状態の概要表示
  - 並び替えメニュー（関連度スコア、期限日、優先度、更新日）
  - 昇順・降順の切り替え
  - ツールチップ表示
- **ステータス**: ✅ 実装済み

### `components/IssueFilterPanel.vue`
- **役割**: フィルター・検索UI
- **Props**:
  - `modelValue`: フィルター設定
  - `availablePriorities`: 優先度リスト
  - `availableAssignees`: 担当者リスト
  - `availableProjects`: プロジェクトリスト
  - `totalCount`: 全課題数
  - `filteredCount`: フィルター後の課題数
- **Emits**:
  - `update:modelValue`: フィルター変更時
- **主な機能**:
  - 検索クエリ入力
  - ステータスフィルター（すべて、未処理、処理中）
  - 期限フィルター（期限なし、期限切れ、今日、今週、今月）
  - 優先度フィルター（複数選択）
  - 担当者フィルター（複数選択）
  - プロジェクトフィルター（複数選択）
  - スコアフィルター（スライダー）
  - フィルタークリア機能
- **ステータス**: ✅ 実装済み

### `components/IssueCard.vue`
- **役割**: 個別課題カード
- **Props**:
  - `issue`: 課題オブジェクト
- **Emits**: なし
- **主な機能**:
  - プロジェクト色リボン（左端）
  - プロジェクトキーバッジ
  - 課題キー・タイトル（クリックでブラウザで開く）
  - 関連度スコアバッジ
  - 「ブラウザで開く」ボタン
  - メタデータチップ表示:
    - 種別（バグ、タスク、要望など）
    - 優先度（色分け）
    - ステータス（色分け）
    - 担当者
    - 期限日（色分け）
    - 更新日時（相対表示）
  - 説明文（2行まで表示）
  - ホバーエフェクト
  - 動的テキスト色調整（コントラスト確保）
- **ステータス**: ✅ 実装済み

### `components/IssueList.vue`
- **役割**: 課題リスト表示
- **Props**:
  - `issues`: 課題配列
  - `loading`: ローディング状態
  - `emptyMessage`: 空状態メッセージ
- **Emits**: なし
- **主な機能**:
  - 課題カードのリスト表示
  - ローディングスピナー
  - 空状態メッセージ
- **ステータス**: ✅ 実装済み

## Composables

### `composables/useIssues.ts`
- **役割**: 課題データの取得・管理
- **Export**:
  - `issues`: 課題リスト（Ref）
  - `loading`: ローディング状態（Ref）
  - `lastSyncTime`: 最終同期時刻（Ref）
  - `loadIssues()`: 課題取得関数
- **主な機能**:
  - Tauriコマンド経由での課題取得
  - ローディング状態管理
  - 同期時刻の記録
  - イベントリスナー（refresh-issues）
- **インターフェース**:
  - `Issue`: 課題データ型定義（id, issueKey, summary, description, priority, status, issueType, assignee, dueDate, updated, relevance_score）
- **ステータス**: ✅ 実装済み

### `composables/useIssueFilters.ts`
- **役割**: フィルター・ソートロジック
- **Export**:
  - `filters`: フィルター状態（Ref）
  - `filteredIssues`: フィルター・ソート済み課題（Computed）
  - `availablePriorities`: 優先度リスト（Computed）
  - `availableAssignees`: 担当者リスト（Computed）
  - `availableProjects`: プロジェクトリスト（Computed）
- **主な機能**:
  - ステータスフィルタリング
  - 期限フィルタリング
  - スコアフィルタリング
  - 優先度フィルタリング（複数選択）
  - 担当者フィルタリング（複数選択）
  - プロジェクトフィルタリング（複数選択）
  - 検索クエリフィルタリング
  - 並び替え（関連度スコア、期限日、優先度、更新日）
  - 重み付け優先度ソート（高→中→低）
  - グローバルステート管理（画面遷移時も保持）
- **インターフェース**:
  - `FilterState`: フィルター状態型定義
- **ステータス**: ✅ 実装済み

## ユーティリティ

### `utils/issueHelpers.ts`
- **役割**: 課題関連ヘルパー関数
- **Export**:
  - `getPriorityColor(priority)`: 優先度色取得
  - `getStatusColor(status)`: ステータス色取得
  - `getDueDateColor(dueDate)`: 期限色取得
  - `formatDate(date)`: 日付フォーマット（MM/DD形式）
  - `parseDueDate(date)`: 日付パース
  - `isOverdue(date)`: 期限切れ判定
  - `isToday(date)`: 今日判定
  - `isThisWeek(date)`: 今週判定
  - `isThisMonth(date)`: 今月判定
  - `getProjectColor(issueKey)`: プロジェクトキーから一貫した色を生成
  - `extractProjectKey(issueKey)`: プロジェクトキー抽出
  - `getChipTextColor(bgColor)`: 背景色に応じた文字色を計算（コントラスト確保）
  - `formatRelativeTime(dateStr)`: 相対時間表示（「たった今」「1時間前」など）
- **ステータス**: ✅ 実装済み

## プラグイン

### `plugins/vuetify.ts`
- **役割**: Vuetifyの設定
- **主な機能**:
  - テーマ設定（ライト/ダークモード）
  - OSテーマ設定の自動検出
  - マテリアルデザインアイコンの設定
- **ステータス**: ✅ 実装済み

### `i18n.config.ts`
- **役割**: 国際化設定
- **主な機能**:
  - 日本語・英語のロケール設定
  - デフォルト言語設定
  - レガシーモード無効化
- **ステータス**: ✅ 実装済み

## 多言語リソース

### `locales/ja.json`
- **役割**: 日本語翻訳リソース
- **主なキー**:
  - `app`: アプリケーション全般
  - `issue`: 課題関連
  - `filters`: フィルター関連
  - `settings`: 設定関連
- **ステータス**: ✅ 実装済み

### `locales/en.json`
- **役割**: 英語翻訳リソース
- **主なキー**: `ja.json`と同様
- **ステータス**: ✅ 実装済み

## バックエンド（Rust）

### `src-tauri/src/backlog.rs`
- **役割**: Backlog APIクライアント
- **主な構造体**:
  - `BacklogClient`: APIクライアント
  - `Issue`: 課題データ
  - `Priority`: 優先度
  - `Status`: ステータス
  - `IssueType`: 種別
  - `User`: ユーザー
  - `Project`: プロジェクト
- **主な機能**:
  - 課題一覧取得
  - プロジェクト一覧取得
  - 現在のユーザー情報取得
- **ステータス**: ✅ 実装済み

### `src-tauri/src/commands.rs`
- **役割**: Tauriコマンド定義
- **Export**:
  - `greet`: テスト用挨拶コマンド
  - `save_settings`: 設定保存
  - `get_settings`: 設定取得
  - `fetch_issues`: 課題取得・スコアリング
  - `fetch_projects`: プロジェクト一覧取得
  - `get_issues`: 保存済み課題取得
- **ステータス**: ✅ 実装済み

### `src-tauri/src/db.rs`
- **役割**: データベースクライアント
- **主な機能**:
  - SQLiteマイグレーション
  - 設定の保存・取得
  - 課題の保存・取得
  - プロジェクト選択解除時のクリーンアップ
- **ステータス**: ✅ 実装済み

### `src-tauri/src/scheduler.rs`
- **役割**: バックグラウンドスケジューラー
- **主な機能**:
  - 5分ごとの自動同期
  - スコアリング
  - 高スコア課題の通知（80点以上）
  - フロントエンドへのイベント送信
- **ステータス**: ✅ 実装済み

### `src-tauri/src/scoring.rs`
- **役割**: スコアリングサービス
- **主な機能**:
  - 優先度スコア（高: +30、中: +15）
  - 期限スコア（期限切れ: +40、今日: +30、今週: +20、今月: +10）
  - 担当者スコア（自分: +50）
  - ステータススコア（未対応: +20、処理中: +10）
- **ステータス**: ✅ 実装済み

## 更新ガイドライン

新しいコンポーネントを追加した際は、以下の情報を記録してください：

1. コンポーネント名とパス
2. 役割・責務
3. Props/Emits（該当する場合）
4. 主な機能
5. 使用している子コンポーネント
6. 使用しているComposables
7. 実装ステータス

## 更新履歴

- 2024-11-24: 初版作成、リファクタリング計画を記録
- 2025-11-25: 全面的に更新、実装済み機能を反映
  - FilterSummaryBarコンポーネント追加
  - IssueCardの機能拡張を反映
  - 並び替え機能の追加
  - 種別表示の追加
  - 相対時間表示の追加
  - プロジェクトフィルターの追加
  - バックエンドコンポーネントの詳細を追加
