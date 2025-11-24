# コンポーネント一覧

このドキュメントは、ProjectLensプロジェクトのすべてのコンポーネントとその役割を記録します。
新しいコンポーネントを追加した際は、このファイルを更新してください。

## ページコンポーネント

### `pages/index.vue`
- **役割**: ダッシュボードページ
- **主な機能**:
  - 課題一覧の表示
  - フィルタリング・検索
  - リフレッシュ機能
- **使用コンポーネント**: 
  - `IssueFilterPanel` (予定)
  - `IssueList` (予定)
  - `IssueCard` (予定)
- **使用Composables**:
  - `useIssues` (予定)
  - `useIssueFilters` (予定)

### `pages/settings.vue`
- **役割**: 設定ページ
- **主な機能**:
  - Backlog認証情報の設定
  - 手動同期トリガー
- **使用コンポーネント**: なし

## UIコンポーネント

#### `components/IssueFilterPanel.vue`
- **役割**: フィルター・検索UI
- **Props**:
  - `modelValue`: フィルター設定
  - `availablePriorities`: 優先度リスト
  - `availableAssignees`: 担当者リスト
  - `totalCount`: 全課題数
  - `filteredCount`: フィルター後の課題数
- **Emits**:
  - `update:modelValue`: フィルター変更時
- **サイズ**: 約120行
- **ステータス**: ✅ 実装済み

#### `components/IssueCard.vue`
- **役割**: 個別課題カード
- **Props**:
  - `issue`: 課題オブジェクト
- **Emits**: なし
- **サイズ**: 約35行
- **ステータス**: ✅ 実装済み

#### `components/IssueList.vue`
- **役割**: 課題リスト表示
- **Props**:
  - `issues`: 課題配列
  - `loading`: ローディング状態
  - `emptyMessage`: 空状態メッセージ
- **Emits**: なし
- **サイズ**: 約30行
- **ステータス**: ✅ 実装済み

## Composables

#### `composables/useIssues.ts`
- **役割**: 課題データの取得・管理
- **Export**:
  - `issues`: 課題リスト
  - `loading`: ローディング状態
  - `loadIssues()`: 課題取得関数
- **サイズ**: 約40行
- **ステータス**: ✅ 実装済み

#### `composables/useIssueFilters.ts`
- **役割**: フィルターロジック
- **Export**:
  - `filters`: フィルター状態
  - `filteredIssues`: フィルター済み課題
  - `availablePriorities`: 優先度リスト
  - `availableAssignees`: 担当者リスト
- **サイズ**: 約140行
- **ステータス**: ✅ 実装済み

## ユーティリティ

#### `utils/issueHelpers.ts`
- **役割**: 課題関連ヘルパー関数
- **Export**:
  - `getPriorityColor(priority)`: 優先度色取得
  - `getStatusColor(status)`: ステータス色取得
  - `getDueDateColor(dueDate)`: 期限色取得
  - `formatDate(date)`: 日付フォーマット
  - `parseDueDate(date)`: 日付パース
  - `isOverdue(date)`: 期限切れ判定
  - `isToday(date)`: 今日判定
  - `isThisWeek(date)`: 今週判定
  - `isThisMonth(date)`: 今月判定
- **サイズ**: 約110行
- **ステータス**: ✅ 実装済み

## 更新ガイドライン

新しいコンポーネントを追加した際は、以下の情報を記録してください：

1. コンポーネント名とパス
2. 役割・責務
3. Props/Emits（該当する場合）
4. 使用している子コンポーネント
5. 使用しているComposables
6. おおよそのサイズ（行数）

## 更新履歴

- 2024-11-24: 初版作成、リファクタリング計画を記録
