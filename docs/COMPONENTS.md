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
  - `IssueSimilarDialog`（v0.4 追加。ページに1回だけマウントし類似検索ダイアログを提供）
- **使用Composables**:
  - `useDashboard`（v0.3 追加。ロジック全量を分離）
- **ステータス**: ✅ 実装済み（v0.4 で IssueSimilarDialog をマウント。v0.3 で DelayRiskSection・IssueDetailDialog 統合・AI バナー・useDashboard 分離を追加）

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
  - `IssueSimilarDialog`（v0.4 追加。ページに1回だけマウントし類似検索ダイアログを提供）
- **使用Composables**:
  - `useIssues`
  - `useIssueFilters`
- **ステータス**: ✅ 実装済み（v0.4 で IssueSimilarDialog をマウント）

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

### `pages/reports.vue`（v0.4.5 新設・FR-V045-001）

- **役割**: レポート/サマリーページ（プロジェクト横断サマリ + 週次/月次アクティビティ）。ロジックは `useReports` へ委譲し、ページはワークスペース選択とセクション配置のみを担う
- **主な機能**:
  - 有効ワークスペースの選択（`get_workspaces` で `enabled` のみ抽出。複数あるときだけセレクタ表示、単一なら自動選択）。ドメインのサブドメイン部分を表示ラベルにする
  - 有効ワークスペースなしは `v-alert` でガイド表示（`reports.noWorkspace`）
  - 横断サマリセクションと週次/月次セクションを配置
  - 種別切替（週次⇔月次）に追従して `weekly` / `monthly` の state バンドルを切り替え（`periodState` computed）
  - 横断テーブルのプロジェクト行クリックで `useIssueFilters` の `filters.selectedProjects` をセットして `/issues` へ絞り込み遷移（dashboard と同方式の global state 連携）
  - ワークスペース選択変更を `watch` してレポートを再ロード
- **使用コンポーネント**: `reports/CrossSummarySection`, `reports/WeeklyMonthlySection`
- **使用 Composables**: `useReports`（状態・degrade・コマンド呼び出し全量）、`useIssueFilters` / `useIssues`（課題一覧への絞り込み導線用）
- **ステータス**: ✅ 実装済み（v0.4.5）

### `components/reports/CrossSummarySection.vue`（v0.4.5 新設・FR-V045-002）

- **役割**: 複数プロジェクト横断サマリのプレゼンテーション専用セクション。プロジェクト別統計テーブル（SQL 集計）と AI narrative（注目点・見出し）を表示し、再生成導線を提供する
- **Props**:
  - `stats: CrossSummaryStat[]` — プロジェクト別横断統計（未生成時は空配列）
  - `headline: string | null` — AI 生成の1行見出し
  - `narrative: string | null` — AI 生成の narrative テキスト
  - `generatedAt: string | null` — 最終生成日時（ISO8601）
  - `loading: boolean` — 初期ロード中フラグ
  - `regenerating: boolean` — 再生成中フラグ（ボタンスピナー用）
  - `degradedReason: ReportDegradedReason | null` — narrative 非表示の degrade 理由
- **Emits**:
  - `regenerate: []` — 再生成ボタン押下（親が `generate_reports` を呼ぶ）
  - `select-project: [projectKey: string]` — プロジェクト行クリック（課題一覧の絞り込み導線）
- **主な機能**:
  - 統計テーブル（未完了・期限超過・停滞・自分担当・リスク分布(高/中/低)）。期限超過 > 0 は強調表示。行クリックで `select-project`。統計は SQL 集計のため degrade 対象外で常に表示
  - 統計なし（未生成）は `reports.noStats` の `v-alert`
  - 「再生成」ボタン（`mdi-refresh` + 生成中スピナー + 前回生成時刻表示）
  - AI narrative セクション（`mdi-creation` + `ai.settings.generated` 生成ラベル + `ai-text-box` スタイルを IssueSimilarResults から踏襲）
  - narrative なしは degrade 理由を `v-alert` で提示（`aiUnavailable`=warning / その他=info。NFR-V045-003）
- **使用ユーティリティ**: `getProjectColor`, `formatDate`（`utils/issueHelpers`）
- **ステータス**: ✅ 実装済み（v0.4.5）

### `components/reports/WeeklyMonthlySection.vue`（v0.4.5 新設・FR-V045-003）

- **役割**: 週次/月次アクティビティレポートのプレゼンテーション専用セクション。種別切替・期間セレクタ・統計テーブル（SQL 集計）・AI narrative（期間ハイライト）を表示し、再生成導線を提供する
- **Props**:
  - `reportType: PeriodReportType` — 現在の種別（`weekly` / `monthly`）
  - `selectedPeriod: string | null` — 選択中の期間キー
  - `periods: string[]` — 保存済み期間キー一覧（生成日時降順）
  - `stats: PeriodActivityStat[]` — 選択期間のプロジェクト別統計
  - `narrative: string | null` — 選択期間の AI narrative
  - `generatedAt: string | null` — 選択期間の生成日時（ISO8601）
  - `loading: boolean` — ロード中フラグ（期間切替含む）
  - `regenerating: boolean` — 再生成中フラグ（ボタンスピナー用）
  - `degradedReason: ReportDegradedReason | null` — narrative 非表示の degrade 理由
- **Emits**:
  - `update:reportType: [reportType: PeriodReportType]` — 種別切替（`v-model:report-type` パターン）
  - `select-period: [reportType, periodKey]` — 期間セレクタの選択変更
  - `regenerate: [reportType]` — 再生成ボタン押下
- **主な機能**:
  - 種別切替トグル（週次/月次。`v-btn-toggle` mandatory）と期間セレクタ（期間履歴がある場合のみ）
  - 統計テーブル（新規・更新・完了）。完了 > 0 は強調表示。統計は degrade 対象外で常に表示
  - 「再生成」ボタン（`mdi-refresh` + スピナー + 前回生成時刻表示）。生成は現在の種別の期間キーで行われる
  - AI narrative セクション（CrossSummarySection と同方式の生成ラベル + `ai-text-box`）
  - narrative なしは degrade 理由を `v-alert` で提示（NFR-V045-003）
- **使用ユーティリティ**: `getProjectColor`, `formatDate`（`utils/issueHelpers`）
- **ステータス**: ✅ 実装済み（v0.4.5）

### `components/reports/ReportNarrative.vue`（v0.4.5 新設・FR-V045-002/003）

- **役割**: レポートの AI narrative ブロック（生成ラベル + 見出し + 本文 + degrade）を表示するプレゼンテーション専用コンポーネント。`CrossSummarySection` と `WeeklyMonthlySection` で共用する
- **Props**:
  - `title: string` — 生成ラベルに続けて表示するセクション見出し（例: 「注目点」「期間ハイライト」）
  - `headline?: string | null` — AI 生成の1行見出し（横断サマリのみ。無ければ null）
  - `narrative: string | null` — AI 生成 narrative 本文（未生成・degrade 時は null）
  - `degradedReason: ReportDegradedReason | null` — narrative 非表示時の degrade 理由（正常時は null）
- **主な機能**:
  - `mdi-creation` + `reports.aiGeneratedLabel` + `title` による生成ラベル表示
  - `headline` があれば見出し1行を表示（横断サマリのみ利用）
  - `narrative` がある場合は `ai-text-box` スタイルで本文表示
  - `narrative` が null かつ `degradedReason` がある場合は degrade 理由を `v-alert` で提示（`aiUnavailable`=warning / その他=info。NFR-V045-003）
  - 左ボーダースタイルで AI セクションを視覚的に区別
- **ステータス**: ✅ 実装済み（v0.4.5）

### `components/AiSettingsCard.vue`（v0.3 新設・settings.vue から分離）

- **役割**: 設定画面の AI 機能セクション（FR-V03-003 / FR-V03-004 / FR-V04-003）
- **Emits**:
  - `error: [message: string]` — AI 操作失敗時に親へメッセージを通知
- **主な機能**:
  - AI 機能 ON/OFF トグル（可用性なし環境では無効化）
  - 可用性の状態表示（理由別 i18n メッセージ + チップ）
  - `appleIntelligenceDisabled` 時に Apple Intelligence 設定画面への導線ボタン（`@tauri-apps/plugin-shell` の `open` で URL スキームを開く）
  - `otherBackendAvailable` が true のとき代替バックエンド案内を表示
  - キュー処理状況（`ai.settings.queueTitle` 見出し + pending 件数・processing 件数・空状態）の表示
  - **コーパス設定セクション**（v0.4 追加）:
    - 過去完了課題の取り込み期間スライダー（1〜24ヶ月、既定 6。`corpus_months` キーで `save_settings`/`get_settings` に保存・取得）
    - コーパス取り込み件数表示（全ワークスペース合算）
    - 埋め込み構築進捗表示（構築済み / 対象件数 + プログレスバー）
    - 期間変更後は次回 sync でコーパス再取り込みが走る旨をヒント表示
  - `onMounted` で `loadEnabled` / `loadAvailability` / `loadQueueStatus` / `loadCorpusMonths` / `loadCorpusCount` / `loadEmbeddingStatus` を並行ロード（可用性は取得済みならスキップ）
- **使用 Composables**: `useAiSettings`（AI 設定・可用性・キュー状況・コーパス設定管理）
- **ステータス**: ✅ 実装済み（v0.4 でコーパス設定セクションを追加）

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
  - 「類似を探す」ボタン（`mdi-magnify-scan`。`@click.stop` で `useSimilarSearch().openSimilar(issue)` を呼び類似ダイアログを開く。v0.4 追加）
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
- **使用 Composables**: `useSimilarSearch`（v0.4 追加。「類似を探す」ボタン用）
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
  - 「背景・経緯を要約」ボタン（`mdi-text-box-search`。`useReports().generateBackgroundSummary(workspace_id, id, locale)` を呼ぶ。結果は本文の折りたたみセクションに `mdi-creation`+生成ラベルつきで表示。生成中はスピナー、空文字（コメントなし・degrade）時は「コメントなし（要約対象なし）」を表示。2回目以降は Rust 側の `source_hash`+`lang` キャッシュで即返し。状態は `useReports` の per-issue 背景要約 state（`backgroundSummary`/`backgroundSummaryLoading`/`backgroundSummaryLoaded`）を共用し、ダイアログを開くたびに `resetBackgroundSummary` でクリアして取り違えを防ぐ。v0.4.5・FR-V045-004 追加）
  - 「類似を探す」ボタン（`mdi-magnify-scan`。詳細ダイアログを閉じてから `useSimilarSearch().openSimilar(issue)` を呼び、ダイアログが重ならないようにする。v0.4 追加）
  - 「ブラウザで開く」ボタン（`get_workspace_by_id` → URL 構築 → `open`）
- **子コンポーネント**: `IssueAiAnalysis`（AI 分析結果セクション）
- **使用 Composables**: `useAiSettings`, `useSimilarSearch`, `useReports`（背景要約の生成・state 共有）
- **使用ユーティリティ**: `getPriorityColor`, `getStatusColor`, `getDueDateColor`, `formatDate`, `getProjectColor`, `extractProjectKey`, `getChipTextColor`（`utils/issueHelpers`）
- **ステータス**: ✅ 実装済み（v0.3。v0.4.5 で背景・経緯の要約導線を追加）

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

### `components/IssueBackgroundSummary.vue`（v0.4.5 新設・FR-V045-004）

- **役割**: 課題詳細ダイアログ内の背景・経緯の要約セクション（表示専用）。生成トリガー（ボタン）は親の `IssueDetailDialog` に置き、本コンポーネントは `useReports` のグローバルステートを受けて表示に専念する
- **Props**:
  - `open: boolean` — ダイアログ開閉状態。開いたら前の課題の要約をクリアして取り違えを防ぐ
- **主な機能**:
  - `open` の watch でダイアログを開くたびに `resetBackgroundSummary()` を呼び、per-issue 背景要約 state を初期化（課題取り違え防止）
  - `show` computed（`backgroundSummaryLoading || backgroundSummaryLoaded`）が true のときだけテンプレートを表示（一度も生成を実行していない段階では非表示）
  - 生成中: `v-progress-circular` スピナー + `ai.issueDetail.backgroundSummarizing` ラベル
  - 要約あり: `ai-text-box` スタイルで要約テキストを表示（`mdi-creation` + `ai.issueDetail.backgroundSummaryTitle` 生成ラベル付き）
  - コメントなし（空文字 + Loaded=true）: `mdi-comment-off-outline` + `ai.issueDetail.backgroundNoComments`
- **使用 Composables**: `useReports`（`backgroundSummary` / `backgroundSummaryLoading` / `backgroundSummaryLoaded` / `resetBackgroundSummary`）
- **ステータス**: ✅ 実装済み（v0.4.5）

### `components/IssueSimilarResults.vue`（v0.4 新設・FR-V04-005）

- **役割**: 類似検索結果パネル。横断類似上位 N 件の一覧と FoundationModels 解決策要約を表示するプレゼンテーション専用コンポーネント（状態は持たず props 受け取り）。`v-dialog` でラップして利用する（`IssueSimilarDialog` が担当）
- **Props**:
  - `queryIssue: Issue | null` — 検索の起点課題（見出し表示用）
  - `results: SimilarIssue[]` — 類似検索結果（類似度降順）
  - `loading: boolean` — 検索実行中フラグ
  - `summary: string | null` — 解決策要約テキスト
  - `summaryLoading: boolean` — 要約生成中フラグ
  - `degradedReason: SimilarDegradedReason | null` — degrade 理由（`similar.degraded.*` i18n で文言化）
- **Emits**:
  - `close: []` — パネルを閉じる
  - `open-in-browser: [item: SimilarIssue]` — 候補課題をブラウザで開く
- **主な機能**:
  - 類似上位 N 件の一覧（プロジェクトキーチップ・課題キー・サマリ・ステータス・担当者・類似度チップ・完了バッジ）。各行クリックで `open-in-browser`
  - 完了（コーパス専用 `isCorpusOnly`）課題に「完了」バッジ（`mdi-check-circle-outline`）
  - FoundationModels 解決策要約セクション（`mdi-creation` + `ai.settings.generated` 生成ラベル + `ai-text-box` スタイルを IssueAiAnalysis から踏襲。出力は UI 言語）
  - degrade 理由の提示（埋め込み未構築＝「構築待ち」/ AI 非対応 / 検索失敗）。NFR-V04-005
  - 検索中・要約中スピナー、結果なし・要約なしのフォールバック
- **使用ユーティリティ**: `getProjectColor`, `getStatusColor`, `getChipTextColor`（`utils/issueHelpers`）
- **ステータス**: ✅ 実装済み（v0.4）

### `components/IssueSimilarDialog.vue`（v0.4 新設・FR-V04-005）

- **役割**: 類似検索ダイアログのラッパー。`useSimilarSearch` のグローバルステートを参照し `IssueSimilarResults` を `v-dialog` でラップする。ページレベル（`index.vue` / `issues.vue`）に1回だけマウントする
- **Props**: なし
- **Emits**: なし
- **主な機能**:
  - `useSimilarSearch` の `dialogOpen` / `queryIssue` / `results` / `loading` / `summary` / `summaryLoading` / `degradedReason` を `IssueSimilarResults` へ束ねて渡す
  - `IssueSimilarResults` の `close` / `open-in-browser` を `useSimilarSearch` の `close` / `openInBrowser` に結線
  - `v-dialog` の閉操作（背景クリック等）を `close()` へ反映
- **使用 Composables**: `useSimilarSearch`
- **子コンポーネント**: `IssueSimilarResults`
- **ステータス**: ✅ 実装済み（v0.4）

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
  - `Issue`: 課題データ型定義（id, issueKey, summary, description, priority, status, issueType, assignee, dueDate, updated, relevance_score, workspace_id）。v0.3 で AI 結果フィールドを追加（`ai_summary?` / `ai_risk_level?`（`'high' | 'medium' | 'low'`） / `ai_suggestion?` / `ai_delay_days?` / `ai_processed_at?`。get_issues の `ai_results` LEFT JOIN から設定。未生成の課題はすべて `undefined`）。v0.4 で `embedding_ready?: boolean` を追加（埋め込みベクトル生成済みか。`false` のとき類似検索を「構築待ち」として degrade、`undefined` は未取得経路）
- **ステータス**: ✅ 実装済み

### `composables/useAiSettings.ts`（v0.3 新設）

- **役割**: AI 機能の有効化状態・可用性・ジョブキュー状況・コーパス設定を管理する Composable（FR-V03-002 / FR-V03-003 / FR-V03-004 / FR-V04-003）
- **Export**:
  - `aiEnabled`: AI 機能の有効化状態（Ref）
  - `availability`: 可用性情報（`AiAvailability | null`、Ref）
  - `queueStatus`: キュー状況 `[pending, processing]`（Ref）
  - `loadingAvailability`: 可用性取得中フラグ（Ref）
  - `loadingQueue`: キュー状況取得中フラグ（Ref）
  - `corpusMonths`: コーパス取り込み期間（月数、Ref。既定 6）（v0.4 追加）
  - `corpusCount`: 全ワークスペース合算コーパス件数（`number | null`、Ref）（v0.4 追加）
  - `embeddingStatus`: 埋め込み構築進捗（`EmbeddingStatus | null`、Ref。`target`/`built` フィールド）（v0.4 追加）
  - `loadingCorpus`: コーパス件数取得中フラグ（Ref）（v0.4 追加）
  - `loadingEmbedding`: 埋め込み進捗取得中フラグ（Ref）（v0.4 追加）
  - `isAiReady`: AI 有効かつ利用可能（Computed）
  - `totalQueueCount`: pending + processing の合計（Computed）
  - `embeddingProgressPercent`: 埋め込み構築進捗割合 0〜100（Computed。対象 0 件時は 100）（v0.4 追加）
  - `loadEnabled()`: DB から AI 有効化状態を読み込む
  - `loadAvailability()`: `get_ai_availability` コマンドで可用性を取得
  - `loadQueueStatus()`: `get_ai_queue_status` コマンドでキュー状況を取得
  - `enableAi()`: `save_ai_setting(true)` で AI 機能を有効化
  - `disableAi()`: `save_ai_setting(false)` で AI 機能を無効化
  - `reanalyze(workspaceId, issueId)`: `reanalyze_issue` コマンドで課題を再分析キューに投入
  - `loadCorpusMonths()`: `get_settings('corpus_months')` で取り込み期間を DB から読み込む（v0.4 追加）
  - `saveCorpusMonths(months)`: `save_settings('corpus_months', ...)` で取り込み期間を DB に保存（v0.4 追加）
  - `loadCorpusCount()`: 全ワークスペースの `get_closed_issues_corpus_count` を並列呼び出しして合算（v0.4 追加）
  - `loadEmbeddingStatus()`: 全ワークスペースの `get_embedding_status` を並列呼び出しして合算（v0.4 追加）
- **主な機能**:
  - グローバルステートパターン（module スコープ ref）で状態を全コンポーネント間で共有
  - AI 非対応環境では静かに失敗し既存機能を阻害しない
  - `availabilityReasonToMessageKey(reason)`: `AiAvailabilityReason` を `ai.availability.*` i18n キーへマップするヘルパー（名前付きエクスポート）
  - コーパス関連アクションは取得失敗時に 0 / null として静かに失敗し、既存 AI 機能を阻害しない（v0.4 追加）
- **インターフェース**:
  - `AiAvailabilityReason`: 可用性理由の union 型（`available` / `unsupportedOs` / `appleIntelligenceDisabled` / `modelNotReady` / `deviceNotEligible` / `unavailable`）
  - `AiAvailability`: get_ai_availability の戻り値型（`available` / `reason` / `detail?` / `macosMajor?` / `otherBackendAvailable`）
  - `AiQueueStatus`: `[number, number]`（pending, processing）
  - `EmbeddingStatus`: `{ target: number; built: number }`（v0.4 追加）
- **ステータス**: ✅ 実装済み（v0.4 でコーパス設定・埋め込み進捗管理を追加）

### `composables/useSimilarSearch.ts`（v0.4 新設）

- **役割**: 課題起点の横断類似検索と解決策要約を管理する Composable（FR-V04-005 / NFR-V04-005）
- **Export**:
  - `dialogOpen`: 類似検索ダイアログの開閉状態（Ref）
  - `queryIssue`: 検索の起点課題（`Ref<Issue | null>`）
  - `results`: 類似検索結果（`SimilarIssue[]`、類似度降順、Ref）
  - `loading`: 検索実行中フラグ（Ref）
  - `summary`: 解決策要約テキスト（`string | null`、Ref）
  - `summaryLoading`: 要約生成中フラグ（Ref）
  - `degradedReason`: degrade 理由（`SimilarDegradedReason | null`、Ref）
  - `openSimilar(issue)`: ダイアログを開き `search_similar_issues` → `summarize_solutions` を順に実行
  - `close()`: ダイアログを閉じる
  - `openInBrowser(item)`: 類似候補（`SimilarIssue`）を `get_workspace_by_id` でドメインを引いて Backlog のチケット URL を組み立て既定ブラウザで開く（IssueCard / IssueDetailDialog の `openInBrowser` と同等。失敗は無視）
- **主な機能**:
  - グローバルステートパターン（module スコープ ref）で状態を全コンポーネント間で共有（同時に開くダイアログは 1 つ）
  - 埋め込み未構築（`embedding_ready === false`）・AI 非対応・検索失敗時は例外を投げず `degradedReason` に集約して degrade（NFR-V04-005）
  - 解決策要約の出力言語は UI 言語（vue-i18n の `locale` = 永続化済み `language` 設定）に追従し `summarize_solutions` の `lang` 引数へ渡す（`workspaceId` はクエリ課題の `workspace_id` を渡す）
- **インターフェース**:
  - `SimilarIssue`: `search_similar_issues` の戻り値型（`id` / `issueKey` / `summary` / `status?` / `assignee?` / `projectKey?` / `similarity` / `isCorpusOnly` / `workspaceId`）
  - `SimilarDegradedReason`: degrade 理由の union 型（`aiUnavailable` / `embeddingNotReady` / `searchFailed`）
- **依存コマンド**: `search_similar_issues`（横断類似検索）, `summarize_solutions`（FoundationModels 再利用の解決策要約）
- **使用 Composables**: `useAiSettings`（`isAiReady`）
- **ステータス**: ✅ 実装済み（v0.4）

### `composables/useReports.ts`（v0.4.5 新設）

- **役割**: レポート/サマリー画面（`pages/reports.vue`）の状態管理・degrade 制御・コマンド呼び出しを集約する Composable（FR-V045-002 / FR-V045-003 / FR-V045-004 / FR-V045-005 / FR-V045-006 / NFR-V045-003）
- **Export**:
  - `crossSummary`: 横断サマリ state（`stats` / `headline` / `narrative` / `generatedAt`、Ref）
  - `weekly` / `monthly`: 週次・月次レポート state（`selectedPeriod` / `periods` / `stats` / `narrative` / `generatedAt`、Ref）
  - `loadingCross` / `loadingWeekly` / `loadingMonthly`: 種別ごとのロード中フラグ（Ref）
  - `regenerating`: 再生成中フラグ（`Record<ReportType, boolean>`、Ref。再生成スピナー用）
  - `degradedReason`: 種別ごとの degrade 理由（`Record<ReportType, ReportDegradedReason | null>`、Ref）
  - `backgroundSummary` / `backgroundSummaryLoading` / `backgroundSummaryLoaded`: per-issue 背景要約 state（要約テキスト / 生成中フラグ / 取得完了フラグ、Ref。IssueDetailDialog は同時1つのため `useSimilarSearch` 同様のモジュール単一インスタンスで共有。空文字 + `Loaded=true` で「コメントなし」表示を出し分け）
  - `loadReports(workspaceId)`: 横断サマリ + 週次/月次（期間一覧取得 → 最新期間の内容取得）をまとめて読み込む
  - `selectPeriod(workspaceId, reportType, periodKey)`: 週次/月次の表示期間を切り替える（期間セレクタ用）
  - `regenerate(workspaceId, reportType)`: `generate_reports` を invoke して即時再生成し state を更新（週次/月次は期間一覧も取り直す）
  - `generateBackgroundSummary(workspaceId, issueId, lang?)`: `get_background_summary` を invoke し背景・経緯の要約文字列を返しつつ per-issue 背景要約 state を更新（IssueDetailDialog から呼ぶ。`lang` 省略時は UI 言語に追従。コメントなし・AI 非対応・生成失敗・DB エラーは空文字へ degrade。2回目以降は Rust 側 `source_hash`+`lang` キャッシュで即返し）
  - `resetBackgroundSummary()`: per-issue 背景要約 state を初期化（ダイアログを開き直したときに前の課題の要約を残さない）
- **主な機能**:
  - グローバルステートパターン（module スコープ ref）で状態を共有（`/reports` は単一インスタンス）
  - 数値（統計テーブル）は SQL 集約で常に表示でき、narrative のみ AI 非対応・未生成・取得失敗時に例外を投げず `degradedReason` に集約して degrade（NFR-V045-003）
  - `report_summaries.stats_json`（文字列）を `parseCrossStats` / `parsePeriodStats` で配列へパース（失敗時は空配列へ degrade）
  - 出力言語は UI 言語（vue-i18n の `locale` = 永続化済み `language` 設定）に追従し各コマンドの `lang` 引数へ渡す
- **インターフェース**:
  - `ReportType`: レポート種別 union（`cross_summary` / `weekly` / `monthly`）
  - `PeriodReportType`: 期間履歴を持つ種別 union（`weekly` / `monthly`）
  - `ReportSummary`: `get_reports` / `generate_reports` の戻り値型（`workspaceId` / `reportType` / `periodKey` / `lang` / `statsJson` / `headline` / `narrative` / `generatedAt`）
  - `CrossSummaryStat`: 横断サマリ統計1行（`projectKey` / `openCount` / `overdueCount` / `staleCount` / `myActionableCount` / `riskHigh` / `riskMedium` / `riskLow`）
  - `PeriodActivityStat`: 週次/月次統計1行（`projectKey` / `createdCount` / `updatedCount` / `completedCount`）
  - `ReportDegradedReason`: degrade 理由の union 型（`aiUnavailable` / `notGenerated` / `loadFailed`）
- **依存コマンド**: `get_reports`（保存済みレポート取得）, `list_report_periods`（期間キー一覧）, `generate_reports`（生成・保存）, `get_background_summary`（課題の背景・経緯の要約）
- **使用 Composables**: `useAiSettings`（`isAiReady`）
- **ステータス**: ✅ 実装済み（v0.4.5）

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
  - `RiskLevel`: リスクレベル enum（serde で `high` / `medium` / `low` に小文字化。`ai_results.risk_level` と一致）。v0.4 で `Ord` を導出し **Low < Medium < High** の順に宣言（`final_risk = max(llm_risk, schedule_risk)` 合成用。FR-V04-006）。メソッド `as_storage_str()`（保存文字列へ）/ `from_storage_str(&str)`（保存文字列から復元。再計算で LLM リスクを戻す）を持つ
  - `BackendKind`: バックエンド種別 enum（v0.3 は `FoundationModels` のみ。将来 MLX/Candle を追加）
- **主な定数**:
  - `CONTEXT_BODY_MAX_CHARS`: 課題本文の切り詰め文字数（コンテキスト上限対応の一元定義。実測後はここのみ更新）
- **主な関数**:
  - `schedule_risk(delay_days: Option<i64>) -> RiskLevel`（v0.4・FR-V04-006）: 遅延日数から**決定的に**スケジュール由来リスクを算出。`>14日`=High / `1〜14日`=Medium / `当日〜3日以内`(`-3..=0`)=Medium / それ以外（猶予十分・期限なし）=Low（内容リスク据え置き）。`delay_days` は SQL 算出値（正=超過・0=当日・負=猶予）。worker と `recompute_schedule_risk` で共用。しきい値はこの1関数に集約
  - `create_backend<R: tauri::Runtime>(app: AppHandle<R>, kind: BackendKind) -> Result<impl LlmInference>`: バックエンド生成のレジストリ的入口。`FoundationModels` アームは `FoundationModelsBackend::new(app)` を返す（v0.3 でスタブから実バックエンドへ更新）。v0.4 以降のバックエンドは `BackendKind` バリアントと `match` アームの追加で導入可能。複数アームが異なる具体型を返す段階になったら enum ディスパッチへ切り替える（呼び出し側シグネチャは不変）
- **サブモジュール**: `availability`（下記）／`embedding`（下記）／`embed_worker`（下記・v0.4）／`foundation_models`（下記）／`worker`（下記）
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

### `src-tauri/src/ai/embedding.rs`

- **役割**: 埋め込み生成の抽象基盤（v0.4 新設・FR-V04-001）。OS 組み込みの埋め込みモデル（既定 `NLContextualEmbedding` / 論理名 `apple-nl-contextual-ja` / 512次元）による課題テキストのベクトル化を、推論経路（`LlmInference`）とは**別経路**として抽象化する。`ai/mod.rs` の `BackendKind` / `create_backend` レジストリ設計思想を埋め込み側に対置した骨格
- **主なトレイト**:
  - `EmbeddingBackend`: 埋め込みバックエンドの抽象トレイト。`embed(&self, EmbeddingInput) -> impl Future<Output = Result<EmbeddingOutput>> + Send`（`prefix` を各テキスト先頭へ付与してモデルへ渡す。入出力は同順・同数）／`dim(&self) -> usize`（出力次元）／`model_name(&self) -> &str`（モデル識別名・再埋め込みポリシー判定用）を定義（native async-fn-in-trait。`+ Send` 制約のため `impl Future` 形式）
- **主な型**:
  - `EmbeddingInput`: 埋め込み入力（`texts`（切り詰め済み・プレフィックス未付与の対象テキスト群） / `prefix`（全要素へ一律適用））
  - `EmbeddingOutput`: 埋め込み出力（`vectors`。入力 `texts` と同順・同数のベクトル群。次元は `dim()` と一致）
  - `EmbedPrefix`: e5 系の入力プレフィックス enum（`Query` = `"query: "` / `Passage` = `"passage: "`。serde lowercase）。クエリと被検索文に**非対称**付与。`as_str()` / `apply(text)` ヘルパーを持つ。**ワイヤ契約として保持するが、既定の `NLContextualEmbedding` は使用しない**（将来 e5 系 DL バックエンドを足したとき sidecar が `prefix` を見て付与する）
  - `EmbeddingBackendKind`: 埋め込みバックエンド種別 enum（v0.4 既定は `AppleNLContextual`（OS 組み込み `NLContextualEmbedding`）。将来 e5 系 DL モデル等を追加）
- **主な定数**:
  - `EMBEDDING_DIM`: 出力次元（= 512。`issue_embeddings` の BLOB レイアウトと一致）
  - `EMBED_SOURCE_MAX_CHARS`: 埋め込み元テキストの切り詰め上限文字数（= 1800。512トークン対策の保守的既定値。実測判明後はここのみ更新）
- **主な関数**:
  - `build_embed_source(summary, description, comments) -> String`: 単一ベクトル方式の埋め込み元テキスト組み立て。タイトル→本文→コメントを改行結合し `EMBED_SOURCE_MAX_CHARS` で**文字単位（マルチバイト境界保護）**に切り詰める。空パートはスキップ。プレフィックスは付与しない（付与は `embed` の責務）
  - `create_embedding_backend<R: tauri::Runtime>(app: AppHandle<R>, kind: EmbeddingBackendKind) -> Result<impl EmbeddingBackend>`: 埋め込みバックエンド生成のレジストリ的入口（`create_backend` と同方針）。`AppleNLContextual` アームは `FoundationModelsBackend::new(app)` を返す（analyze と同一 sidecar・同一管理タスクを共用し `embed` 要求で 512 次元ベクトルを得る。v0.4 でスタブから実バックエンドへ更新）。可用性は `availability::check_availability` を流用し、非対応環境（Intel 等）では `embed` が `Err` を返して呼び出し側が検索機能のみ degrade（NFR-V04-004 / NFR-V04-005）
- **設計方針**: `LlmInference` とは別経路（入出力・呼び出し頻度が異なるためトレイト/レジストリ分離）／プレフィックスは将来 e5 系用のワイヤ契約として保持（既定 `NLContextualEmbedding` は不使用）／**単一ベクトル方式を既定**（512トークン対策の「チャンク分割 vs ダイジェスト」未解決事項は単一ベクトル＋文字数切り詰めで既定化。ダイジェスト移行は結合テキスト差し替えのみで残す）／バックエンド差し替えを `ai/` 内に閉じる／埋め込み非対応環境を阻害しないため生成は `Result` で失敗許容
- **テスト**: プレフィックス文字列・`apply` 付与（query/passage 非対称）・モックバックエンドでの `embed` プレフィックス付与・`dim`・`model_name`・`build_embed_source`（結合/空スキップ/文字数切り詰め）の 8 テスト（`#[cfg(test)]`、モックバックエンド）
- **ステータス**: ✅ 実装済み（v0.4。trait・入出力型・`EmbedPrefix`・`build_embed_source`・`create_embedding_backend` レジストリ入口。`create_embedding_backend` は `FoundationModelsBackend`（sidecar 連携・`EmbeddingBackend` 実装）へ解決。`cargo build` / `cargo clippy -D warnings` / 単体テスト 8件 通過）

### `src-tauri/src/ai/foundation_models.rs`

- **役割**: FoundationModels バックエンド（v0.3 新設・v0.4 で埋め込み追加）。`externalBin` 同梱の Swift sidecar を `tauri-plugin-shell` で起動し、JSON Lines over stdin/stdout で通信する `LlmInference` 実装（FR-V03-001）。v0.4 で同一 sidecar・同一管理タスクを共用する `EmbeddingBackend` 実装を兼ねる（FR-V04-001）
- **主な公開要素**:
  - `FoundationModelsBackend`: `LlmInference` + `EmbeddingBackend` 実装。`new(app)` で生成し、要求を内部の管理タスクへ MPSC 送信して oneshot で応答受信。`Clone` 可（同一管理タスク・同一状態を共有）
    - `infer(&self, AiAnalysisInput) -> Result<AiAnalysisOutput>`: 課題1件の構造化分析（一時停止中は即エラー）
    - `availability(&self) -> Result<AvailabilityInfo>`: 可用性問い合わせ（FR-V03-002）
    - `embed(&self, EmbeddingInput) -> Result<EmbeddingOutput>`（`EmbeddingBackend`）: テキスト群を 512 次元ベクトルへ変換（FR-V04-001。一時停止中は即エラー。応答は件数・次元を検証）／`dim() -> usize`（= `EMBEDDING_DIM`）／`model_name() -> &str`（= `EMBEDDING_MODEL_NAME`）
    - `state(&self) -> SidecarState`: 稼働状態取得（設定画面の動作状況表示用）
    - `resume(&self)`: 一時停止解除＋失敗カウンタリセット（手動再開）
  - `AvailabilityInfo`: 可用性情報（`available` / `reason`。reason は sidecar の理由コード文字列。フロントで理由別メッセージへマップ）
  - `SidecarState`: 稼働状態 enum（`Running` / `Suspended`。serde lowercase）
  - 定数: `SIDECAR_NAME`（externalBin ベース名 `binaries/projectlens-ai-sidecar`）/ `BACKEND_NAME`（`foundation-models`。`ai_results.model_used` に記録）/ `EMBEDDING_MODEL_NAME`（`apple-nl-contextual-ja`。`issue_embeddings.model` に記録・再埋め込み判定用。バックエンド名とは別概念）/ `MAX_CONSECUTIVE_FAILURES`（一時停止閾値=3）
- **プロセス管理・自動再起動（FR-V03-001）**: 専用の管理タスクが要求を1件ずつ直列処理（同時推論1件・NFR-V03-003）。analyze と embed は同一 sidecar プロセスを共用（直列化されるため同時実行は構造的に1件）。sidecar は遅延起動（アイドル時非消費）し、正常時は常駐プロセスを再利用。異常終了（`Terminated`/`Error`/タイムアウト）を検知すると次要求で再起動。連続失敗が閾値超過で `Suspended` へ遷移し以降の要求を即エラー化、`resume()` で復帰。プロセス drop 時は `CommandChild::kill` で停止
- **応答突合**: sidecar プロトコルに要求 ID が無く応答は送信順に1対1対応するため、管理タスクの直列処理で突合を担保。sidecar の `error` 応答は通信成立とみなし要求のみ失敗（再起動しない）。embed 応答は件数（要求 texts 数）と各ベクトルの次元（`EMBEDDING_DIM`）を検証し、不一致は `Err`（BLOB 保存・コサイン類似度計算の前提を守る）
- **テスト容易性**: sidecar 起動・通信を `SidecarTransport` / `SidecarProcess` トレイトで抽象化。本番は `ShellSidecarTransport`、テストはモックで管理タスクのロジック（analyze/embed の要求応答・再起動・連続失敗での一時停止・プロトコル整合・analyze と embed の sidecar 共用・embed の件数/次元検証）を実機なしで検証（`#[cfg(test)]` で 16 テスト）
- **プロトコル整合**: `src-tauri/sidecar/` の入出力契約と一致（リクエスト `availability`/`analyze`/`embed`/`shutdown`、レスポンス `availability`/`result`/`embedding`/`error`）。embed の `prefix` は serde lowercase で `query`/`passage`（sidecar の `EmbedPrefix.rawValue` と一致）
- **ステータス**: ✅ 実装済み（cargo build / clippy `-D warnings` / 単体テスト 16件 通過。`tauri.conf.json` の `bundle.externalBin` 登録・build.sh での sidecar ビルド/署名/同梱は完了。実機での `externalBin` 起動連携・埋め込みモデル配置後の embed 応答は検証機での要確認）

### `src-tauri/src/ai/worker.rs`

- **役割**: バックグラウンドAIワーカー（v0.3 新設・FR-V03-004 / FR-V03-005）。`job_queue` の `pending` ジョブを **同時1件** で消費し、推論結果を `ai_results` に保存する独立タスク
- **主な公開要素**:
  - `init(app: AppHandle)`: ワーカー起動（`lib.rs` の setup から DB 準備後に呼ぶ）。`create_backend` でバックエンドを生成し、生成失敗（AI 非対応環境等）ならワーカーを起動せず本体は阻害しない
  - 定数: `SETTING_AI_ENABLED`（`ai_enabled`。値 `"true"` のときのみ処理） / `JOB_TYPE_SUMMARIZE`（`summarize`） / `JOB_TYPE_EMBED`（`embed`。v0.4。埋め込み生成ジョブの種別。scheduler/手動sync が投入し埋め込み専用ワーカーが消費。`enqueue_jobs` の pending 重複抑止は種別ごとに独立に効く） / `MAX_JOB_RETRIES`（推論リトライ上限=3）
- **処理フロー**（`run_loop` → `drain_queue` → `process_job`）: `POLL_INTERVAL_SECS`（30秒）ごとに、AI 機能 ON のときだけ `get_pending_jobs(1)` で1件取得 → `processing` へ遷移 → `get_issue_analysis_fields` で課題取得＋本文 SQL 切り詰め → `AiAnalysisInput` 整形（言語は `settings.language`、既定 ja）→ `infer_with_retry`（最大3回）→ `get_issue_delay_days` の **SQL 算出遅延日数** を付与 → **`final_risk = max(llm_risk, schedule_risk(delay_days))`** で最終リスクを合成（v0.4・FR-V04-006。期限大幅超過は LLM が低リスクでも high へ昇格）→ `save_ai_result`（UPSERT・`final_risk.as_storage_str()`）→ `done`。課題不在・全リトライ失敗は `failed` にしてスキップ記録（FR-V03-005）。1件以上処理したら `refresh-issues` イベントを emit
- **アイドル設計（NFR-V03-003）**: AI 機能 OFF・可用性なし・キュー空のときは推論せずアイドル。同時推論1件はバックエンド側の管理タスクで担保。`sync`・UI をブロックしない独立タスク
- **テスト**: リトライ成功（上限内）/ リトライ枯渇 / RiskLevel→保存文字列マッピング の 3 テスト（`#[cfg(test)]`、モックバックエンド）。スケジュールリスクのしきい値・`max` 合成テストは `ai/mod.rs` 側に集約
- **ステータス**: ✅ 実装済み（cargo build / clippy `-D warnings` / 単体テスト 通過。sync 連携でのキュー投入・起動時再開トリガーは後続項目で接続）

### `src-tauri/src/ai/embed_worker.rs`

- **役割**: バックグラウンド埋め込みワーカー（v0.4 新設・FR-V04-001 / FR-V04-004）。`job_queue` の `embed` ジョブ（`JOB_TYPE_EMBED`）を **同時1件** で消費し、課題テキストの埋め込みベクトルを `issue_embeddings` に保存する独立タスク。summarize ワーカー（`worker.rs`）とは別タスクで動き、本体機能・summarize・v0.3 AI を阻害しない（NFR-V04-005）
- **主な公開要素**:
  - `init(app: AppHandle)`: ワーカー起動（`lib.rs` の setup から DB 準備後・summarize ワーカーと並べて呼ぶ）。`create_embedding_backend(AppleNLContextual)` でバックエンドを生成し、生成失敗（AI 非対応環境等）ならワーカーを起動せず本体は阻害しない
- **処理フロー**（`run_loop` → `drain_queue` → `process_job`）: `POLL_INTERVAL_SECS`（30秒）ごとに、AI 機能 ON（`worker.rs` と共有の `SETTING_AI_ENABLED`）のときだけ `get_pending_jobs(1)` で1件取得 → 先頭が `embed` 以外（summarize 等）ならその場でループ脱出（横取りせず summarize ワーカーへ委ねる）→ `embed` なら `processing` へ遷移 → `get_issue_embed_text`（本文・コメントを SQL 切り詰め）で埋め込み元テキスト取得 → `compute_source_hash` を算出し `get_embedding_source_hash` と一致なら**再埋め込みスキップで `done`**（FR-V04-004）→ 変化していれば `embed_with_retry`（`passage:` プレフィックス指定・最大 `MAX_JOB_RETRIES` 回。既定 `NLContextualEmbedding` は prefix を無視）で 512 次元ベクトル生成 → 次元検証（`backend.dim()` と一致）→ `save_embedding`（BLOB UPSERT・`EMBEDDING_MODEL` / `source_hash` 記録）→ `done`。課題不在・全リトライ失敗・次元不一致は `failed` にしてスキップ記録（NFR-V04-005）
- **再埋め込みポリシー（FR-V04-004 / 未解決事項#5）**: `source_hash` は標準ライブラリ `DefaultHasher`（SipHash・追加依存なし）で算出した 16桁16進文字列。暗号強度不要で「同一テキスト→同一ハッシュ」の変更検知のみが要件。保存済みハッシュと一致すれば埋め込みを行わず sidecar も起こさない（アイドル時非消費・NFR-V04-003）。モデル更新時の再生成は `issue_embeddings.model` 側で将来対応（本ワーカーは未実装）
- **アイドル設計（NFR-V04-003）**: AI 機能 OFF・可用性なし（embed が `Err`）・キュー空のときは埋め込みせずアイドル。同時1件はバックエンド側の管理タスクで担保（analyze と同一 sidecar を直列共用）。`sync`・UI をブロックしない独立タスク
- **テスト**: embed ジョブ消費→ベクトル保存→`source_hash` 不変でスキップ（完了条件）/ 課題不在で `failed` / テキスト変更で再埋め込み / `compute_source_hash` の決定性・敏感性 の 4 テスト（`#[cfg(test)]`、in-memory SQLite + 呼び出し回数を数えるモック `EmbeddingBackend`）。課題仕込みはクレート内共通の `DbClient::insert_test_issue`（`#[cfg(test)] pub(crate)`）を使用
- **ステータス**: ✅ 実装済み（cargo build / clippy `-D warnings` / fmt / 単体テスト 4件 通過。`lib.rs` setup で `ai::embed_worker::init` を起動。sync 連携での embed ジョブ投入は後続項目で接続）

### `src-tauri/src/ai/cosine.rs`

- **役割**: コサイン類似度計算（v0.4 新設・FR-V04-004）。埋め込みベクトル（512次元）どうしの類似度を、外部依存を増やさず f32 演算の純粋関数として総当たり計算する最小モジュール。`search_similar_issues` コマンドが利用
- **主な関数**:
  - `cosine_similarity(a: &[f32], b: &[f32]) -> f32`: 内積・両ノルムを1パスで計算（NFR-V04-002 を意識）。**ゼロベクトル・次元不一致は `NaN` を返さず `0.0`（無相関）を返す**（上位N抽出のソート破綻防止）
- **テスト**: 同一=1.0 / 直交=0.0 / 反転=-1.0 / スケール不変=1.0 / ゼロベクトルで NaN を返さない / 次元不一致で 0.0 / 手計算（`1/√2`）一致 の 7 テスト（`#[cfg(test)]`）
- **ステータス**: ✅ 実装済み（v0.4。`ai/mod.rs` に `pub mod cosine` を追加。`cargo build` / `clippy -D warnings` / 単体テスト 7件 通過）

### `src-tauri/sidecar/`（Swift sidecar: FoundationModels + 埋め込み）

- **役割**: macOS 26 の FoundationModels で課題1件を guided generation 分析し、加えて OS 組み込みの `NLContextualEmbedding(language: .japanese)`（NaturalLanguage・CJK 対応）で課題テキストの埋め込みベクトル（512次元・トークン文脈ベクトルを mean-pooling）を生成する常駐プロセス（v0.3 新設・v0.4 で埋め込み追加）。Tauri 本体から `externalBin` 同梱され、JSON Lines over stdin/stdout で通信する
- **主なファイル**:
  - `Package.swift`: Swift Package 定義（`.macOS("26.0")` / executableTarget `projectlens-ai-sidecar`）。`resources: [.copy("Resources")]` は**将来の DL 可能 e5 モデル用のスキャフォールド**（既定の `NLContextualEmbedding` は OS 提供のためモデルファイル不要）
  - `Sources/projectlens-ai-sidecar/main.swift`: 本体。`readLine()` ブロッキング read のメインループ（アイドル時 CPU 非消費・NFR-V03-003）。v0.4 で `embed` ケース・`handleEmbed`・`EmbeddingModel`（`NLContextualEmbedding` 遅延ロード holder）を追加
  - `Sources/projectlens-ai-sidecar/Resources/`: 将来の DL 可能 e5 モデル（`.mlmodelc`）・語彙の置き場として用意したスキャフォールド。**現状は `README.md` のみ**で、既定の `NLContextualEmbedding` は OS 提供のためモデルファイルは不要（配布サイズ増なし）
  - `README.md`: 入出力契約・ビルド要件・埋め込みモデル配布形式・未解決事項の明文化
- **入出力契約**（Rust 側 `ai/mod.rs` + `ai/embedding.rs` と一致）:
  - リクエスト（1行 JSON）: `{type:"availability"}` / `{type:"analyze", issue_key, summary, description_head, status, due_date?, lang}` / `{type:"embed", texts:[...], prefix:"query|passage"}`（v0.4。texts は切り詰め済み・**プレフィックス未付与**） / `{type:"shutdown"}`（EOF でも終了）
  - レスポンス（1行 JSON）: `{type:"availability", available, reason}`（reason: `available` / `appleIntelligenceNotEnabled` / `modelNotReady` / `deviceNotEligible` / `unavailableOther`） / `{type:"result", summary, risk_level, suggestion}` / `{type:"embedding", vectors:[[...512f...],...]}`（v0.4。入力 texts と同順・同数・512次元） / `{type:"error", message}`
- **埋め込みプレフィックスの契約（将来 e5 用）**: `prefix`（`query:` / `passage:`）は **e5 系バックエンドを足したとき sidecar 側で付与する**ためのワイヤ契約。Rust 側は `prefix` でどちらを付けるかを渡すだけで texts には付与しない（付与点を一箇所に固定）。**既定の `NLContextualEmbedding` は prefix を使用せず無視する**。sidecar の `EmbedPrefix.literal` と Rust `EmbedPrefix::as_str()`（`"query: "` / `"passage: "`）を一致させておく
- **埋め込みモデル方式（既定）**: 既定は OS 組み込みの **`NLContextualEmbedding`（NaturalLanguage・macOS 14+・日本語/CJK・512次元）**。**OS がアセットを提供するためモデルファイルの同梱は不要・配布サイズ増なし**（NFR-V04-004）。`mlx-swift` 等の追加依存も無い。アセット未取得・利用不可（Intel 機等）の環境では Rust 側が埋め込みを無効化し embed を送らない（検索のみ degrade・NFR-V04-005）。**将来の高精度化オプション**として e5 系モデルを Core ML（`.mlmodelc`）で `Resources/` に配置し DL 差し替えできる土台（`Bundle.module` / `.copy("Resources")`）を残してある（配置時は MIT ライセンス・100〜250MB 程度の配布サイズ増。現状は未配置）
- **構造化出力**: `@Generable struct AnalysisGeneration`（summary / riskLevel / suggestion）+ `@Generable enum GenerationRiskLevel`（high/medium/low）。遅延日数は SQL 算出のためスキーマに含めない
- **言語追従**: `lang`（ja/en）で instructions を切替（FR-V03-005）
- **設計上の注意**: instructions は guided generation スキーマと合算でコンテキストを消費するため簡潔に保つ（長い日本語 instructions はコンテキスト超過を誘発したため最小化）。埋め込みモデルは初回 `embed` 要求まで遅延ロード（`EmbeddingModelHolder`）。runLoop は単一スレッド直列処理のため holder は `@unchecked Sendable`
- **ビルド統合**: `tauri.conf.json` の `bundle.externalBin` に `binaries/projectlens-ai-sidecar` を登録。build.sh が `tauri:build` の前に `swift build -c release` でビルドし、出力を `src-tauri/binaries/projectlens-ai-sidecar-<target-triple>`（triple は rustc ホストトリプル）として配置・codesign する。v0.4 で SwiftPM 生成のリソースバンドル（`projectlens-ai-sidecar_projectlens-ai-sidecar.bundle`）を `binaries/` へ複製しモデル同梱状況・サイズを表示。sidecar ビルド失敗時は AI 機能なしで本体ビルドを継続（フォールバック）。生成物 `src-tauri/binaries/` は gitignore 済み
- **未解決事項**: (1) 埋め込みモデルの実配置と `EmbeddingModel.embed(_:)` の入出力結線（トークナイズ + mean pooling + L2 正規化）。(2) リソースバンドルを最終 `.app/Contents/MacOS/` の実行ファイル隣へ運ぶ結線（`Bundle.module` 解決の前提・リリースビルド統合の別作業項目）。(3) notarization は検証機（Developer ID）依存で手順明文化まで（`APPLE_SIGNING_IDENTITY`→`xcrun notarytool submit`→`stapler staple`）
- **ステータス**: ✅ 実装済み（macOS 26.3.1 + Xcode 26.4 + Apple Intelligence + Apple Silicon で `swift build -c release` 成功。`availability` / `analyze` / `embed`（モデル未配置時の error・空入力の空ベクトル・prefix/texts 欠落の入力検証）を各入力1行1応答で実機確認）。埋め込みモデル本体の配置・入出力結線とリソースバンドルの `.app` 同梱は後続項目

### `src-tauri/src/backlog.rs`

- **役割**: Backlog APIクライアント
- **主な構造体**:
  - `BacklogClient`: APIクライアント
  - `Issue`: 課題データ。v0.3 で AI 結果フィールドを追加（`ai_summary` / `ai_risk_level` / `ai_suggestion` / `ai_delay_days` / `ai_processed_at`。すべて `#[serde(default)]` で、`get_issues` の `ai_results` JOIN 結果から設定。raw_data に無くても欠落初期値になりフロントへそのまま渡る）。v0.4 で `is_corpus_only: bool`（`#[serde(skip_deserializing, default)]`）を追加。完了課題コーパス取り込み時に `true` を立て、`save_issues` で `issues.is_corpus_only` カラムへ保存する（FR-V04-003）。v0.4.5 で `created: Option<String>`（API の `created`・`#[serde(default)]`）を追加し、`save_issues` で `issues.created_at` カラムへ展開（週次/月次レポートの新規作成件数集計用。FR-V045-003）
  - `Priority`: 優先度
  - `Status`: ステータス
  - `IssueType`: 種別
  - `User`: ユーザー
  - `Project`: プロジェクト
- **主な機能**:
  - 課題一覧取得（`get_issues(project, status_ids)`）
  - プロジェクト一覧取得
  - 現在のユーザー情報取得
  - コメント差分取得（v0.4）: `get_comments(issue_id_or_key, min_id)` — `GET /issues/:id/comments` を `minId`（指定時のみ）・`order=asc`・`count=100` で呼び、`(Vec<db::Comment>, RateLimitInfo)` を返す（FR-V04-002）。返却型は `db::Comment` を共有（serde `alias = "created"` で API の投稿日時を取り込む）
  - 完了課題コーパス取得（v0.4）: `get_closed_issues(project, updated_since, offset)` — `statusId[]=4`（完了）+ `updatedSince`（指定時のみ）+ `count=100` + `offset` で完了課題をページング取得し、各 `Issue` に `is_corpus_only = true` を立てて返す（FR-V04-003）
  - クエリ組み立て（純粋関数・テスト対象）: `build_comments_query(api_key, min_id)` / `build_closed_issues_query(api_key, project_id, updated_since, offset)`
- **ステータス**: ✅ 実装済み（v0.4 コメント差分取得・完了課題コーパス取得を追加。クエリ組み立ての単体テスト6件・`cargo test` / `clippy -D warnings` / `fmt --check` 通過）

### `src-tauri/src/commands.rs`

- **役割**: Tauriコマンド定義
- **Export**:
  - `greet`: テスト用挨拶コマンド
  - `save_settings`: 設定保存
  - `get_settings`: 設定取得
  - `fetch_issues`: 課題取得・スコアリング（手動sync。保存後に新規・更新チケットを差分検出して AIジョブをキュー投入。v0.3）。v0.4 で末尾に `scheduler::sync_corpus_and_embeddings` を呼び、完了課題コーパス取り込み・コメント差分取得・embed ジョブ投入を手動sync経路でも実行（レート残量でバックオフ。scheduler 経路と実装共有）
  - `fetch_projects`: プロジェクト一覧取得
  - `get_issues`: 保存済み課題取得（`ai_results` LEFT JOIN で AI 結果を同梱。v0.3）。v0.4 で `issue_embeddings` も LEFT JOIN し、各課題に `embedding_ready`（埋め込み構築済みなら `true`。FR-V04-005 の「構築待ち」表示用）を同梱
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
  - `search_similar_issues(workspace_id, issue_id, limit?)`: 課題起点の横断類似検索（v0.4・FR-V04-004/FR-V04-005）。クエリ課題の埋め込みを取得→`get_all_embeddings`（コーパス含む全件を1回ロード。NFR-V04-002）と総当たりで `cosine_similarity` を計算→クエリ自身を除外→しきい値（`SIMILARITY_THRESHOLD = 0.80`・未解決事項#4 の暫定既定）以上を類似度降順に並べ、上位 `limit`（未指定時 `DEFAULT_SIMILAR_LIMIT = 10`）件を返す。各件は `SimilarIssue`（`issueId`/`issueKey`/`summary`/`status`/`assignee`/`projectKey`（issue_key プレフィックスから導出）/`similarity`/`isCorpusOnly`。camelCase）。クエリ課題の埋め込み未構築時は空リスト（エラーにしない・degrade）。中核ランキングは純粋関数 `rank_similar` に分離して単体テスト
  - `summarize_solutions(workspace_id, issue_ids, lang)`: 過去事例の解決策要点を要約（v0.4・FR-V04-005）。類似上位群（`issue_ids`）の「タイトル+本文先頭+コメント先頭」を結合した context を作り、v0.3 の FoundationModels バックエンド（`create_backend`）を**再利用**して解決策要点を生成する。出力言語は `lang`（UI 言語追従 ja/en）。**sidecar は改修せず既存 `analyze` 経路を流用**し、context を `description_head` に載せて `infer` を呼び、返ってきた `suggestion`（対応提案＝解決策要点）に `summary`（補足1行）を添えて文字列で返す（設計判断はコマンドの doc コメント参照）。context は完了課題（コーパス＝解決済み）を優先（`SUMMARIZE_MAX_ISSUES = 5` 件・本文/コメント各 `400` 文字・全体 `SUMMARIZE_CONTEXT_MAX_CHARS = 3000` 文字で切り詰め）。AI 非対応・生成失敗・対象なしは `Err` にせず**空文字**へ degrade し、検索一覧を壊さない（NFR-V04-005）。context 結合（完了課題優先・件数/文字数切り詰め）は純粋関数 `build_solution_context` に分離して単体テスト
  - `get_embedding_status(workspace_id)`: 埋め込み構築進捗を取得（v0.4・FR-V04-005）。`(target, built)` = (対象件数=ワークスペース内全課題数（コーパス含む）, 構築済み件数=`issue_embeddings` 行数) のタプルを返す
  - `get_closed_issues_corpus_count(workspace_id)`: コーパス（完了課題）件数を取得（v0.4・FR-V04-003/FR-V04-005）。`count_corpus_issues`（`is_corpus_only = 1`）を返す
  - `generate_reports(app, workspace_id, report_type, lang) -> ReportSummary`: レポート/サマリーを生成して保存する Tauri コマンド（v0.4.5・FR-V045-002/003/006）。実体は **`pub(crate) generate_report(&app, &db, workspace_id, report_type, lang)`** に切り出し済みで、コマンドは薄いラッパー（`State<DbClient>` を `&DbClient` へ剥がして委譲）。`generate_report` をスケジューラの1日1回バックグラウンド生成（`scheduler::generate_due_reports`・FR-V045-005）と共有することで、手動再生成と自動生成が同一の生成経路を通る。`report_type`（`'cross_summary'`/`'weekly'`/`'monthly'`）に応じて統計を **SQL で決定的に集計**（横断=`get_cross_summary_stats`→`Vec<CrossSummaryStat>` を `stats_json` へ／週次月次=現在の期間境界で `get_period_activity_stats`→`Vec<PeriodActivityStat>` を `stats_json` へ）し、注目上位 N 件（`collect_report_highlight_inputs`→`select_report_highlights`→`build_report_context`）から `generate_report_narrative` で narrative（見出し・注目点）を生成して `save_report_summary` で UPSERT（横断は `period_key='latest'`／週次月次は現在の期間キー）。保存後に `get_report_summary` で読み戻して返す。横断の `me_user_id` は `get_workspaces` から当該 ws の `user_id` を解決。AI 非対応・narrative 失敗は `Err` にせず統計のみ保存し headline/narrative は `None`（degrade。NFR-V045-003）。未知 `report_type` のみ `Err`
  - `get_reports(workspace_id, report_type, period_key, lang) -> Option<ReportSummary>`: 保存済みレポートを1件取得（v0.4.5・FR-V045-006）。`get_report_summary` の薄いラッパー。未生成は `None`
  - `list_report_periods(workspace_id, report_type) -> Vec<String>`: レポートの期間キー一覧を生成日時降順で取得（v0.4.5・FR-V045-003/006）。`list_report_periods`（db）の薄いラッパー。週次/月次の期間セレクタ用
  - `get_background_summary(app, workspace_id, issue_id, lang) -> String`: 課題の背景・経緯・決定事項の要点をコメントから要約（v0.4.5・FR-V045-004）。`get_comments_text`（comment_id 昇順＝時系列順・`BACKGROUND_SUMMARY_COMMENTS_MAX_CHARS = 2000` で先頭優先に切り詰め）でコメント本文を取得し、**コメント空なら LLM を起こさず空文字**を返す（UI が「コメントなし」を表示）。コメント本文の `source_hash`（`crate::ai::embed_worker::compute_source_hash`＝埋め込みと同一 SipHash を再利用）を算出し、`get_background_summary`（db）の保存済みハッシュと **一致すればキャッシュ即返し**（LLM・sidecar を起こさない）。不一致 or 未生成のみ `summarize_solutions` と同方式（**sidecar 改修なしで既存 `analyze` 経路を流用**・`create_backend` FoundationModels 再利用→`infer`・`suggestion`＝要点に `summary`＝補足1行を結合）で生成し、`save_background_summary`（db）でキャッシュ保存して返す。AI 非対応・生成失敗は `Err` にせず空文字へ degrade（NFR-V045-003）。空生成はキャッシュせず次回再試行できるようにする。DB エラーのみ `Err`
- **レポート生成コア（v0.4.5・FR-V045-002/003。`generate_reports` から利用される内部ヘルパー群）**:
  - 定数群（`SUMMARIZE_*` の隣）: `REPORT_HIGHLIGHT_MAX_ISSUES = 8`（注目上位件数の上限。目安5〜10の中庸）/ `REPORT_STALE_THRESHOLD_DAYS = 14`（停滞判定の未更新日数。`get_cross_summary_stats`/`get_report_highlight_inputs` と定義を揃える）/ `REPORT_CONTEXT_MAX_CHARS = SUMMARIZE_CONTEXT_MAX_CHARS`（≈3000。compact context の全体上限）/ `CROSS_SUMMARY_REGEN_HOURS = 20`（`pub(crate)`。横断サマリのバックグラウンド再生成の最小間隔。FR-V045-005。スケジューラ `cross_summary_is_due` が `report_summaries.cross_summary/latest` の `generated_at` 経過時間判定に参照）
  - `iso_week_key(date) -> "YYYY-Www"` / `month_key(date) -> "YYYY-MM"`（`pub(crate)` 純粋関数）: 期間キーの算出。週次は **`strftime` ではなく chrono の `Datelike::iso_week`** で ISO 週番号（月曜起点・ISO 基準年）を確実に得る（年境界で暦年と ISO 基準年が食い違うケースを正しく扱う）。スケジューラの週/月ロールオーバ判定（現在の期間キーで `get_report_summary` が `None` か）でも参照
  - `iso_week_bounds(date)` / `month_bounds(date) -> (start, end)`（純粋関数）: 期間の半開区間 `[start, end)` を `YYYY-MM-DDT00:00:00Z`（UTC 真夜中）で返す。`get_period_activity_stats` の文字列辞書順比較に渡す。週次は月曜00:00〜翌週月曜00:00、月次は当月1日〜翌月1日（12月は翌年へ繰り上げ）
  - `collect_report_highlight_inputs(db, workspace_id) -> Vec<ReportHighlightInput>`: `get_report_highlight_inputs`（db）で通常課題のメタ（課題キー・既存 ai_summary・risk・遅延日数・停滞）を一括取得し `ReportHighlightInput` へ変換（プロジェクトキーは `project_key_from_issue_key` 導出・risk は `RiskLevel::from_storage_str`）。**新規 LLM 呼び出しゼロ**
  - `ReportType`（enum）: `CrossSummary` / `Weekly` / `Monthly`。`report_summaries.report_type` と一致し、narrative 生成指示文の言い回しを切り替える
  - `ReportHighlightInput`（struct）: 注目上位選定の入力1件分（`issue_key` / `project_key` / `ai_summary`（既存 `ai_results.summary` の1行要約）/ `risk_level`（`Option<RiskLevel>`）/ `delay_days`（SQL算出）/ `is_stale`）。DB/LLM 依存を持たず純粋関数で採点・連結できる
  - `report_highlight_score(item)`（純粋関数）: 重み付けスコア。**主**=期限超過日数（正の超過のみ・上限60日でクランプ）+ リスク（high=50/medium=25/low=5/未生成=0）、**従**=停滞（+10）の合算
  - `select_report_highlights(items)`（純粋関数）: `report_highlight_score` で採点しスコア降順（安定ソートで同点は入力順保持）に並べ上位 `REPORT_HIGHLIGHT_MAX_ISSUES` 件へクランプ
  - `build_report_context(items)`（純粋関数）: 注目上位群を「`[project] issue_key / overdue Nd / risk R / stale` + 既存 ai_summary」の1〜2行に詰めて連結し `REPORT_CONTEXT_MAX_CHARS` で切り詰め。**新規 per-issue LLM 呼び出しゼロ**で既存 `ai_results` を再利用（NFR-V045-002）
  - `generate_report_narrative(app, context, lang, report_type) -> (headline, narrative)`: `summarize_solutions` と同様 **sidecar 改修なしで既存 `analyze` 経路を流用**。context を `AiAnalysisInput.description_head` に、`report_type`/`lang` 別の指示文を `summary` に載せ `create_backend`（FoundationModels 再利用）→`infer`。`output.summary`→headline（見出し1行）/ `output.suggestion`→narrative（注目点）にマップ。context 空・AI 非対応・生成失敗は `Err` にせず空タプル `(String::new(), String::new())` へ degrade（NFR-V045-003）
- **ステータス**: ✅ 実装済み（cargo build / clippy `--all-targets -D warnings` / 単体テスト通過。v0.3 の AI コマンド5種に加え、v0.4 の類似検索・解決策要約コマンド4種を追加・`lib.rs` の invoke_handler に登録。`rank_similar`/`project_key_from_issue_key`/`build_solution_context` の単体テスト10件。v0.4.5 でレポート生成コア（定数4 / `ReportType` / `ReportHighlightInput` / `report_highlight_score` / `select_report_highlights` / `build_report_context` / `generate_report_narrative`）と期間キーヘルパー（`iso_week_key`/`iso_week_bounds`/`month_key`/`month_bounds`/`date_to_utc_midnight`）・生成コマンド3種（`generate_reports`/`get_reports`/`list_report_periods`）を追加し `lib.rs` に登録。重み付け・N件クランプ・超過60日クランプ・context 包含/文字数上限・空入力に加え、ISO 週番号/年境界(2027-01-01→2026-W53)/週月境界(月曜〜翌月曜・当月1日〜翌月1日・12月の年繰り上げ)の単体テストで commands::tests 22件。さらに v0.4.5 課題背景要約コマンド `get_background_summary`（定数 `BACKGROUND_SUMMARY_COMMENTS_MAX_CHARS = 2000`・コメント `source_hash` キャッシュ付き）を追加し `lib.rs` に登録（`compute_source_hash` は埋め込みと共用するため `pub(crate)` 化済み）。v0.4.5 スケジューラ結線（FR-V045-005）に向けて `generate_reports` の生成コアを `pub(crate) generate_report(&app, &db, …)` へ抽出し、`CROSS_SUMMARY_REGEN_HOURS`・`iso_week_key`・`month_key` を `pub(crate)` 化して `scheduler::generate_due_reports` から共有（コマンドと自動生成が同一経路）。1日1回バックグラウンド自動生成の判定・実行は `scheduler.rs` 側に実装済み）

### `src-tauri/src/db.rs`

- **役割**: データベースクライアント
- **主な構造体**:
  - `WorkspaceInput`: `save_workspace()` に渡すワークスペース各カラムの値をまとめた入力構造体
  - `AiResult`: `ai_results` テーブル1行に対応するAI分析結果（要約・リスクレベル・遅延日数・対応提案など。v0.3）
  - `AiJob`: `job_queue` テーブル1行に対応するAIジョブ（v0.3）
  - `Comment`（v0.4 新設）: コメント1件。`issue_comments` テーブル1行（`sqlx::FromRow`）と Backlog API レスポンスのデシリアライズを **共有**（DRY）。`comment_id`（API の `id`）/ `content` / `created_at`（API の `created` を serde `alias` で取り込む）/ `created_user`（API の `createdUser`。任意・`#[sqlx(default)]` で DB 読み出し時は `None`）。`backlog::get_comments` の戻り値型・`save_comments` の入力型・差分取得・埋め込み入力で使用
  - `IssueSearchMeta`（v0.4 新設）: 類似検索の結果表示用メタ情報（`issue_key`/`summary`/`status`/`assignee`/`is_corpus_only`）。`issues` テーブルの個別カラム（`save_issues` で名称展開済み）から取得し raw_data デシリアライズを避ける（NFR-V04-002）。`get_issue_search_meta` の戻り値要素
  - `ReportSummary`（v0.4.5 新設）: `report_summaries` テーブル1行。横断サマリ・週次/月次レポートの統計 JSON・AI narrative・見出しを保持。`report_type`('cross_summary'/'weekly'/'monthly') / `period_key`(横断='latest'・週次='YYYY-Www'・月次='YYYY-MM') / `lang` / `stats_json` / `headline` / `narrative` / `generated_at`
  - `IssueBackgroundSummary`（v0.4.5 新設）: `issue_background_summary` テーブル1行。課題1件あたりのコメント要約キャッシュ（FR-V045-004）。`workspace_id` / `issue_id` / `lang` / `summary_text` / `source_hash`（コメント変化検知用） / `generated_at`
  - `CrossSummaryStat`（v0.4.5 新設・FR-V045-002）: 横断サマリのプロジェクト別集計1行（`#[serde(rename_all = "camelCase")]`）。`projectKey` / `openCount`（未完了） / `overdueCount`（期限超過） / `staleCount`（停滞） / `myActionableCount`（自分担当の要対応） / `riskHigh` / `riskMedium` / `riskLow`（`ai_results` の risk 分布）。`get_cross_summary_stats` の戻り値要素であり、`report_summaries.stats_json` の配列形状を確定する基準（フロント型定義・後段生成コマンドが従う）
  - `PeriodActivityStat`（v0.4.5 新設・FR-V045-003）: 週次/月次アクティビティのプロジェクト別集計1行（`#[serde(rename_all = "camelCase")]`）。`projectKey` / `createdCount`（期間内作成） / `updatedCount`（期間内更新） / `completedCount`（期間内完了＝`is_corpus_only=1` かつ更新が期間内）。`get_period_activity_stats` の戻り値要素
- **主な定数・ヘルパー関数**:
  - `EMBEDDING_MODEL`（v0.4）: 埋め込みモデルの論理識別子 `"apple-nl-contextual-ja"`（OS 組み込み `NLContextualEmbedding`）。`issue_embeddings.model` に保存・再埋め込み判定に使用
  - `EMBEDDING_DIM`（v0.4）: 埋め込み次元数 `512`
  - `vector_to_blob(&[f32]) -> Vec<u8>` / `blob_to_vector(&[u8]) -> Vec<f32>`（v0.4）: f32 ベクトル ↔ リトルエンディアン BLOB の手実装変換（`bytemuck` 等の依存を増やさない。端数バイトは切り捨て）
- **主なテーブル**:
  - `settings` / `sync_state` / `workspaces` / `issues`（既存）
  - `ai_results`（v0.3 新設）: 課題単位のAI分析結果。PK は `(workspace_id, issue_id)`。`delay_days` は SQL 算出値を保存。**既存 `issues.ai_summary` カラムは ai_results 新設に伴い不使用**
  - `job_queue`（v0.3 新設）: バックグラウンドAI処理キュー（`status`: pending / processing / done / failed）
  - `issue_comments`（v0.4 新設）: コメント本文保存。PK は `(workspace_id, issue_id, comment_id)`。差分取得のコンテンツ保管専用
  - `issue_comment_state`（v0.4 新設）: コメント差分取得状態管理。PK は `(workspace_id, issue_id)`。`last_comment_id`（最終取得 ID）/ `status`（idle/fetching/done/failed）/ `retry_count` を保持
  - `issue_embeddings`（v0.4 新設）: `NLContextualEmbedding` 512次元ベクトルを BLOB 保存。PK は `(workspace_id, issue_id)`。`source_hash` でコンテンツ変更検知・再埋め込みトリガー
  - `issues.is_corpus_only`（v0.4 追加カラム）: `INTEGER DEFAULT 0`。完了課題コーパス行の分離フラグ。`1` の行は類似検索コーパスのみに使用し、`get_issues`（ダッシュボード・一覧）からは除外する
  - `issues.created_at`（v0.4.5 追加カラム）: `TEXT`（非破壊 ALTER）。Backlog API の `created`（課題作成日時）を `save_issues` で展開保存し、週次/月次レポートの「期間内新規作成件数」集計（FR-V045-003）に使う。旧 DB の既存行は再 sync まで NULL（集計は created_at の有無で範囲判定するため未取り込み行は新規作成件数に混入しない＝degrade）
  - `report_summaries`（v0.4.5 新設）: レポート/サマリー保存。PK は `(workspace_id, report_type, period_key, lang)`。`stats_json`（プロジェクト別集計 JSON）/ `headline`（AI 見出し）/ `narrative`（AI narrative）/ `generated_at`。横断サマリは `period_key='latest'` で最新上書き、週次/月次は期間キーで履歴保持（FR-V045-006）
  - `issue_background_summary`（v0.4.5 新設）: 課題背景・経緯の要約キャッシュ。PK は `(workspace_id, issue_id, lang)`。`summary_text`（AI 要約テキスト）/ `source_hash`（コメント変化検知）/ `generated_at`（FR-V045-004）
- **主な機能**:
  - SQLiteマイグレーション（IF NOT EXISTS / ALTER エラー無視のインクリメンタル方式。新テーブルも非破壊で追加）
  - 設定の保存・取得
  - 課題の保存・取得（`get_issues` は `ai_results` を `(workspace_id, issue_id)` で LEFT JOIN し、AI 結果を `Issue` の `ai_*` フィールドへ設定。AI 未生成は NULL→`None`。`is_corpus_only = 1` 行は除外。v0.3/v0.4）
  - `save_issues` のコーパス対応クリーンアップ（v0.4 / FR-V04-003）: バッチ全件が `is_corpus_only` なら「コーパスバッチ」とみなしプロジェクト単位の破壊的クリーンアップ（同期欠落課題削除・未選択プロジェクト削除）を**スキップ**（コーパス課題の保持・除去は `cleanup_corpus_out_of_range` が一元管理。通常 sync とコーパス sync は別バッチで呼ばれ、混在削除を防ぐ）。通常バッチのクリーンアップは `COALESCE(is_corpus_only,0)=0` で完了課題コーパスを削除対象から除外（取り込んだコーパスを通常 sync で消さない）。空バッチは通常バッチ扱い
  - プロジェクト選択解除時のクリーンアップ（v0.4 新テーブルの孤児掃除も含む）
  - ワークスペース保存（`save_workspace(input: WorkspaceInput)`）
  - ワークスペース使用状況の保存
  - 無効ワークスペースの課題削除（`delete_workspace_issues` も v0.4 / v0.4.5 新テーブルを掃除）
  - ワークスペース削除（`delete_workspace` も v0.4 / v0.4.5 新テーブルを掃除）
  - AIジョブキュー操作（v0.3）: `enqueue_jobs`（pending重複回避） / `get_pending_jobs(limit)` / `update_job_status` / `count_pending_jobs` / `count_processing_jobs`（処理中件数。設定画面のキュー状況表示用）
  - AI結果操作（v0.3）: `save_ai_result`（issue単位UPSERT） / `get_ai_result(workspace_id, issue_id)`
  - スケジュールリスク再計算（v0.4・FR-V04-006）: `recompute_schedule_risk()`（既保存 `ai_results` を **LLM 再実行なし**で再計算する起動時バッチ。各行で `issues.due_date` から最新の遅延日数を SQL 算出し、`final_risk = max(from_storage_str(保存済み risk_level), schedule_risk(delay_days))` を取り直して `risk_level` / `delay_days` を更新。`risk_level` も `delay_days` も無変更の行は UPDATE せず更新件数に数えない＝冪等。しきい値は `ai::schedule_risk` に集約し SQL へ複製しない。`lib.rs` の setup で `reset_stale_jobs` の直後に1回呼ぶ）
  - 遅延日数のSQL算出（v0.3）: `get_issue_delay_days(workspace_id, issue_id)`（julianday ベース。期限切れ判定は LLM ではなく SQL で確実に算出）
  - AI入力用フィールド取得（v0.3）: `get_issue_analysis_fields(workspace_id, issue_id, body_max_chars)`（ワーカーが `AiAnalysisInput` を組み立てるためのフィールド取得。本文は `substr` で SQL 側切り詰め・status/description は空文字正規化）
  - 埋め込み操作（v0.4）: `save_embedding(workspace_id, issue_id, model, dim, vector, source_hash)`（issue単位UPSERT・f32→BLOB） / `get_embedding(ws, id)`（BLOB→f32 復元） / `get_all_embeddings(workspace_id)`（類似検索の総当たり用。コーパス含む全件） / `get_embedding_source_hash(ws, id)`（再埋め込み判定。FR-V04-004） / `count_embeddings(Option<workspace_id>)`（進捗集計。`None` で全体）
  - 類似検索の進捗・メタ取得（v0.4・FR-V04-005）: `count_issues(workspace_id)`（コーパス含む全課題数=埋め込み対象件数の母数） / `get_embedding_status(workspace_id)`（`(target, built)` を返す。`count_issues` と `count_embeddings` の組） / `get_issue_search_meta(workspace_id, &[issue_id])`（上位N件の表示用メタを `HashMap<i64, IssueSearchMeta>` でまとめ取得。IN 句のプレースホルダを動的生成。空入力は DB アクセスせず空マップ）
  - コメント操作（v0.4）: `save_comments(ws, id, &[Comment])`（コメント単位UPSERT） / `get_comments_text(ws, id, max_chars)`（comment_id 昇順で改行連結・char 単位切り詰め。埋め込み入力用） / `get_comment_state(ws, id)`（`(last_comment_id, status, retry_count)`。未作成は `(None, "idle", 0)`） / `set_comment_state(ws, id, last_comment_id, status, retry_count)`（差分取得状態 UPSERT。FR-V04-002）
  - コーパス操作（v0.4）: `get_issue_embed_text(ws, id, body_max, comment_max)`（タイトル+本文+コメントを連結し source_hash 計算・埋め込み入力テキストを返す。本文は SQL 切り詰め・コメントは `get_comments_text` 再利用） / `cleanup_corpus_out_of_range(ws, oldest_updated)`（期間短縮時に範囲外コーパス課題と埋め込み・コメント・状態を連鎖削除。`is_corpus_only = 1` のみ対象。FR-V04-003） / `count_corpus_issues(ws)`（設定画面のコーパス件数表示） / `get_corpus_issue_ids(ws)`（v0.4。`is_corpus_only=1` の課題IDを列挙。埋め込み未構築時の初回コメント全件取得対象の特定に使用。FR-V04-002）
  - レポート/サマリー操作（v0.4.5・FR-V045-006/003）: `save_report_summary(ws, report_type, period_key, lang, stats_json, headline, narrative)`（`report_summaries` を `INSERT OR REPLACE` で UPSERT・`generated_at` は now 自動設定・横断は `period_key='latest'` で上書き／週次月次は期間キーで履歴保持。narrative=`None` の degrade 保存可） / `get_report_summary(ws, report_type, period_key, lang)`（`ReportSummary` を1行取得。未生成は `None`） / `list_report_periods(ws, report_type)`（DISTINCT な `period_key` を `MAX(generated_at)` 降順で返す期間セレクタ用。同一期間に複数言語があっても重複しない）
  - 課題背景要約キャッシュ操作（v0.4.5・FR-V045-004）: `save_background_summary(ws, issue_id, lang, summary_text, source_hash)`（`issue_background_summary` を UPSERT・`generated_at` は now 自動設定） / `get_background_summary(ws, issue_id, lang)`（`(summary_text, source_hash, generated_at)` を返す。NULL カラムは空文字へ正規化し呼び出し側を分岐させない。未生成は `None`。呼び出し側はコメントから再計算した `source_hash` と比較して再生成要否を判定）
  - レポート決定的集計（v0.4.5・FR-V045-002/003）: `get_cross_summary_stats(ws, me_user_id, stale_threshold_days)`（横断サマリ。通常課題（`is_corpus_only=0`）をプロジェクト別に集計し `Vec<CrossSummaryStat>` を返す。期限超過＝`due_date < 今日`・停滞＝`updated_at` が `stale_threshold_days` 日以上前・自分担当の要対応＝担当者が `me_user_id`（raw_data の `assignee.id` を `json_extract`）かつ期限超過 or 停滞・risk 分布は `ai_results` を LEFT JOIN。日付判定は `julianday(substr(...,1,10))` で統一。プロジェクトキー導出は SQL では難しいため課題1行のフラグを SQL 算出→Rust で `commands::project_key_from_issue_key` 相当により集約） / `get_period_activity_stats(ws, period_start, period_end)`（週次/月次。半開区間 `[start, end)` の文字列辞書順比較で作成/更新/完了を判定し `Vec<PeriodActivityStat>` を返す。完了は `is_corpus_only=1` かつ更新が期間内・期間内アクティビティが無い課題は行を返さない） / `get_report_highlight_inputs(ws, stale_threshold_days)`（注目上位選定用。通常課題（`is_corpus_only=0`）の `(issue_key, ai_summary, risk_level, delay_days, is_stale)` を1クエリで返す。`ai_results` を LEFT JOIN し既存 `summary`/`risk_level` を再利用＝**新規 LLM 呼び出しゼロ**・遅延日数は `get_issue_delay_days` と同じ julianday 差を Rust 側で符号反転・停滞は `get_cross_summary_stats` と同じ julianday 比較。`commands::collect_report_highlight_inputs` が `ReportHighlightInput` へ変換）。停滞しきい値・期間境界は呼び出し側（scheduler/commands の定数）で決め、メソッドは引数で受ける
- **テスト**: `#[cfg(test)] mod tests`（v0.4 新設）。in-memory SQLite（`sqlite::memory:`）でマイグレーション→各CRUDのラウンドトリップを検証（ベクトル一致・source_hash スキップ判定・コメント連結/切り詰め・コーパス連鎖削除・`save_issues` のコーパス保持/通常・コーパス分離クリーンアップ・`recompute_schedule_risk` の 469日超過課題が high へ昇格＋猶予課題は据え置き＋冪等性・v0.4.5 のレポート保存/取得/上書き＋camelCase シリアライズ・`list_report_periods` の生成日時降順/DISTINCT・背景要約の保存/取得/上書き/言語別キャッシュ・v0.4.5 集計 `get_cross_summary_stats` の期限超過/停滞境界(更新-14日ちょうどは停滞・-13日は非停滞)/自分担当の要対応/risk 分布/コーパス除外/`me_user_id=None`・`get_period_activity_stats` の作成/更新/完了の半開区間境界(開始境界は含む・終了境界は含まない)/created_at NULL の degrade/期間外は空 など）
- **ステータス**: ✅ 実装済み（v0.4 DBスキーマ拡張＋スケジューラ結線対応完了。v0.4.5 で `report_summaries` / `issue_background_summary` テーブル新設・`ReportSummary`（`#[serde(rename_all = "camelCase")]`） / `IssueBackgroundSummary` 構造体追加・`delete_workspace` / `delete_workspace_issues` / `save_issues` の孤児掃除に両テーブルを追加・レポート/背景要約の CRUD メソッド5件（`save_report_summary` / `get_report_summary` / `list_report_periods` / `save_background_summary` / `get_background_summary`）を追加。さらに決定的集計メソッド2件（`get_cross_summary_stats` / `get_period_activity_stats`）と集計結果構造体 `CrossSummaryStat` / `PeriodActivityStat`（serde camelCase）を追加・`issues.created_at` カラム（非破壊 ALTER）と `save_issues` への `created_at` 展開・`Issue.created`（backlog.rs）取り込み・`commands::project_key_from_issue_key` を `pub(crate)` 化。`cargo build` / `clippy -D warnings` / `fmt --check` / 単体テスト 88件通過）

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
  - 完了課題コーパス取り込み・コメント差分取得・埋め込みジョブ投入（v0.4 / FR-V04-002・003・004）: 通常sync 直後にバックグラウンドで実行し sync・UI を阻害しない。失敗は本体を止めない（NFR-V04-002 / NFR-V04-005）
  - レポート/サマリーの1日1回バックグラウンド自動生成（v0.4.5 / FR-V045-005）: 通常sync のワークスペースループ直後に実行する独立ブロック（トレイ更新の前）。AI ON（`settings.ai_enabled == "true"`）かつ可用性ありのときだけ、横断サマリ=経過時間（`CROSS_SUMMARY_REGEN_HOURS`≈20h）、週次/月次=現在の期間キーが未生成（ロールオーバ）を判定して生成。`job_queue` を介さず `commands::generate_report`（内部で `create_backend`→`infer`）を直接呼ぶ。AI OFF・可用性なしはアイドル（生成しない）。失敗は本体（通常 sync）を止めない（NFR-V045-003）
- **主な定数**: `SETTING_CORPUS_MONTHS`（`corpus_months`。完了課題コーパス取り込み期間の設定キー） / `DEFAULT_CORPUS_MONTHS`（既定 6ヶ月。未解決事項#3 既定値） / `RATE_LIMIT_BACKOFF_THRESHOLD`（残量 ≤50 で追加取得をバックオフ） / `MAX_CORPUS_PAGES`（1サイクル20ページ上限） / `MAX_COMMENT_FETCH_PER_CYCLE`（1サイクル100課題上限） / `MAX_COMMENT_RETRIES`（コメント取得リトライ上限=3） / `SETTING_LANGUAGE`（`language`。レポート出力言語の設定キー。AI ワーカーと同一）+ `DEFAULT_REPORT_LANG`（既定 `ja`）/ `REPORT_TYPE_CROSS_SUMMARY`・`REPORT_TYPE_WEEKLY`・`REPORT_TYPE_MONTHLY`（生成対象種別）/ `CROSS_SUMMARY_PERIOD_KEY`（横断サマリの固定期間キー `latest`）
- **主な関数**:
  - `enqueue_changed_issues(db, workspace_id, issues, existing_updated_map)`（`pub(crate)`）: 新規・更新分のみ `enqueue_jobs` で `summarize` 投入する差分検出ヘルパー。scheduler・commands(`fetch_issues`) 両経路で共通利用。投入失敗は非阻害（ログのみ）
  - `changed_issue_ids(workspace_id, issues, existing_updated_map)`: 差分検出の純粋ロジック（同期前スナップショットの `updated` と突き合わせ、新規＝マップ未登録・更新＝`updated` 変化を抽出）。要約ジョブ投入とコメント差分取得・embed 投入で共通利用
  - `sync_corpus_and_embeddings(db, client, workspace_id, project_keys, issues, existing_updated_map, rate_remaining)`（`pub(crate)`・v0.4）: コーパス取り込み→（初回のみ）コーパス全件コメント取得→変更課題のコメント差分取得＋embed 投入を行うバックグラウンド処理の入口。レート残量が `RATE_LIMIT_BACKOFF_THRESHOLD` 以下ならバックオフして次サイクルへ繰り越す。scheduler・commands(`fetch_issues`) 両経路で共通利用
  - `fetch_corpus(...)`: `get_closed_issues` を offset ページング（最大 `MAX_CORPUS_PAGES`）で取得し `is_corpus_only=true` の課題を `save_issues`（コーパスバッチ＝破壊的クリーンアップなし）で保存
  - `fetch_comments_and_enqueue_embed(...)`: 課題ごとに `get_comment_state` の `minId`・retry_count を読み、`get_comments(min_id)` で新規コメントのみ取得→`save_comments`＋`set_comment_state`（最大コメントIDを次回起点に）。失敗は `retry_count++`／`status="failed"` で記録、上限到達でコメント取得はスキップ。最後に `JOB_TYPE_EMBED` を `enqueue_jobs` で投入（`summarize` と並行）
  - `resolve_corpus_months(db)` / `corpus_updated_since(months)`（`yyyy-MM-dd`）/ `corpus_oldest_updated(months)`（RFC3339）/ `is_rate_backoff(remaining)`: 設定解決・期間境界算出・バックオフ判定の純粋/補助ヘルパー
  - `generate_due_reports(app, db)`（v0.4.5 / FR-V045-005）: レポート自動生成の入口。AI OFF・可用性なしは即 return（アイドル）。有効ワークスペースごとに横断/週次/月次の生成要否を判定し `generate_report_quietly` を呼ぶ。`lang` は `resolve_report_lang`、現在の週/月キーは `commands::iso_week_key`/`month_key` で1回算出して使い回す
  - `is_ai_enabled(db)`（`settings.ai_enabled == "true"`。AI ワーカーと同一キー・既定 OFF）/ `resolve_report_lang(db)`（`settings.language`・既定 `ja`）/ `ai_is_available(app)`（FoundationModels バックエンドを一時生成し `availability == available` を判定）: 自動生成のゲート
  - `cross_summary_is_due(db, ws, lang)`: 横断サマリ再生成要否。`report_summaries.cross_summary/latest` の `generated_at`（RFC3339）と現在時刻の差が `commands::CROSS_SUMMARY_REGEN_HOURS`（20h）以上なら `true`。未生成・`generated_at` 欠落・パース失敗はすべて `true`（取りこぼし防止）
  - `period_report_is_due(db, ws, report_type, period_key, lang)`: 週次/月次のロールオーバ判定。現在の期間キーで `get_report_summary` が `None`（未生成）なら `true`。取得失敗も `true`
  - `generate_report_quietly(app, db, ws, report_type, lang)`: `commands::generate_report` を呼び成否をログに出す非阻害ラッパー（`generate_report` 自体が AI 非対応・narrative 失敗を degrade で `Ok` 返しするため `Err` は未知種別・DB エラーのみ）
- **初回ビルド判定**: `count_embeddings(Some(workspace_id)) == 0` を「埋め込み未構築」とみなし、コーパス全課題に1回だけコメント全件取得＋embed 投入する
- **テスト**: `is_rate_backoff`（閾値境界）/ `changed_issue_ids`（新規・更新のみ抽出）/ `corpus_updated_since`（日付書式）/ `resolve_corpus_months`（既定・クランプ・パース失敗）に加え、v0.4.5 で `is_ai_enabled`（`"true"` のときだけ有効）/ `resolve_report_lang`（既定 `ja`・設定追従）/ `cross_summary_is_due`（未生成→true・生成直後→false）/ `period_report_is_due`（未生成→true・生成済み→false）の計8テスト（`#[cfg(test)]`、in-memory SQLite）
- **ステータス**: ✅ 実装済み（v0.4 でコーパス取り込み・コメント差分取得・embed 投入を結線。v0.4.5 でレポート/サマリーの1日1回バックグラウンド自動生成（FR-V045-005）を結線。`cargo build` / `clippy --all-targets -D warnings` / `fmt --check` / 単体テスト（scheduler::tests 8件）通過。AI ON 環境での横断/週次/月次の実際の自動生成、AI OFF でのアイドルは実機ログでの確認が残る）

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
- 2026-06-13: v0.4 DBスキーマ拡張(db.rs)。新テーブル3件追加: `issue_comments`（コメント本文保存）/ `issue_comment_state`（差分取得状態管理）/ `issue_embeddings`（384次元 BLOB ベクトル保存・source_hash 付き）。`issues` に `is_corpus_only INTEGER DEFAULT 0` カラム追加（完了課題コーパス分離用）。`delete_workspace` / `delete_workspace_issues` / `save_issues` の孤児掃除に新テーブルを追加。`get_issues` に `is_corpus_only = 0` フィルタを追加しコーパス行をダッシュボード・一覧から除外。`cargo clippy -D warnings` 通過
- 2026-06-13: v0.4 埋め込み抽象基盤(ai/embedding.rs を新設・FR-V04-001)。`LlmInference` とは別経路の埋め込み API として `EmbeddingBackend` trait（`embed` / `dim` / `model_name`）・`EmbeddingInput` / `EmbeddingOutput` 型・`EmbedPrefix` enum（e5 の `query:` / `passage:` 非対称プレフィックス）・`EmbeddingBackendKind` enum・`create_embedding_backend` レジストリ入口・`build_embed_source`（単一ベクトル方式の結合＋文字数切り詰め）・`EMBEDDING_DIM`(384) / `EMBED_SOURCE_MAX_CHARS`(1800) 定数を追加。512トークン対策は単一ベクトル方式を既定採用（コメントに方針明記）。`create_embedding_backend` は骨格のため `unimplemented!()`（sidecar 連携は後続項目）。ai/mod.rs に `pub mod embedding` を追加。`cargo build` / `clippy -D warnings` / 単体テスト 8件 通過
- 2026-06-13: v0.4 埋め込みバックエンド本体(ai/foundation_models.rs・ai/embedding.rs・FR-V04-001)。`FoundationModelsBackend` に `EmbeddingBackend` を実装し、analyze と同一 sidecar・同一管理タスクで `embed` を扱う方針を採用。`SidecarRequest` に `Embed{texts, prefix}`・`SidecarResponse` に `Embedding{vectors}` バリアント、`ManagerCommand::Embed`・`ExpectedResponse::Embedding`・`parse_embedding`（件数=要求texts数・次元=`EMBEDDING_DIM` を検証）・`embed_internal`（一時停止チェック→MPSC→oneshot）を追加。`EMBEDDING_MODEL_NAME`(`multilingual-e5-small`) 定数を追加し `model_name()` で返す（`issue_embeddings.model` 記録・再埋め込み判定用。バックエンド名とは別）。`create_embedding_backend` の `MultilingualE5Small` アームを `unimplemented!()` から `FoundationModelsBackend::new(app)` へ差し替え（`NoopEmbeddingBackend` 削除）。可用性は `check_availability` 流用・非対応環境では `embed` が `Err` を返し検索のみ degrade（NFR-V04-005）。モック transport で embed のベクトル応答・再起動・連続失敗での Suspended・件数/次元不一致・error 応答・analyze と embed の sidecar 共用を検証する単体テスト9件を追加（foundation_models 計16件）。`cargo build` / `clippy -D warnings` / `cargo fmt --check` / 単体テスト 通過
- 2026-06-13: v0.4 DB CRUD 拡張(db.rs)。埋め込み・コメント・コーパスの CRUD メソッドと `Comment` 構造体・`EMBEDDING_MODEL`/`EMBEDDING_DIM` 定数・`vector_to_blob`/`blob_to_vector`(f32↔リトルエンディアン BLOB 手実装) を追加。埋め込み系: `save_embedding`(UPSERT) / `get_embedding` / `get_all_embeddings`(コーパス含む総当たり用) / `get_embedding_source_hash`(再埋め込み判定 FR-V04-004) / `count_embeddings(Option<ws>)`。コメント系: `save_comments` / `get_comments_text`(comment_id 昇順連結・切り詰め) / `get_comment_state`(未作成は `(None,"idle",0)`) / `set_comment_state`(UPSERT FR-V04-002)。コーパス系: `get_issue_embed_text`(タイトル+本文+コメント連結・source_hash 計算用) / `cleanup_corpus_out_of_range`(期間短縮時に範囲外コーパスと関連データを連鎖削除 FR-V04-003) / `count_corpus_issues`。`#[cfg(test)] mod tests` を新設し in-memory SQLite でラウンドトリップ8件を検証(ベクトル一致・source_hash スキップ判定・コメント連結/切り詰め・コーパス連鎖削除)。`cargo test` / `clippy -D warnings` / `fmt --check` 通過
- 2026-06-13: v0.4 コメント差分取得・完了課題コーパス取得(backlog.rs・db.rs・FR-V04-002/003)。`BacklogClient` に `get_comments(issue_id_or_key, min_id)`(`GET /issues/:id/comments` を `minId`/`order=asc`/`count=100` で呼び `(Vec<db::Comment>, RateLimitInfo)` を返す) / `get_closed_issues(project, updated_since, offset)`(`statusId[]=4`+`updatedSince`+`count=100`+`offset` で完了課題をページング取得し各 Issue に `is_corpus_only=true` を設定) を追加。クエリ組み立てを純粋関数 `build_comments_query`/`build_closed_issues_query` に分離しテスト可能化。`Issue` に `is_corpus_only: bool`(`#[serde(skip_deserializing, default)]`) を追加し `save_issues` の INSERT に `is_corpus_only` カラムを追加。`db::Comment` を API デシリアライズ兼 DB 行の共有型に拡張(serde `alias="created"` で投稿日時取り込み・`created_user: Option<User>` を `createdUser`/`#[sqlx(default)]` で追加)。backlog.rs に `#[cfg(test)] mod tests` を新設しクエリ組み立て(minId 付与・statusId[]=4・updatedSince・offset)とコメント/完了課題のデシリアライズを検証する単体テスト6件を追加。`cargo build` / `clippy -D warnings` / `fmt --check` / 単体テスト(計46件) 通過
- 2026-06-13: v0.4 スケジューラ結線(scheduler.rs・commands.rs・db.rs・ai/worker.rs・FR-V04-002/003/004)。`worker.rs` に `JOB_TYPE_EMBED`(`embed`) 定数を追加。`scheduler.rs` に `sync_corpus_and_embeddings`(`pub(crate)`) を新設し通常sync 直後にコーパス取り込み→(初回のみ)コーパス全件コメント取得→変更課題コメント差分取得＋embed 投入を実行。`fetch_corpus`(`get_closed_issues` を offset ページング・`is_corpus_only=true` でコーパスバッチ保存) / `fetch_comments_and_enqueue_embed`(課題ごとに `get_comment_state` の minId・retry を読み `get_comments(min_id)` で新規コメントのみ取得→`save_comments`＋`set_comment_state`、失敗は retry_count++/`failed` 記録・上限到達でスキップ、最後に `JOB_TYPE_EMBED` を投入) を追加。差分検出を `changed_issue_ids` に共通化(`enqueue_changed_issues` と共有)。設定キー `SETTING_CORPUS_MONTHS`(`corpus_months`・既定6ヶ月) と `resolve_corpus_months`(1〜24 クランプ)・`corpus_updated_since`(yyyy-MM-dd)・`corpus_oldest_updated`(RFC3339)・`is_rate_backoff`(残量≤`RATE_LIMIT_BACKOFF_THRESHOLD`=50 でバックオフ) を追加。初回ビルド判定は `count_embeddings==0`。`db.save_issues` をコーパス対応に改修(コーパスバッチは破壊的クリーンアップをスキップ・通常バッチは `COALESCE(is_corpus_only,0)=0` でコーパス行を削除対象から除外)。`db.rs` に `get_corpus_issue_ids` を追加(初回コメント全件取得対象の特定)。`commands.rs::fetch_issues` 末尾でも同関数を呼び手動sync経路でも実行(`last_remaining` を取得しバックオフ判定)。scheduler.rs に単体テスト4件(バックオフ閾値・差分抽出・コーパス日付書式・期間設定クランプ)・db.rs に `save_issues` コーパス保持/分離クリーンアップのテスト1件を追加。`cargo build` / `clippy -D warnings` / `fmt --check` / 単体テスト(計51件) 通過
- 2026-06-13: v0.4 類似検索(ai/cosine.rs・commands.rs・db.rs・backlog.rs・lib.rs・FR-V04-004/005)。`ai/cosine.rs` を新設し純粋関数 `cosine_similarity(&[f32],&[f32])->f32`(内積・ノルム1パス・ゼロベクトル/次元不一致で `NaN` でなく `0.0`)・単体テスト7件を追加(`ai/mod.rs` に `pub mod cosine`)。`commands.rs` に `search_similar_issues(workspace_id, issue_id, limit?)`(クエリ埋め込み取得→`get_all_embeddings`(コーパス含む全件1回ロード)と総当たり→自身除外→しきい値 `SIMILARITY_THRESHOLD=0.80`→降順→上位 `DEFAULT_SIMILAR_LIMIT=10`。未構築時は空リストで degrade。`SimilarIssue`(camelCase) を返す) / `get_embedding_status(workspace_id)`(`(target, built)`) / `get_closed_issues_corpus_count(workspace_id)` を追加。中核ランキングを純粋関数 `rank_similar` に分離し `project_key_from_issue_key`(issue_key プレフィックス導出) とあわせ単体テスト5件を追加。`db.rs` に `IssueSearchMeta` 構造体・`count_issues`・`get_embedding_status`・`get_issue_search_meta`(IN 句動的プレースホルダ・空入力は早期 return) を追加し、`get_issues` の SELECT に `issue_embeddings` LEFT JOIN を足して `embedding_ready`(FR-V04-005) を `Issue` に載せる。`backlog::Issue` に `embedding_ready: bool`(`#[serde(default)]`) を追加。`lib.rs` invoke_handler に3コマンドを登録。db.rs に進捗・メタ・embedding_ready のテスト3件を追加。`cargo build` / `clippy --all-targets -D warnings` / 単体テスト(計70件) 通過
- 2026-06-13: v0.4.5 DBスキーマ拡張(db.rs・FR-V045-006/004)。`report_summaries` テーブル新設（PK=(workspace_id, report_type, period_key, lang)・stats_json/headline/narrative/generated_at）/ `issue_background_summary` テーブル新設（PK=(workspace_id, issue_id, lang)・summary_text/source_hash/generated_at）。`ReportSummary` / `IssueBackgroundSummary` 構造体を追加。孤児掃除を3経路に追加: `delete_workspace` トランザクションに両テーブルの DELETE、`delete_workspace_issues` に同様、`save_issues` 末尾の孤児掃除ブロックに `issue_background_summary`（report_summaries はワークスペース粒度のため save_issues では触らない）。`cargo build` / 単体テスト 81件通過
- 2026-06-13: v0.4 解決策要約コマンド(commands.rs・lib.rs・useSimilarSearch.ts・FR-V04-005)。`commands.rs` に `summarize_solutions(workspace_id, issue_ids, lang)` を追加。類似上位群の本文・コメント・コーパス種別を `get_issue_analysis_fields`/`get_comments_text`/`get_issue_search_meta` で集め、純粋関数 `build_solution_context`(完了課題=コーパス優先で並べ替え→`SUMMARIZE_MAX_ISSUES=5` 件→課題ごとに見出し付き連結→`SUMMARIZE_CONTEXT_MAX_CHARS=3000` 文字で切り詰め)で1本の context に結合。設計判断: **sidecar は改修せず既存 `analyze` 経路を流用**(新 `summarize_text` 経路は Swift sidecar の改修・再配布を要するため見送り)。context を `AiAnalysisInput.description_head` に載せ `create_backend`(FoundationModels 再利用)→`infer` を呼び、`suggestion`(対応提案=解決策要点)に `summary`(補足1行)を添えて返す。AI 非対応・生成失敗・対象なしは `Err` にせず空文字へ degrade(NFR-V04-005)。`lib.rs` invoke_handler に登録。フロント `useSimilarSearch.ts` の `summarizeResults` を `lang`/`workspaceId` 引数に合わせて更新。`build_solution_context` の単体テスト5件(コーパス優先・件数切り詰め・全要素包含・文字数上限・空入力)を追加。`cargo build` / `clippy --all-targets -D warnings` / `fmt --check` / 単体テスト(計81件) / eslint / prettier 通過
- 2026-06-13: v0.4 遅延日数のリスク織り込み(ai/mod.rs・ai/worker.rs・db.rs・lib.rs・FR-V04-006)。`ai/mod.rs` に決定的ヘルパー `schedule_risk(Option<i64>)->RiskLevel`(>14日=High / 1〜14日=Medium / 当日〜3日以内=Medium / それ以外=Low)を追加し、`RiskLevel` に `Ord`(Low<Medium<High に宣言順を入れ替え)・`as_storage_str()`/`from_storage_str()` を導入。`worker.rs::process_job` で `final_risk = max(llm_risk, schedule_risk(delay_days))` を算出して `ai_results.risk_level` に保存(従来の `risk_level_to_str` を `RiskLevel::as_storage_str` へ統合)。`db.rs` に `recompute_schedule_risk()`(既保存 `ai_results` を LLM 再実行なしで再計算する起動時バッチ。`issues.due_date` から遅延日数を SQL 算出し `max` を取り直して `risk_level`/`delay_days` を UPDATE・無変更行はスキップで冪等)を追加し、`lib.rs` setup の `reset_stale_jobs` 直後に1回呼ぶ。`ai/mod.rs` に `schedule_risk` しきい値(14/13/0/-5日)・`max` 合成・`Ord`・保存文字列往復のテスト4件、`db.rs` に 469日超過課題が high へ昇格＋猶予課題据え置き＋冪等性のテスト2件を追加。`cargo build` / `clippy -D warnings` / `fmt --check` / 単体テスト(計76件) 通過
- 2026-06-13: v0.4 類似検索 UI + 「類似を探す」ボタン結線(IssueSimilarResults.vue・IssueSimilarDialog.vue・IssueCard.vue・IssueDetailDialog.vue・index.vue・issues.vue・useSimilarSearch.ts・locales/{ja,en}.json・FR-V04-005)。`IssueSimilarResults.vue` を新設(状態を持たないプレゼンテーション専用。類似上位 N 件の一覧=プロジェクトキーチップ・課題キー・サマリ・ステータス・担当者・類似度チップ・完了バッジ、行クリックで `open-in-browser`、FoundationModels 解決策要約セクションは `mdi-creation`+`ai.settings.generated`+`ai-text-box` を IssueAiAnalysis から踏襲、degrade 理由=構築待ち/AI 非対応/検索失敗を `v-alert` で提示)。`IssueSimilarDialog.vue` を新設し `useSimilarSearch` のグローバルステートを `v-dialog`+`IssueSimilarResults` に束ね、`index.vue`/`issues.vue` のページレベルに1回だけマウント。`IssueCard.vue` にスコアバッジ右へ「類似を探す」ボタン(`mdi-magnify-scan`・`@click.stop`)、`IssueDetailDialog.vue` のアクション行に同ボタン(詳細を閉じてから開きダイアログ重なりを回避)を追加し双方 `useSimilarSearch().openSimilar(issue)` を呼ぶ。`useSimilarSearch.ts` に `openInBrowser(item)` アクション(`get_workspace_by_id`→Backlog URL→`@tauri-apps/plugin-shell` `open`)を追加し export。`locales/{ja,en}.json` に `similar.*`(title/searchButton/queryLabel/searching/resultsCount/noResults/similarityValue/completedBadge/solutionTitle/summarizing/noSummary/degraded.{aiUnavailable,embeddingNotReady,searchFailed})を日英で追加。`pnpm run lint`(0 errors)/`pnpm run format:check`/`pnpm run generate`(ビルド成功・全6ルート prerender) 通過
- 2026-06-13: v0.4 ドキュメント同期(COMPONENTS.md・ARCHITECTURE.md)。COMPONENTS.md は IssueSimilarResults.vue・IssueSimilarDialog.vue・useSimilarSearch.ts・AiSettingsCard.vue(コーパス設定セクション)・useAiSettings.ts(コーパス/埋め込み進捗)・useIssues.ts(embedding_ready)・ai/embedding.rs・ai/embed_worker.rs・ai/cosine.rs・sidecar(embed プロトコル拡張)・db.rs(新テーブル4件)・commands.rs(v0.4 コマンド5種)・scheduler.rs(v0.4 拡張)の各エントリを v0.4 実装に合わせて記載済み。ARCHITECTURE.md のバックエンドモジュール一覧に ai/embedding.rs(埋め込み抽象)・ai/embed_worker.rs(埋め込みジョブ処理)・ai/cosine.rs(類似度計算)を単一責任記述で追加し、プロジェクト構成ツリーを更新
- 2026-06-13: v0.4.5 レポート/背景要約の DB CRUD(db.rs・FR-V045-006/003/004)。`db.rs` に公開メソッド5件を追加。レポート: `save_report_summary(ws, report_type, period_key, lang, stats_json, headline, narrative)`(`INSERT OR REPLACE` の UPSERT・`generated_at` は now 自動設定・横断は `latest` 上書き／週次月次は期間キーで履歴保持・narrative=`None` の degrade 保存可。PK4列+保存3列で引数8のため `#[allow(clippy::too_many_arguments)]` を付与=scheduler.rs に前例あり) / `get_report_summary(...)`(`ReportSummary` を1行取得・未生成は `None`) / `list_report_periods(ws, report_type)`(DISTINCT `period_key` を `MAX(generated_at)` 降順で返す期間セレクタ用)。背景要約: `save_background_summary(ws, issue_id, lang, summary_text, source_hash)`(UPSERT) / `get_background_summary(ws, issue_id, lang)`(`(summary_text, source_hash, generated_at)` を返し NULL は空文字正規化・未生成は `None`)。`ReportSummary` に `#[serde(rename_all = "camelCase")]` を付与しフロント連携用に camelCase シリアライズ。`#[cfg(test)] mod tests` に round-trip テスト3件追加(レポート保存/取得/上書き+別言語別期間独立+camelCase 検証、`list_report_periods` の生成日時降順/DISTINCT/別ws別種別の分離、背景要約の保存/取得/上書き/言語別キャッシュ/未生成 None)。`cargo build` / `clippy --all-targets -D warnings` / `fmt --check` / 単体テスト(db::tests 17件・計84件) 通過
- 2026-06-13: v0.4.5 レポート生成コマンド(commands.rs・db.rs・lib.rs・FR-V045-002/003/006)。`commands.rs` に Tauri コマンド3件を追加し `lib.rs` invoke_handler に登録。`generate_reports(app, workspace_id, report_type, lang) -> ReportSummary`(report_type 別に SQL 決定的集計→`stats_json`(横断=`get_cross_summary_stats`→`Vec<CrossSummaryStat>`／週次月次=現在期間境界で `get_period_activity_stats`→`Vec<PeriodActivityStat>`)→注目上位 N 件から `generate_report_narrative`→`save_report_summary` UPSERT→`get_report_summary` 読み戻し。横断は `period_key='latest'`・週次/月次は現在の期間キー。`me_user_id` は `get_workspaces` から解決。AI 非対応・narrative 失敗は `Err` にせず統計のみ保存で degrade・未知 report_type のみ `Err`) / `get_reports(...) -> Option<ReportSummary>`(`get_report_summary` ラッパー) / `list_report_periods(ws, report_type) -> Vec<String>`(`list_report_periods`(db) ラッパー)。期間キーは純粋関数 `iso_week_key`/`month_key`、期間境界は `iso_week_bounds`/`month_bounds`/`date_to_utc_midnight` で算出(**`strftime` ではなく chrono の `Datelike::iso_week`** で ISO 週番号を確実に得る)。注目入力収集 `collect_report_highlight_inputs` は新規 DB メソッド `get_report_highlight_inputs(ws, stale_threshold_days)`(通常課題の `(issue_key, ai_summary, risk_level, delay_days, is_stale)` を `ai_results` LEFT JOIN で1クエリ取得=新規 LLM 呼び出しゼロ)を `ReportHighlightInput` へ変換。レポート生成コア(`ReportType`/`ReportHighlightInput`/`report_highlight_score`/`select_report_highlights`/`build_report_context`/`generate_report_narrative`)と DB の集計/CRUD メソッドから `#[allow(dead_code)]` を解除(`CROSS_SUMMARY_REGEN_HOURS` のみスケジューラ未結線で残置)。期間キーヘルパーの単体テスト5件(ISO 週番号・2027-01-01→2026-W53 の年境界・月曜〜翌月曜・当月1日〜翌月1日・12月の年繰り上げ)を追加。`cargo build` / `clippy -D warnings` / 単体テスト(commands::tests 22件・計100件) 通過
- 2026-06-14: v0.4.5 課題背景要約コマンド(commands.rs・db.rs・lib.rs・FR-V045-004)。`commands.rs` に Tauri コマンド `get_background_summary(app, workspace_id, issue_id, lang) -> String` を追加し `lib.rs` invoke_handler に登録。処理: `get_comments_text`(comment_id 昇順=時系列順・新定数 `BACKGROUND_SUMMARY_COMMENTS_MAX_CHARS=2000` で先頭優先に切り詰め)でコメント本文取得→空なら LLM を起こさず空文字(UI が「コメントなし」表示)→`crate::ai::embed_worker::compute_source_hash`(埋め込みと同一 SipHash を再利用)でハッシュ算出→`get_background_summary`(db) の保存済みハッシュと一致すれば**キャッシュ即返し**(LLM/sidecar を起こさない)→不一致 or 未生成のみ `summarize_solutions` と同方式(**sidecar 改修なしで既存 `analyze` 経路流用**・`create_backend` FoundationModels 再利用→`infer`・`suggestion`=要点に `summary`=補足1行を結合)で生成し `save_background_summary`(db) でキャッシュ保存して返す。AI 非対応・生成失敗は `Err` にせず空文字へ degrade(NFR-V045-003)・空生成はキャッシュせず次回再試行可・DB エラーのみ `Err`。`db.rs` の `get_background_summary`/`save_background_summary` から `#[allow(dead_code)]` を解除(本コマンドから使用)。`compute_source_hash` は v0.4.5 DB 拡張時に既に `pub(crate)` 化済み。キャッシュ即返しは決定的 2 ピース(`compute_source_hash` の同一入力=同一ハッシュ・db round-trip の保存ハッシュ一致)の合成で保証され、それぞれ既存単体テストで担保(embed_worker の hash 一致テスト・db::tests `background_summary_roundtrip_and_upsert`)。LLM/sidecar 経路は FoundationModels 実機(macOS)が要るためコマンド E2E のテストは追加せず。`cargo build` / `clippy -D warnings` 通過(注: db.rs の日付相対テスト3件は本作業と無関係に当日付替わりで境界がずれ失敗。詳細は所見参照)
- 2026-06-14: v0.4.5 ドキュメント同期。`reports/ReportNarrative.vue`（AI narrative 共用コンポーネント・Props: title/headline/narrative/degradedReason・CrossSummarySection と WeeklyMonthlySection で共用）と `IssueBackgroundSummary.vue`（背景・経緯の要約表示専用・Props: open・useReports グローバルステートを参照・IssueDetailDialog にマウント）の2エントリを追加。ARCHITECTURE.md に `components/reports/` ディレクトリを追加。REQUIREMENTS.md の v0.4.5 ステータスを実装済みに更新
- 2026-06-14: v0.4.5 課題詳細ダイアログに背景・経緯の要約導線を追加(IssueDetailDialog.vue・useReports.ts・locales/{ja,en}.json・FR-V045-004)。`IssueDetailDialog.vue` のアクション群(再分析・類似を探すと並ぶ位置)に「背景・経緯を要約」ボタン(`size='small' variant='tonal' color='purple-darken-1' prepend-icon='mdi-text-box-search'`・`:loading=backgroundSummaryLoading`)を追加。クリックで `useReports().generateBackgroundSummary(issue.workspace_id, issue.id, locale)` を呼び、本文の `IssueAiAnalysis` 直下に折りたたみセクションを表示(`mdi-creation`+生成ラベル・生成中は `v-progress-circular` スピナー・要約テキストは `ai-text-box`・空文字時は `mdi-comment-off-outline`+「コメントなし（要約対象なし）」)。セクションは一度でも生成を実行したら表示(`showBackgroundSummary` = loading || loaded)。状態は `useReports` 側の per-issue 背景要約 state(`backgroundSummary`/`backgroundSummaryLoading`/`backgroundSummaryLoaded`)を共用し(IssueDetailDialog は同時1つのため `useSimilarSearch` 同様のモジュール単一グローバルステート)、`modelValue` の watch でダイアログを開くたびに `resetBackgroundSummary` でクリアし課題の取り違えを防止。2回目は Rust 側 `source_hash`+`lang` キャッシュで即返し。`useReports.ts` に per-issue state 3本(`backgroundSummary`/`backgroundSummaryLoading`/`backgroundSummaryLoaded`)・`resetBackgroundSummary` を追加し、`generateBackgroundSummary` に optional `lang` 引数(省略時 UI 言語追従)を追加して state 駆動へ変更(コメントなし・AI 非対応・生成失敗・DB エラーは空文字へ degrade)。`locales/{ja,en}.json` の `ai.issueDetail` に `summarizeBackground`/`backgroundSummaryTitle`/`backgroundSummarizing`/`backgroundNoComments` を日英で追加。`pnpm run lint`(0 errors)/`pnpm run format:check` 通過
- 2026-06-14: v0.4.5 レポート1日1回バックグラウンド自動生成のスケジューラ結線(scheduler.rs・commands.rs・FR-V045-005)。`commands.rs` の `generate_reports` 生成コアを `pub(crate) generate_report(&app, &db, workspace_id, report_type, lang)` へ抽出し、コマンドは薄いラッパーに(コマンドと自動生成が同一経路)。`CROSS_SUMMARY_REGEN_HOURS`(`#[allow(dead_code)]` 解除)・`iso_week_key`・`month_key` を `pub(crate)` 化。`scheduler.rs` の `sync_and_notify` のワークスペースループ直後(トレイ更新の前)に `generate_due_reports(app, &db)` を追加。AI ON(`is_ai_enabled`=`settings.ai_enabled=="true"`)かつ可用性あり(`ai_is_available`=FoundationModels バックエンドを一時生成し `availability==available`)のときだけ実行、それ以外はアイドル(可用性問い合わせの sidecar 起動も AI ON 時のみ)。有効ワークスペースごとに横断サマリ=`cross_summary_is_due`(`generated_at` 経過≥`CROSS_SUMMARY_REGEN_HOURS`・未生成/欠落/パース失敗は true)、週次/月次=`period_report_is_due`(現在の `iso_week_key`/`month_key` で `get_report_summary` が `None`)を判定し、`generate_report_quietly`→`commands::generate_report`(`job_queue` を介さず直接 `create_backend`→`infer`)で生成。失敗は本体(通常 sync)を止めずログのみ(NFR-V045-003)。新定数 `SETTING_LANGUAGE`/`DEFAULT_REPORT_LANG`(`ja`)/`REPORT_TYPE_*`/`CROSS_SUMMARY_PERIOD_KEY`。scheduler.rs に単体テスト4件追加(`is_ai_enabled` の `"true"` のみ有効・`resolve_report_lang` の既定/追従・`cross_summary_is_due` の未生成→true/生成直後→false・`period_report_is_due` の未生成→true/生成済み→false。in-memory SQLite。背景日時 backdate は db.pool が private のため省略)。`cargo build` / `clippy --all-targets -D warnings` / `fmt --check` / 単体テスト(scheduler::tests 8件) 通過。AI ON 環境での実生成・AI OFF アイドルの実機ログ確認は残(注: db.rs の日付相対テスト3件は本作業と無関係に当日付替わりで失敗。baseline でも再現確認済み)
- 2026-06-14: 埋め込みモデル記述の実装同期(COMPONENTS.md のみ・ドキュメント修正)。v0.4 実装中に既定埋め込みを **`multilingual-e5-small`(Core ML・384次元) → OS 組み込み `NLContextualEmbedding`(`apple-nl-contextual-ja`・512次元)** へ切り替えた際、本ドキュメントの「現状仕様」セクション(embedding.rs・foundation_models.rs・embed_worker.rs・cosine.rs・sidecar 節と db.rs 定数/テーブル)に旧記述が残っていたのを実装(`EMBEDDING_DIM=512`・`EMBEDDING_MODEL="apple-nl-contextual-ja"`・`EmbeddingBackendKind::AppleNLContextual`・sidecar の `NLContextualEmbedding(language:.japanese)` mean-pooling)に合わせて修正。NLContextual は OS 提供のため**モデルファイル同梱不要・配布サイズ増なし**であり、Core ML `.mlmodelc`/`.copy("Resources")`/`EmbedPrefix`(query:/passage:) は**将来の DL 可能 e5 モデル用の休眠スキャフォールド**(既定では未使用)である旨を明記。過去の日付付き changelog 行は当時の事実として保持(履歴は書き換えない)。日付相対テスト3件の失敗は別コミット `fix(ai): …localtime…` で解消済み
