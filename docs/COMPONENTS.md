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
  - AI バナー（可用性あり・未有効・dismiss未実施のとき表示。v0.3 追加）
  - KPI カード表示(KpiCard × 3)
  - 遅延リスクセクション（AI 結果がある場合のみ表示。v0.3 追加）
  - ステータス分布・優先度分布チャート(クリックで課題一覧へ絞り込み遷移)
  - 最近更新された課題の表示
  - 課題詳細ダイアログ（DelayRiskSection からの open-detail で起動。v0.3 追加）
- **使用コンポーネント**:
  - `dashboard/KpiCard`
  - `dashboard/StatusChart`
  - `dashboard/PriorityChart`
  - `dashboard/RecentUpdates`
  - `dashboard/DelayRiskSection`（v0.3 追加）
  - `IssueDetailDialog`（v0.3 追加）
- **使用Composables**:
  - `useDashboard`（v0.3 追加。ロジック全量を分離）
- **ステータス**: ✅ 実装済み（v0.3 で DelayRiskSection・IssueDetailDialog 統合・AI バナー・useDashboard 分離を追加）

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
  - **AI 機能セクション**は `AiSettingsCard` 子コンポーネントへ分離（v0.3 レビュー後に抽出）。`error` イベントを受けてメッセージ表示する
- **使用コンポーネント**: `AiSettingsCard`
- **ステータス**: ✅ 実装済み（v0.3 で AI 機能セクションを追加・分離）

### `components/AiSettingsCard.vue`（v0.3 新設・settings.vue から分離）

- **役割**: 設定画面の AI 機能セクション（FR-V03-003 / FR-V03-004）
- **Emits**:
  - `error: [message: string]` — AI 操作失敗時に親へメッセージを通知
- **主な機能**:
  - AI 機能 ON/OFF トグル（可用性なし環境では無効化）
  - 可用性の状態表示（理由別 i18n メッセージ + チップ）
  - `appleIntelligenceDisabled` 時に Apple Intelligence 設定画面への導線ボタン（`@tauri-apps/plugin-shell` の `open` で URL スキームを開く）
  - `otherBackendAvailable` が true のとき代替バックエンド案内を表示
  - キュー処理状況（`ai.settings.queueTitle` 見出し + pending 件数・processing 件数・空状態）の表示
  - `onMounted` で `loadEnabled` / `loadAvailability` / `loadQueueStatus` を並行ロード（可用性は取得済みならスキップ）
- **使用 Composables**: `useAiSettings`（AI 設定・可用性・キュー状況管理）
- **ステータス**: ✅ 実装済み（v0.3）

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
  - `issue: Issue` — 課題オブジェクト
- **Emits**:
  - `open-detail: [issue: Issue]` — リスクバッジまたは詳細ボタンのクリックで親へ通知（v0.3 追加）
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
  - AI 要約行は `IssueAiSummaryRow` 子コンポーネントへ分離（v0.3 レビュー後に抽出）。`open-detail` をそのまま親へ中継する
  - 未生成チケットでは AI 関連要素を一切表示しない（レイアウト崩れなし）
  - 説明文（2行まで表示）
  - ホバーエフェクト
  - 動的テキスト色調整（コントラスト確保）
- **子コンポーネント**: `IssueAiSummaryRow`（AI 要約行）
- **使用ユーティリティ**: `getChipTextColor`, `formatRelativeTime`（`utils/issueHelpers`）

### `components/IssueAiSummaryRow.vue`（v0.3 新設・IssueCard から分離）

- **役割**: 課題カード内の AI 要約行（リスクバッジ・1行要約・詳細導線）
- **Props**:
  - `issue: Issue` — 課題オブジェクト
- **Emits**:
  - `open-detail: [issue: Issue]` — リスクバッジ／詳細ボタンのクリックで親へ通知
- **主な機能**:
  - `issue.ai_summary` がある場合のみ行を表示
  - リスクバッジ（`issue.ai_risk_level` がある場合のみ表示。high=赤/medium=橙/low=緑。クリックで `open-detail`）。risk_level 欠落時はバッジを出さず生キー表示を防ぐ
  - `mdi-creation` AI生成アイコン（ツールチップ付き）
  - 1行要約テキスト（truncate 表示）
  - 詳細ボタン（`mdi-chevron-right`。クリックで `open-detail`）
- **使用ユーティリティ**: `getRiskColor`, `getChipTextColor`（`utils/issueHelpers`）
- **ステータス**: ✅ 実装済み（v0.3 で AI 表示行・リスクバッジ・open-detail emit を追加）

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

### `components/dashboard/DelayRiskSection.vue`（v0.3 新設）

- **役割**: ダッシュボードの遅延リスク課題セクション（FR-V03-006）。AI 分析結果のある課題をリスク順（high→medium→low）に一覧表示し、詳細ダイアログへの起点を提供する
- **Props**:
  - `issues: Issue[]` — 全課題リスト（ai_risk_level が存在するものを自動フィルタ）
- **Emits**:
  - `open-detail: [issue: Issue]` — リスト行クリック時に詳細ダイアログ表示を親へ要求
- **主な機能**:
  - `ai_risk_level` が存在する課題のみ表示（未生成課題はセクション自体を非表示）
  - リスク順ソート（high=0, medium=1, low=2）
  - リスクバッジ（色分け）と対応提案の1行プレビュー
  - AI 生成ラベル（`mdi-creation` + `ai.settings.generated` チップ）
  - データなし時のフォールバックメッセージ
- **使用ユーティリティ**: `getRiskColor`, `getChipTextColor`（`utils/issueHelpers`）
- **ステータス**: ✅ 実装済み（v0.3）

### `components/IssueDetailDialog.vue`（v0.3 新設）

- **役割**: 課題詳細ダイアログ（FR-V03-006）。AI 1行要約・対応提案の全文・遅延日数・リスクバッジを表示し、既存のブラウザ導線を維持する
- **Props**:
  - `issue: Issue` — 表示対象の課題オブジェクト
  - `modelValue: boolean` — ダイアログ開閉状態（`v-model` パターン）
- **Emits**:
  - `update:modelValue: [boolean]` — ダイアログ開閉変更時
- **主な機能**:
  - プロジェクトキーバッジ・課題キー・タイトルのヘッダー表示
  - メタデータチップ（種別・優先度・ステータス・担当者・期限）
  - AI 分析結果セクションは `IssueAiAnalysis` 子コンポーネントへ分離（v0.3 レビュー後に抽出）
  - 「再分析」ボタン（`useAiSettings.reanalyze` でキュー投入）
  - 「ブラウザで開く」ボタン（`get_workspace_by_id` → URL 構築 → `open`）
- **子コンポーネント**: `IssueAiAnalysis`（AI 分析結果セクション）
- **使用 Composables**: `useAiSettings`
- **使用ユーティリティ**: `getPriorityColor`, `getStatusColor`, `getDueDateColor`, `formatDate`, `getProjectColor`, `extractProjectKey`, `getChipTextColor`（`utils/issueHelpers`）
- **ステータス**: ✅ 実装済み（v0.3）

### `components/IssueAiAnalysis.vue`（v0.3 新設・IssueDetailDialog から分離）

- **役割**: 課題詳細ダイアログの AI 分析結果セクション
- **Props**:
  - `issue: Issue` — 表示対象の課題オブジェクト
- **主な機能**:
  - AI 分析結果セクション（`ai_risk_level` が存在する場合のみ表示）:
    - AI 生成アイコン（`mdi-creation`）＋ `ai.settings.generated` ラベル＋生成日時
    - リスクバッジ（high=赤 / medium=橙 / low=緑。`ai.riskLevel.*` i18n キー）
    - 遅延日数（`ai.issueDetail.delayDaysValue` / `notDelayed`）
    - 1行要約（`ai.issueDetail.summary`）／対応提案（`ai.issueDetail.suggestion`）
  - AI 結果なし時のフォールバック表示（`ai.issueDetail.noResult`）
- **使用ユーティリティ**: `getRiskColor`, `getChipTextColor`（`utils/issueHelpers`。色定義は `getRiskColor` に一元化）
- **ステータス**: ✅ 実装済み（v0.3）

### `components/IssueList.vue`

- **役割**: 課題リスト表示
- **Props**:
  - `issues: Issue[]` — 課題配列
  - `loading: boolean` — ローディング状態
  - `emptyMessage?: string` — 空状態メッセージ
- **Emits**: なし
- **主な機能**:
  - 課題カードのリスト表示
  - ローディングスピナー
  - 空状態メッセージ
  - IssueCard の `open-detail` emit を受け取り `IssueDetailDialog` を開く（v0.3 追加）
- **使用コンポーネント**:
  - `IssueCard`
  - `IssueDetailDialog`（v0.3 追加）
- **ステータス**: ✅ 実装済み（v0.3 で詳細ダイアログ起動を追加）

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
  - `Issue`: 課題データ型定義（id, issueKey, summary, description, priority, status, issueType, assignee, dueDate, updated, relevance_score, workspace_id）。v0.3 で AI 結果フィールドを追加（`ai_summary?` / `ai_risk_level?`（`'high' | 'medium' | 'low'`） / `ai_suggestion?` / `ai_delay_days?` / `ai_processed_at?`。get_issues の `ai_results` LEFT JOIN から設定。未生成の課題はすべて `undefined`）
- **ステータス**: ✅ 実装済み

### `composables/useAiSettings.ts`（v0.3 新設）

- **役割**: AI 機能の有効化状態・可用性・ジョブキュー状況を管理する Composable（FR-V03-002 / FR-V03-003 / FR-V03-004）
- **Export**:
  - `aiEnabled`: AI 機能の有効化状態（Ref）
  - `availability`: 可用性情報（`AiAvailability | null`、Ref）
  - `queueStatus`: キュー状況 `[pending, processing]`（Ref）
  - `loadingAvailability`: 可用性取得中フラグ（Ref）
  - `loadingQueue`: キュー状況取得中フラグ（Ref）
  - `isAiReady`: AI 有効かつ利用可能（Computed）
  - `totalQueueCount`: pending + processing の合計（Computed）
  - `loadEnabled()`: DB から AI 有効化状態を読み込む
  - `loadAvailability()`: `get_ai_availability` コマンドで可用性を取得
  - `loadQueueStatus()`: `get_ai_queue_status` コマンドでキュー状況を取得
  - `enableAi()`: `save_ai_setting(true)` で AI 機能を有効化
  - `disableAi()`: `save_ai_setting(false)` で AI 機能を無効化
  - `reanalyze(workspaceId, issueId)`: `reanalyze_issue` コマンドで課題を再分析キューに投入
- **主な機能**:
  - グローバルステートパターン（module スコープ ref）で状態を全コンポーネント間で共有
  - AI 非対応環境では静かに失敗し既存機能を阻害しない
  - `availabilityReasonToMessageKey(reason)`: `AiAvailabilityReason` を `ai.availability.*` i18n キーへマップするヘルパー（名前付きエクスポート）
- **インターフェース**:
  - `AiAvailabilityReason`: 可用性理由の union 型（`available` / `unsupportedOs` / `appleIntelligenceDisabled` / `modelNotReady` / `deviceNotEligible` / `unavailable`）
  - `AiAvailability`: get_ai_availability の戻り値型（`available` / `reason` / `detail?` / `macosMajor?` / `otherBackendAvailable`）
  - `AiQueueStatus`: `[number, number]`（pending, processing）
- **ステータス**: ✅ 実装済み（v0.3）

### `composables/useDashboard.ts`（v0.3 新設）

- **役割**: ダッシュボードページ（`pages/index.vue`）のロジックを集約した Composable。index.vue をテンプレート専念（50-100 行目安）に保つために分離
- **Export**:
  - `issues`: 全課題リスト（Ref）
  - `baseIssues`: フィルター適用後の課題リスト（Computed）
  - `showOnlyMyIssues`: 自分の課題のみ表示フラグ（Ref）
  - `overdueCount`, `dueSoonCount`, `stagnantCount`: KPI 集計値（Computed）
  - `statusCounts`, `priorityCounts`: チャート用集計（Computed）
  - `navigateToOverdue()`, `navigateToDueSoon()`, `navigateToStagnant()`, `navigateToStatus(name)`, `navigateToPriority(name)`: KPI/チャートクリック遷移関数
  - `detailIssue`: 詳細ダイアログ表示中の課題（`Ref<Issue | null>`）
  - `detailDialogOpen`: 詳細ダイアログ開閉状態（Ref）
  - `openDetail(issue)`: 指定課題の詳細ダイアログを開く
  - `showAiBanner`: AI バナー表示条件（Computed。可用性あり & 未有効 & dismiss 未済）
  - `skipBanner()`: バナーをセッション内で非表示（`bannerDismissed` を true に）
  - `dismissBanner()`: バナーを永続的に非表示（`localStorage` に保存）
  - `handleEnableAi()`: AI を有効化してバナーを閉じる
- **主な機能**:
  - `onMounted` で `loadIssues` / `loadEnabled` / `loadAvailability` を並行実行
  - `listen('refresh-issues')` で自動更新を監視し `loadIssues` を再実行
  - AI バナーの dismiss 状態を `localStorage` の `ai_banner_dismissed` キーで永続化
- **使用 Composables**: `useIssues`, `useIssueFilters`, `useAiSettings`
- **ステータス**: ✅ 実装済み（v0.3）

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
  - `getRiskColor(riskLevel)`: AI リスクレベルから Vuetify カラー名(`color`)と 16進値(`hex`)のペアを返す（v0.3 追加）
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

### `src-tauri/src/ai/mod.rs`

- **役割**: AI推論基盤（v0.3 新設）。オンデバイスAI（FoundationModels 等）による課題分析の抽象基盤
- **主なトレイト**:
  - `LlmInference`: 推論バックエンドの抽象トレイト。`infer(&self, AiAnalysisInput) -> impl Future<Output = Result<AiAnalysisOutput>> + Send` と `name(&self) -> &str` を定義（native async-fn-in-trait。`+ Send` 制約のため `impl Future` 形式で宣言）
- **主な型**:
  - `AiAnalysisInput`: 分析入力（`issue_key` / `summary` / `description_head`（切り詰め済み） / `status` / `due_date` / `lang`）
  - `AiAnalysisOutput`: 構造化出力（`summary`（1行要約） / `risk_level`（RiskLevel） / `suggestion`（対応提案））。**遅延日数は SQL 算出のため含めない**
  - `RiskLevel`: リスクレベル enum（serde で `high` / `medium` / `low` に小文字化。`ai_results.risk_level` と一致）
  - `BackendKind`: バックエンド種別 enum（v0.3 は `FoundationModels` のみ。将来 MLX/Candle を追加）
- **主な定数**:
  - `CONTEXT_BODY_MAX_CHARS`: 課題本文の切り詰め文字数（コンテキスト上限対応の一元定義。実測後はここのみ更新）
- **主な関数**:
  - `create_backend<R: tauri::Runtime>(app: AppHandle<R>, kind: BackendKind) -> Result<impl LlmInference>`: バックエンド生成のレジストリ的入口。`FoundationModels` アームは `FoundationModelsBackend::new(app)` を返す（v0.3 でスタブから実バックエンドへ更新）。v0.4 以降のバックエンドは `BackendKind` バリアントと `match` アームの追加で導入可能。複数アームが異なる具体型を返す段階になったら enum ディスパッチへ切り替える（呼び出し側シグネチャは不変）
- **サブモジュール**: `availability`（下記）／`foundation_models`（下記）／`worker`（下記）
- **設計方針**: 構造化出力（FR-V03-005）／遅延日数は LLM 出力に含めず SQL 算出／バックエンド差し替えを `ai/` 内に閉じる／AI 非対応環境を阻害しないため生成は `Result` で失敗許容
- **ステータス**: ✅ 実装済み（v0.3 骨格。trait・入出力型・レジストリ入口。`create_backend` は `app` ハンドルを受け取り FoundationModels バックエンドを生成）

### `src-tauri/src/ai/availability.rs`

- **役割**: AI 可用性チェックと状態管理（v0.3 新設・FR-V03-002）。macOS バージョン要件と FoundationModels の availability を統合し、理由別の可用性状態をフロントへ返す
- **主な公開要素**:
  - `AiAvailabilityReason`: 理由別 enum（`Available` / `UnsupportedOS` / `AppleIntelligenceDisabled` / `ModelNotReady` / `DeviceNotEligible` / `Unavailable`。serde lowercase タグ。フロントの理由別メッセージ・Apple Intelligence 設定導線の出し分けに使用）
  - `AiAvailability`: 可用性判定結果（`available` / `reason`（AiAvailabilityReason） / `detail`（補足コード文字列。診断・ログ向け） / `macosMajor`（検出 macOS メジャー。非 macOS・取得失敗は null） / `otherBackendAvailable`（別バックエンド案内フラグ。**v0.3 では常に false**）。serde camelCase。コマンド層からそのままシリアライズして返せる）
  - `check_availability(&FoundationModelsBackend) -> AiAvailability`: 2段判定（① macOS バージョン足切り ② sidecar の `SystemLanguageModel.availability`）。**いかなる失敗でも `Err` を返さず Unavailable 系の値に落とす**（NFR-V03-002 / NFR-V03-004。AI 非対応・途中無効化でも本体機能を阻害しない）
  - `detect_macos_major_version() -> Option<u32>`: `cfg(target_os = "macos")` で `sysctl kern.osproductversion` の製品バージョン先頭整数を返す。非 macOS・取得失敗は `None`
- **主な定数**: `MIN_SUPPORTED_MACOS_MAJOR`（AI 利用可能な最小 macOS メジャー = 26）
- **設計方針**: OS バージョンで先に足切りし、満たさなければ sidecar を起動しない（無駄な起動回避）。sidecar の理由コードを `AiAvailabilityReason` へ正規化（未知コードは Unavailable に集約・前方互換）。`other_backend_available` は v0.4 の MLX 等バックエンド追加時に更新する前置き
- **テスト**: serde シリアライズ（lowercase / camelCase）・理由コードマッピング（既知/未知）・コンストラクタの 5 テスト（`#[cfg(test)]`）
- **ステータス**: ✅ 実装済み（cargo build / clippy `-D warnings` / 単体テスト 5件 通過。コマンド層への接続・起動時判定は後続項目）

### `src-tauri/src/ai/foundation_models.rs`

- **役割**: FoundationModels バックエンド（v0.3 新設）。`externalBin` 同梱の Swift sidecar を `tauri-plugin-shell` で起動し、JSON Lines over stdin/stdout で通信する `LlmInference` 実装（FR-V03-001）
- **主な公開要素**:
  - `FoundationModelsBackend`: `LlmInference` 実装。`new(app)` で生成し、推論要求を内部の管理タスクへ MPSC 送信して oneshot で応答受信。`Clone` 可（同一管理タスク・同一状態を共有）
    - `infer(&self, AiAnalysisInput) -> Result<AiAnalysisOutput>`: 課題1件の構造化分析（一時停止中は即エラー）
    - `availability(&self) -> Result<AvailabilityInfo>`: 可用性問い合わせ（FR-V03-002）
    - `state(&self) -> SidecarState`: 稼働状態取得（設定画面の動作状況表示用）
    - `resume(&self)`: 一時停止解除＋失敗カウンタリセット（手動再開）
  - `AvailabilityInfo`: 可用性情報（`available` / `reason`。reason は sidecar の理由コード文字列。フロントで理由別メッセージへマップ）
  - `SidecarState`: 稼働状態 enum（`Running` / `Suspended`。serde lowercase）
  - 定数: `SIDECAR_NAME`（externalBin ベース名 `binaries/projectlens-ai-sidecar`）/ `BACKEND_NAME`（`foundation-models`。`ai_results.model_used` に記録）/ `MAX_CONSECUTIVE_FAILURES`（一時停止閾値=3）
- **プロセス管理・自動再起動（FR-V03-001）**: 専用の管理タスクが要求を1件ずつ直列処理（同時推論1件・NFR-V03-003）。sidecar は遅延起動（アイドル時非消費）し、正常時は常駐プロセスを再利用。異常終了（`Terminated`/`Error`/タイムアウト）を検知すると次要求で再起動。連続失敗が閾値超過で `Suspended` へ遷移し以降の推論を即エラー化、`resume()` で復帰。プロセス drop 時は `CommandChild::kill` で停止
- **応答突合**: sidecar プロトコルに要求 ID が無く応答は送信順に1対1対応するため、管理タスクの直列処理で突合を担保。sidecar の `error` 応答は通信成立とみなし要求のみ失敗（再起動しない）
- **テスト容易性**: sidecar 起動・通信を `SidecarTransport` / `SidecarProcess` トレイトで抽象化。本番は `ShellSidecarTransport`、テストはモックで管理タスクのロジック（要求応答・再起動・連続失敗での一時停止・プロトコル整合）を実機なしで検証（`#[cfg(test)]` で7テスト）
- **プロトコル整合**: `src-tauri/sidecar/` の入出力契約と一致（リクエスト `availability`/`analyze`/`shutdown`、レスポンス `availability`/`result`/`error`）
- **ステータス**: ✅ 実装済み（cargo build / clippy `-D warnings` / 単体テスト 通過。`tauri.conf.json` の `bundle.externalBin` 登録・build.sh での sidecar ビルド/署名/同梱は完了。実機での `externalBin` 起動連携は検証機での要確認）

### `src-tauri/src/ai/worker.rs`

- **役割**: バックグラウンドAIワーカー（v0.3 新設・FR-V03-004 / FR-V03-005）。`job_queue` の `pending` ジョブを **同時1件** で消費し、推論結果を `ai_results` に保存する独立タスク
- **主な公開要素**:
  - `init(app: AppHandle)`: ワーカー起動（`lib.rs` の setup から DB 準備後に呼ぶ）。`create_backend` でバックエンドを生成し、生成失敗（AI 非対応環境等）ならワーカーを起動せず本体は阻害しない
  - 定数: `SETTING_AI_ENABLED`（`ai_enabled`。値 `"true"` のときのみ処理） / `JOB_TYPE_SUMMARIZE`（`summarize`） / `MAX_JOB_RETRIES`（推論リトライ上限=3）
- **処理フロー**（`run_loop` → `drain_queue` → `process_job`）: `POLL_INTERVAL_SECS`（30秒）ごとに、AI 機能 ON のときだけ `get_pending_jobs(1)` で1件取得 → `processing` へ遷移 → `get_issue_analysis_fields` で課題取得＋本文 SQL 切り詰め → `AiAnalysisInput` 整形（言語は `settings.language`、既定 ja）→ `infer_with_retry`（最大3回）→ `get_issue_delay_days` の **SQL 算出遅延日数** を付与 → `save_ai_result`（UPSERT）→ `done`。課題不在・全リトライ失敗は `failed` にしてスキップ記録（FR-V03-005）。1件以上処理したら `refresh-issues` イベントを emit
- **アイドル設計（NFR-V03-003）**: AI 機能 OFF・可用性なし・キュー空のときは推論せずアイドル。同時推論1件はバックエンド側の管理タスクで担保。`sync`・UI をブロックしない独立タスク
- **テスト**: リトライ成功（上限内）/ リトライ枯渇 / RiskLevel→保存文字列マッピング の 3 テスト（`#[cfg(test)]`、モックバックエンド）
- **ステータス**: ✅ 実装済み（cargo build / clippy `-D warnings` / 単体テスト 通過。sync 連携でのキュー投入・起動時再開トリガーは後続項目で接続）

### `src-tauri/sidecar/`（Swift sidecar: FoundationModels）

- **役割**: macOS 26 の FoundationModels で課題1件を guided generation 分析する常駐プロセス（v0.3 新設）。Tauri 本体から `externalBin` 同梱され、JSON Lines over stdin/stdout で通信する
- **主なファイル**:
  - `Package.swift`: Swift Package 定義（`.macOS("26.0")` / executableTarget `projectlens-ai-sidecar`）
  - `Sources/projectlens-ai-sidecar/main.swift`: 本体。`readLine()` ブロッキング read のメインループ（アイドル時 CPU 非消費・NFR-V03-003）
  - `README.md`: 入出力契約・ビルド要件・未解決事項の明文化
- **入出力契約**（Rust 側 `ai/mod.rs` と一致）:
  - リクエスト（1行 JSON）: `{type:"availability"}` / `{type:"analyze", issue_key, summary, description_head, status, due_date?, lang}` / `{type:"shutdown"}`（EOF でも終了）
  - レスポンス（1行 JSON）: `{type:"availability", available, reason}`（reason: `available` / `appleIntelligenceNotEnabled` / `modelNotReady` / `deviceNotEligible` / `unavailableOther`） / `{type:"result", summary, risk_level, suggestion}` / `{type:"error", message}`
- **構造化出力**: `@Generable struct AnalysisGeneration`（summary / riskLevel / suggestion）+ `@Generable enum GenerationRiskLevel`（high/medium/low）。遅延日数は SQL 算出のためスキーマに含めない
- **言語追従**: `lang`（ja/en）で instructions を切替（FR-V03-005）
- **設計上の注意**: instructions は guided generation スキーマと合算でコンテキストを消費するため簡潔に保つ（長い日本語 instructions はコンテキスト超過を誘発したため最小化）
- **ビルド統合**（v0.3）: `tauri.conf.json` の `bundle.externalBin` に `binaries/projectlens-ai-sidecar` を登録。build.sh が `tauri:build` の前に `swift build -c release` でビルドし、出力を `src-tauri/binaries/projectlens-ai-sidecar-<target-triple>`（triple は rustc ホストトリプル）として配置・codesign する。sidecar ビルド失敗時は AI 機能なしで本体ビルドを継続（フォールバック）。生成物 `src-tauri/binaries/` は gitignore 済み
- **未解決事項**: notarization は検証機（macOS 26 + Developer ID）依存のため build.sh / README.md にコマンド手順を明文化するまでを完了とする（`APPLE_SIGNING_IDENTITY` 指定で Developer ID 署名→`xcrun notarytool submit`→`stapler staple`）
- **ステータス**: ✅ 実装済み（macOS 26.3 + Xcode 26.4 + Apple Intelligence 環境で `swift build`（debug/release）成功、ja/en の構造化 JSON 出力・可用性チェック・エラーハンドリングを実機確認）。build.sh への externalBin 同梱・署名は完了（notarization は検証機依存で手順明文化のみ）

### `src-tauri/src/backlog.rs`

- **役割**: Backlog APIクライアント
- **主な構造体**:
  - `BacklogClient`: APIクライアント
  - `Issue`: 課題データ。v0.3 で AI 結果フィールドを追加（`ai_summary` / `ai_risk_level` / `ai_suggestion` / `ai_delay_days` / `ai_processed_at`。すべて `#[serde(default)]` で、`get_issues` の `ai_results` JOIN 結果から設定。raw_data に無くても欠落初期値になりフロントへそのまま渡る）
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
  - `fetch_issues`: 課題取得・スコアリング（手動sync。保存後に新規・更新チケットを差分検出して AIジョブをキュー投入。v0.3）
  - `fetch_projects`: プロジェクト一覧取得
  - `get_issues`: 保存済み課題取得（`ai_results` LEFT JOIN で AI 結果を同梱。v0.3）
  - `get_workspaces`: ワークスペース一覧取得
  - `get_workspace_by_id`: ワークスペース取得(ID指定)
  - `save_workspace`: ワークスペース保存
  - `delete_workspace`: ワークスペース削除
  - `toggle_workspace_enabled`: ワークスペース有効・無効切り替え
  - `get_ai_availability`: AI機能の可用性を取得（v0.3・FR-V03-002。一時的に FoundationModels バックエンドを生成し `check_availability` を呼ぶ。`AiAvailability` を返す。失敗時も `Unavailable` 系を返し本体非阻害）
  - `get_ai_settings`: AI機能ON/OFF設定を取得（v0.3・FR-V03-003。`settings` の `'ai_enabled'` を参照し `bool` を返す。`"true"` のみ有効）
  - `save_ai_setting(enabled)`: AI機能ON/OFF設定を保存（v0.3。`save_setting` 流用で `'ai_enabled'` に `true`/`false` を書き込む）
  - `get_ai_queue_status`: AIキューの処理状況を取得（v0.3・FR-V03-004。`(pending, processing)` の残件数・処理中件数タプルを返す）
  - `reanalyze_issue(workspace_id, issue_id)`: 課題を手動で再分析キューに投入（v0.3。`enqueue_jobs` で `summarize` ジョブを投入。pending 重複は抑止。新規投入件数を返す）
- **ステータス**: ✅ 実装済み（cargo build / clippy `-D warnings` / 単体テスト通過。v0.3 の AI コマンド5種を追加・`lib.rs` の invoke_handler に登録）

### `src-tauri/src/db.rs`

- **役割**: データベースクライアント
- **主な構造体**:
  - `WorkspaceInput`: `save_workspace()` に渡すワークスペース各カラムの値をまとめた入力構造体
  - `AiResult`: `ai_results` テーブル1行に対応するAI分析結果（要約・リスクレベル・遅延日数・対応提案など。v0.3）
  - `AiJob`: `job_queue` テーブル1行に対応するAIジョブ（v0.3）
- **主なテーブル**:
  - `settings` / `sync_state` / `workspaces` / `issues`（既存）
  - `ai_results`（v0.3 新設）: 課題単位のAI分析結果。PK は `(workspace_id, issue_id)`。`delay_days` は SQL 算出値を保存。**既存 `issues.ai_summary` カラムは ai_results 新設に伴い不使用**
  - `job_queue`（v0.3 新設）: バックグラウンドAI処理キュー（`status`: pending / processing / done / failed）
- **主な機能**:
  - SQLiteマイグレーション（IF NOT EXISTS / ALTER エラー無視のインクリメンタル方式。新テーブルも非破壊で追加）
  - 設定の保存・取得
  - 課題の保存・取得（`get_issues` は `ai_results` を `(workspace_id, issue_id)` で LEFT JOIN し、AI 結果を `Issue` の `ai_*` フィールドへ設定。AI 未生成は NULL→`None`。v0.3）
  - プロジェクト選択解除時のクリーンアップ
  - ワークスペース保存（`save_workspace(input: WorkspaceInput)`）
  - ワークスペース使用状況の保存
  - 無効ワークスペースの課題削除
  - AIジョブキュー操作（v0.3）: `enqueue_jobs`（pending重複回避） / `get_pending_jobs(limit)` / `update_job_status` / `count_pending_jobs` / `count_processing_jobs`（処理中件数。設定画面のキュー状況表示用）
  - AI結果操作（v0.3）: `save_ai_result`（issue単位UPSERT） / `get_ai_result(workspace_id, issue_id)`
  - 遅延日数のSQL算出（v0.3）: `get_issue_delay_days(workspace_id, issue_id)`（julianday ベース。期限切れ判定は LLM ではなく SQL で確実に算出）
  - AI入力用フィールド取得（v0.3）: `get_issue_analysis_fields(workspace_id, issue_id, body_max_chars)`（ワーカーが `AiAnalysisInput` を組み立てるためのフィールド取得。本文は `substr` で SQL 側切り詰め・status/description は空文字正規化）
- **ステータス**: ✅ 実装済み（v0.3 のAIテーブル・メソッドはDB基盤として実装済み。`get_issue_analysis_fields` はワーカーから、`enqueue_jobs` は sync 両経路から接続済み。`get_ai_result` など残りの呼び出し側は後続項目で接続）

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
  - AIジョブのキュー投入（v0.3 / FR-V03-004）: 自動sync の保存後に新規・更新チケットを差分検出してキュー投入。無効ワークスペースは投入対象外
- **主な関数**:
  - `enqueue_changed_issues(db, workspace_id, issues, existing_updated_map)`（`pub(crate)`）: 同期前DBスナップショットの `updated`（最終更新日時）と突き合わせ、新規（マップ未登録）・更新（`updated` 変化）分のみ `enqueue_jobs` で投入する差分検出ヘルパー。scheduler・commands(`fetch_issues`) 両経路で共通利用。投入失敗は非阻害（ログのみ）
- **ステータス**: ✅ 実装済み（v0.3 で sync→AIジョブ投入の差分検出を追加）

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
- 2026-06-12: v0.3 DB基盤(db.rs に ai_results / job_queue テーブル、AiResult / AiJob 構造体、AIジョブキュー・AI結果・遅延日数SQL算出の各メソッドを追加。issues.ai_summary は不使用方針を明記)
- 2026-06-12: v0.3 AIモジュール骨格(ai/mod.rs を新設。LlmInference trait・AiAnalysisInput / AiAnalysisOutput / RiskLevel / BackendKind 型・CONTEXT_BODY_MAX_CHARS 定数・create_backend レジストリ入口を追加。lib.rs に mod ai 宣言を追加)
- 2026-06-12: v0.3 FoundationModels バックエンド(ai/foundation_models.rs を新設。FoundationModelsBackend / AvailabilityInfo / SidecarState・SIDECAR_NAME / BACKEND_NAME / MAX_CONSECUTIVE_FAILURES 定数を追加。sidecar プロセス管理・自動再起動・連続失敗での一時停止・可用性問い合わせ・Swift sidecar プロトコル整合を実装。create_backend は app ハンドルを受け取りスタブから実バックエンド生成へ更新。Cargo.toml の tokio に sync / macros / rt feature 追加)
- 2026-06-12: v0.3 環境検出(ai/availability.rs を新設。AiAvailability / AiAvailabilityReason・MIN_SUPPORTED_MACOS_MAJOR 定数・check_availability / detect_macos_major_version を追加。macOS バージョン足切り＋sidecar の SystemLanguageModel.availability を統合し理由別 enum で返す。失敗時も Err にせず Unavailable 系へフォールバック・other_backend_available は常に false で前置き。ai/mod.rs に pub mod availability を追加)
- 2026-06-12: v0.3 バックグラウンドワーカー(ai/worker.rs を新設。init / run_loop / drain_queue / process_job / infer_with_retry と SETTING_AI_ENABLED / JOB_TYPE_SUMMARIZE / MAX_JOB_RETRIES 定数を追加。job_queue の pending を同時1件で消費し、本文 SQL 切り詰め・SQL 算出遅延日数付与で ai_results へ保存・done/failed 遷移・リトライ・refresh-issues emit を実装。AI OFF/可用性なし/キュー空でアイドル。db.rs に get_issue_analysis_fields を追加。ai/mod.rs に pub mod worker、lib.rs setup に ai::worker::init を追加)
- 2026-06-12: v0.3 sync連携(scheduler.rs に enqueue_changed_issues を追加し、自動sync の save_issues 後に新規・更新チケットを差分検出して enqueue_jobs で投入。差分は同期前DBスナップショットの updated を突き合わせ。無効ワークスペースは投入対象外。commands.rs の fetch_issues 末尾でも同関数を呼び手動sync経路でも投入。起動時pending再開と定期実行は既存の worker ポーリングループが担保するため lib.rs は変更なし。両経路に existing_updated_map スナップショット取得を追加)
- 2026-06-12: v0.3 フロント型・composable(useIssues.ts の Issue に ai_summary / ai_risk_level / ai_suggestion / ai_delay_days / ai_processed_at を追加。useAiSettings.ts を新設し AI 有効化・可用性・キュー状況管理と reanalyze を提供。locales/{ja,en}.json に ai.availability / ai.settings / ai.riskLevel キーを追加)
- 2026-06-12: v0.3 課題詳細ダイアログ(IssueDetailDialog.vue を新設。AI 要約・対応提案全文・リスクバッジ・遅延日数・再分析ボタン・ブラウザ導線を実装。ai.issueDetail / ai.riskLevel i18n キーを利用)
- 2026-06-12: v0.3 IssueCard 拡張(AI 1行要約チップ・リスクバッジ・open-detail emit を追加。ai_summary がない場合は表示しない。issueHelpers.ts に getRiskColor を追加。IssueList.vue で open-detail を受けて IssueDetailDialog を起動)
- 2026-06-12: v0.3 ダッシュボード遅延リスクセクション + AI バナー(dashboard/DelayRiskSection.vue を新設。useDashboard.ts を新設し index.vue のロジックを分離。index.vue に DelayRiskSection・IssueDetailDialog・AI バナー（FR-V03-003）を統合。locales に dashboard.delayRisk / delayRiskDescription / noDelayRisk キーを追加)
- 2026-06-12: v0.3 設定画面 AI セクション(settings.vue に AI 機能セクションを追加。トグル・可用性状態チップ・Apple Intelligence 設定導線ボタン・キュー処理状況を実装。useAiSettings を統合し onMounted で loadEnabled / loadAvailability / loadQueueStatus を並行ロード。docs/COMPONENTS.md の settings.vue エントリを更新)
- 2026-06-12: v0.3 ビルド統合(tauri.conf.json の bundle.externalBin に binaries/projectlens-ai-sidecar を登録。build.sh に tauri:build 前の swift build -c release・rustc ホストトリプル付き名でのbinaries/配置・codesign 署名ステップを追加。sidecar ビルド失敗時は AI 機能なしで本体ビルド継続のフォールバックを実装。notarization は検証機依存のため build.sh コメントに手順明文化。src-tauri/.gitignore に /binaries/ を追加。SKIP_AI_SIDECAR / TAURI_ENV_TARGET_TRIPLE / APPLE_SIGNING_IDENTITY 環境変数で制御可能)
- 2026-06-13: v0.3 レビュー指摘の修正(16件)。バグ: 可用性 reason を camelCase 化しフロントと一致(availability.rs)・起動時に processing ジョブを pending へ戻す reset_stale_jobs を追加(db.rs / lib.rs)・削除系メソッドで ai_results / job_queue の孤児を掃除(db.rs)・sysctl を spawn_blocking 化(availability.rs)。性能: fetch_issues の差分検出を軽量 get_issue_updated_map に置換(commands.rs / db.rs)・enqueue_jobs を単一の条件付き INSERT 化+job_queue インデックス2本追加(db.rs)・可用性をキャッシュし再 spawn を回避(useAiSettings.ts)。規約: AI 要約行を IssueAiSummaryRow に、AI 分析セクションを IssueAiAnalysis に、設定 AI セクションを AiSettingsCard に分離。IssueDetailDialog のリスク色を getRiskColor に統一。i18n: ai.settings.queueTitle を追加しキュー見出しを分離、未使用キー(ai.banner.skip / ai.settings.reanalyze / ai.riskLevel.label / ai.issueDetail.delayDays)を削除、IssueCard のバッジを ai_risk_level でガード)
