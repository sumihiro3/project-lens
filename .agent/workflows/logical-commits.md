---
description: 変更されたファイルを分析して、論理的な単位でコミットを分割して作成します。
---

# Logical Commits Command

変更されたファイルを分析して、論理的な単位でコミットを分割して作成します。

## 処理の流れ

1. `git status` で変更されたファイルを確認
2. `git diff` で変更内容を確認
3. ファイルを論理的な単位にグループ化
4. 各グループごとに適切なコミットメッセージを **日本語** で作成
5. コミットを実行

## コミットの分類基準

### 機能追加 (feat:)

- 新しいファイルの追加
- 新しい機能の実装
- 例: `feat: Product HuntからデータをAPI取得するスクリプトを実装`

### リファクタリング (refactor:)

- 既存コードの改善・整理
- import文の変更
- ディレクトリ構造の変更
- 例: `refactor: 既存スクリプトをscripts/common/に移動してpathAliasに対応`

### ドキュメント (docs:)

- README、CLAUDE.md等のドキュメント更新
- コメントの追加・改善
- 例: `docs: CLAUDE.mdにコーディング規約を追加`

### 設定ファイル (chore:)

- package.json、tsconfig.json等の設定変更
- 依存関係の追加・更新
- 例: `chore: node-producthunt-apiとdotenvを追加`

## コミットメッセージの形式

```
<type>: <subject>

<body>

🤖 Generated with Antigravity
```

- **type**: feat, refactor, docs, chore, fix など
- **subject**: 変更の概要（日本語、1行）
- **body**: 詳細な説明（必要に応じて）

## 実行

このコマンドを実行すると、Claude Code が自動的に:

- 変更ファイルを分析
- 論理的なグループに分類
- 適切なコミットメッセージを生成
- 順次コミットを作成

各コミットは人間の開発者が理解しやすい単位で分割されます。