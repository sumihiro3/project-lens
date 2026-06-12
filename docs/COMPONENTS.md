# コンポーネント一覧

> **役割**: 現状仕様(実装済みコンポーネント・モジュールの一覧)。コードベース探索の入口として使う
> **更新タイミング**: コンポーネント・モジュールの追加・変更時(実装と同じコミットで更新する)

このドキュメントは、ProjectLensプロジェクトのすべてのコンポーネントとその役割を記録します。
新しいコンポーネントを追加した際は、このファイルを更新してください。

## ページコンポーネント

### `pages/index.vue`

- **役割**: ダッシュボードページ(KPI・チャートによる全体把握)
- **主な機能**:
  - ワークスペース未設定時のウェルカム画面(設定ページへの導線)
  - KPI カード表示(KpiCard × 3)
  - ステータス分布・優先度分布チャート(クリックで課題一覧へ絞り込み遷移)
  - 最近更新された課題の表示
- **使用コンポーネント**:
  - `dashboard/KpiCard`
  - `dashboard/StatusChart`
  - `dashboard/PriorityChart`
  - `dashboard/RecentUpdates`
- **使用Composables**:
  - `useIssues`
- **ステータス**: ✅ 実装済み

### `pages/issues.vue`

- **役割**: 課題一覧ページ
- **主な機能**:
  - 課題カード一覧の表示
  - フィルタリング・検索(ダイアログ)
  - 並び替え
  - リフレッシュ機能
- **使用コンポーネント**:
  - `FilterSummaryBar`
  - `IssueFilterPanel`
  - `IssueList`
- **使用Composables**:
  - `useIssues`
  - `useIssueFilters`
- **ステータス**: ✅ 実装済み

### `pages/settings.vue`

- **役割**: 設定ページ
- **主な機能**:
  - Backlog認証情報の設定（ドメイン、APIキー）
  - プロジェクト選択（最大5プロジェクト）
  - ワークスペースの有効・無効切り替え
  - API使用状況の表示（プログレスバー）
  - ログディレクトリの確認・オープン
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
- **Emits**:
  - `open-filter-dialog`: フィルターダイアログを開く要求
  - `update:sortKey`: 並び替えキー変更時（親が `filters.sortKey` を更新）
  - `update:sortOrder`: 並び替え順変更時（親が `filters.sortOrder` を更新）
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

### `components/dashboard/KpiCard.vue`

- **役割**: ダッシュボードの KPI カード
- **Props**:
  - `title`: タイトル
  - `count`: 件数
  - `icon`: アイコン名
  - `tooltip`: ツールチップ文言
  - `color`: 色(任意)
- **Emits**: クリックイベント(課題一覧への遷移用)
- **ステータス**: ✅ 実装済み

### `components/dashboard/StatusChart.vue`

- **役割**: ステータス分布のドーナツチャート
- **Props**:
  - `statusCounts`: ステータス別件数(`Record<string, number>`)
- **Emits**:
  - `click-segment`: セグメントクリック時(ステータス名を通知)
- **ステータス**: ✅ 実装済み

### `components/dashboard/PriorityChart.vue`

- **役割**: 優先度分布のチャート
- **Props**:
  - `priorityCounts`: 優先度別件数(`Record<string, number>`)
- **Emits**:
  - `click-segment`: セグメントクリック時(優先度名を通知)
- **ステータス**: ✅ 実装済み

### `components/dashboard/RecentUpdates.vue`

- **役割**: 最近更新された課題リスト(更新日時降順で5件)
- **Props**:
  - `issues`: 課題配列
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
  - `dashboard.unknown`: 不明値の表示ラベル（"不明"）
- **ステータス**: ✅ 実装済み

### `locales/en.json`

- **役割**: 英語翻訳リソース
- **主なキー**: `ja.json`と同様（`dashboard.unknown` = "Unknown"）
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
  - `get_workspaces`: ワークスペース一覧取得
  - `get_workspace_by_id`: ワークスペース取得(ID指定)
  - `save_workspace`: ワークスペース保存
  - `delete_workspace`: ワークスペース削除
  - `toggle_workspace_enabled`: ワークスペース有効・無効切り替え
- **ステータス**: ✅ 実装済み

### `src-tauri/src/db.rs`

- **役割**: データベースクライアント
- **主な構造体**:
  - `WorkspaceInput`: `save_workspace()` に渡すワークスペース各カラムの値をまとめた入力構造体
- **主な機能**:
  - SQLiteマイグレーション
  - 設定の保存・取得
  - 課題の保存・取得
  - プロジェクト選択解除時のクリーンアップ
  - ワークスペース保存（`save_workspace(input: WorkspaceInput)`）
  - ワークスペース使用状況の保存
  - 無効ワークスペースの課題削除
- **ステータス**: ✅ 実装済み

### `src-tauri/src/log_commands.rs`

- **役割**: ログ管理コマンド
- **Export**:
  - `get_log_directory`: ログディレクトリパス取得
  - `open_log_directory`: ログディレクトリを開く
- **ステータス**: ✅ 実装済み

### `src-tauri/src/rate_limit.rs`

- **役割**: APIレートリミット管理
- **主な構造体**:
  - `RateLimitInfo`: レートリミット情報（リミット、残り、リセット時刻）
- **主な機能**:
  - レスポンスヘッダーからの情報抽出
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

## 開発ワークフロー・コマンド

### `.claude/workflows/`

Claude Code が呼び出すワークフロースクリプト群（JS）。

| ファイル               | 役割                           |
| ---------------------- | ------------------------------ |
| `implement-feature.js` | 機能実装ワークフロー           |
| `review-changes.js`    | 変更レビューワークフロー       |
| `sync-docs.js`         | ドキュメント同期ワークフロー   |
| `qa-app.js`            | QA 実行ワークフロー            |
| `release-check.js`     | リリース前チェックワークフロー |

### `.claude/commands/`

Claude Code のスラッシュコマンド定義（Markdown）。

| ファイル                 | 役割                                     |
| ------------------------ | ---------------------------------------- |
| `logical-commits.md`     | 変更を論理単位でコミット分割するコマンド |
| `refine-requirements.md` | リリース要件を対話で確定するコマンド     |

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
- 2026-06-12: 現行コードに同期(pages/issues.vue 分離、dashboard コンポーネント4種、ワークスペース管理コマンドを反映。役割ヘッダー追加)
- 2026-06-12: v0.2 対応(db.rs に WorkspaceInput 構造体追加・get_migrations 削除を反映、locales に dashboard.unknown キー追加、.claude/workflows/ と .claude/commands/ を追加)
