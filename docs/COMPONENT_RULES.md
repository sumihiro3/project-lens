# コンポーネント設計ルール

このルールは、ProjectLensプロジェクトでコンポーネントを作成・変更する際に自動的に適用されます。

## 必須ルール

### 1. コンポーネント分割
- ページコンポーネントは50-100行を目安とする
- UIコンポーネントは50-150行を目安とする
- 100行を超える場合は分割を検討する

### 2. 命名規則
- ページ: kebab-case (`index.vue`, `settings.vue`)
- コンポーネント: PascalCase (`IssueCard.vue`, `IssueFilterPanel.vue`)
- Composables: camelCase + `use`プレフィックス (`useIssues.ts`)
- Utils: camelCase (`issueHelpers.ts`)

### 3. TypeScript型定義
- すべてのProps/Emitsに型定義を追加
- `any`型の使用は最小限に

### 4. ドキュメント更新
- 新しいコンポーネント追加時は`docs/COMPONENTS.md`を更新
- 新しいパターン確立時は`docs/ARCHITECTURE.md`を更新

### 5. Rustコード
- すべての公開関数に日本語ドキュメントコメントを追加
- 引数、戻り値、役割を明記

## 推奨事項

### コンポーネント設計
- 単一責任の原則を守る
- Propsは必要最小限に
- Emitsイベント名はkebab-case

### Composables
- ロジックをページから分離
- 状態管理はComposablesで
- 再利用可能な設計

### ユーティリティ
- 純粋関数として実装
- 状態を持たない
- テスト可能な設計

## 自動チェック項目

コンポーネント追加・変更時に以下を確認：
- [ ] 命名規則に従っているか
- [ ] 型定義があるか
- [ ] ドキュメントが更新されているか
- [ ] 適切なサイズか（100行以下推奨）
- [ ] 単一責任か
