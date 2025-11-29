# ProjectLens アーキテクチャガイドライン

## 概要

このドキュメントは、ProjectLensプロジェクトのアーキテクチャ、コンポーネント設計、コーディング規約を定義します。
新しいページやコンポーネントを追加する際は、このガイドラインに従ってください。

## プロジェクト構成

```
ProjectLens/
├── src/                          # フロントエンド（Nuxt 3）
│   ├── pages/                    # ページコンポーネント
│   ├── components/               # 再利用可能なコンポーネント
│   ├── composables/              # Composition API ロジック
│   ├── utils/                    # ユーティリティ関数
│   ├── plugins/                  # Nuxt プラグイン
│   └── app.vue                   # ルートコンポーネント
├── src-tauri/                    # バックエンド（Rust）
│   ├── src/
│   │   ├── commands.rs           # Tauri コマンド
│   │   ├── db.rs                 # データベース操作
│   │   ├── backlog.rs            # Backlog API クライアント
│   │   ├── scoring.rs            # スコアリングロジック
│   │   ├── scheduler.rs          # バックグラウンドスケジューラー
│   │   └── lib.rs                # メインエントリポイント
│   └── Cargo.toml
└── docs/                         # ドキュメント
    ├── ARCHITECTURE.md           # このファイル
    └── COMPONENTS.md             # コンポーネント一覧
```

## フロントエンド設計原則

### 1. コンポーネント分割の基準

#### ページコンポーネント（`pages/`）
- **役割**: ルーティング、データ取得、コンポーネントの統合
- **サイズ**: 50-100行を目安
- **責務**: 
  - composablesを使用してデータ取得
  - 子コンポーネントの配置と連携
  - ページレベルの状態管理

**例**: `pages/index.vue`
```vue
<template>
  <v-container>
    <DashboardHeader @refresh="loadIssues" :loading="loading" />
    <IssueFilterPanel v-model="filters" :issues="issues" />
    <IssueList :issues="filteredIssues" :loading="loading" />
  </v-container>
</template>

<script setup>
const { issues, loading, loadIssues } = useIssues()
const { filters, filteredIssues } = useIssueFilters(issues)
</script>
```

#### UIコンポーネント（`components/`）
- **役割**: 再利用可能なUI部品
- **サイズ**: 50-150行を目安
- **命名規則**: PascalCase、役割を明確に（例: `IssueCard`, `IssueFilterPanel`）
- **責務**:
  - Props経由でデータを受け取る
  - Emitsでイベントを親に通知
  - 単一責任の原則を守る

**分割の目安**:
- 100行を超えたら分割を検討
- 複数の責務がある場合は分割
- 他のページでも使用する可能性がある場合は独立させる

#### Composables（`composables/`）
- **役割**: ロジックの再利用、状態管理
- **命名規則**: `use`で始まる（例: `useIssues`, `useIssueFilters`）
- **責務**:
  - データ取得ロジック
  - フィルタリング・ソートロジック
  - 複雑な計算ロジック

**例**: `composables/useIssues.ts`
```typescript
export function useIssues() {
  const issues = ref<Issue[]>([])
  const loading = ref(false)

  async function loadIssues() {
    loading.value = true
    try {
      issues.value = await invoke('get_issues')
    } finally {
      loading.value = false
    }
  }

  return { issues, loading, loadIssues }
}
```

#### ユーティリティ（`utils/`）
- **役割**: 純粋関数、ヘルパー関数
- **命名規則**: camelCase
- **責務**:
  - 状態を持たない純粋関数
  - フォーマット、変換、計算

**例**: `utils/issueHelpers.ts`
```typescript
export function getPriorityColor(priority: string | undefined): string {
  if (!priority) return 'grey'
  if (priority === 'High' || priority === '高') return 'red'
  return 'blue'
}
```

### 2. コンポーネント設計パターン

#### Props設計
- **明示的な型定義**: TypeScriptで型を定義
- **デフォルト値**: 必要に応じて設定
- **バリデーション**: 重要なPropsには検証を追加

```typescript
interface Props {
  issue: Issue
  compact?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  compact: false
})
```

#### Emits設計
- **イベント名**: kebab-case（例: `issue-click`, `filter-change`）
- **ペイロード**: 必要最小限のデータ

```typescript
const emit = defineEmits<{
  'issue-click': [issue: Issue]
  'filter-change': [filters: FilterState]
}>()
```

### 3. ファイル命名規則

| 種類 | 命名規則 | 例 |
|------|----------|-----|
| ページ | kebab-case | `index.vue`, `settings.vue` |
| コンポーネント | PascalCase | `IssueCard.vue`, `IssueFilterPanel.vue` |
| Composables | camelCase, `use`プレフィックス | `useIssues.ts`, `useIssueFilters.ts` |
| Utils | camelCase | `issueHelpers.ts`, `dateUtils.ts` |

## バックエンド設計原則

### 1. モジュール構成

各モジュールは単一責任の原則に従う：

- **commands.rs**: Tauriコマンド定義のみ
- **db.rs**: データベース操作のみ
- **backlog.rs**: Backlog API通信のみ
- **scoring.rs**: スコアリングロジックのみ
- **scheduler.rs**: バックグラウンド処理のみ

### 2. コメント規約

すべてのRustコードには日本語のドキュメントコメントを記載：

```rust
/// 課題の関連度スコアを計算
/// 
/// 以下の基準でスコアを加算する：
/// - 自分が担当者: +50点
/// - 期限切れ: +100点
/// 
/// # 引数
/// * `issue` - スコアを計算する課題
/// * `me` - 現在のユーザー情報
/// 
/// # 戻り値
/// 計算された関連度スコア（0以上の整数）
pub fn calculate_score(issue: &Issue, me: &User) -> i32 {
    // 実装
}
```

## コンポーネント一覧の管理

新しいコンポーネントを追加した際は、`docs/COMPONENTS.md`を更新してください。

## コードレビューチェックリスト

新しいコード追加時は以下を確認：

### フロントエンド
- [ ] コンポーネントは100行以下か？
- [ ] Props/Emitsに型定義があるか？
- [ ] ロジックはcomposablesに分離されているか？
- [ ] 命名規則に従っているか？

### バックエンド
- [ ] すべての関数に日本語コメントがあるか？
- [ ] エラーハンドリングが適切か？
- [ ] 単一責任の原則に従っているか？

## 更新履歴

このドキュメントは、新しいパターンやベストプラクティスが確立された際に更新してください。

- 2024-11-24: 初版作成
