# ProjectLens 開発基盤整備 要件定義書(v0.2)

> **リリース**: v0.2(開発基盤整備)
> **ステータス**: 確定(2026-06-12、計画モードでの壁打ちにより確定)
> 元要件: `../v0.3/requirements.md` の「その他タスク」より分離

## 背景と目的

v0.3(AI機能)の実装に先立ち、開発プロセスと依存関係の基盤を整備する。
Claude Code の開発ワークフロー(Dynamic Workflows)を確立し、以降の機能実装をすべてそのサイクルに乗せる。

## 機能要件

### FR-V02-001: Dynamic Workflows の確立

- **優先度**: 必須(第1優先)
- **説明**: Claude Code Agent teams のアドホック利用から Dynamic Workflows へ移行する
- **受け入れ基準**:
  - `.claude/workflows/` に implement-feature / review-changes / sync-docs / qa-app / release-check が存在する
  - `.claude/commands/` に refine-requirements / logical-commits が存在する(logical-commits は旧 `.agent/workflows/` から移植、`.agent/` は削除)
  - CLAUDE.md にリリースサイクルの運用ルールとドキュメント参照マップが記載されている
  - docs/ が役割分類(規約 / 現状仕様 / 要件)で整理され、現行コードとの乖離が修正されている
  - 本リリース(v0.2)自体をワークフローのサイクルで実装し、完走することを確認する
  - sync-docs は Obsidian Vault の `Projects/ProjectLens/overview.md` の更新を含む

### FR-V02-002: pnpm への移行

- **優先度**: 必須
- **説明**: パッケージマネージャを npm から pnpm へ移行する
- **受け入れ基準**:
  - `package.json` に `packageManager` フィールド(pnpm)が設定されている
  - `pnpm-lock.yaml` が存在し、`package-lock.json` は削除されている
  - `package.json` scripts・`build.sh` 内の npm/npx 参照が pnpm に置換されている
  - 将来の `server/` 追加に備えた `pnpm-workspace.yaml` が存在する
  - `BUILD.md` / `README.md` / `README_JP.md` の npm 記述が pnpm に更新されている
  - `pnpm install` 後に lint / format:check / generate が成功する

### FR-V02-003: ライブラリ最新化

- **優先度**: 必須
- **説明**: JS / Rust 依存をマイナー・パッチ範囲で最新化する
- **受け入れ基準**:
  - `pnpm outdated` のマイナー/パッチ更新が適用されている(メジャーは跨がない)
  - `cargo update` が適用されている(tauri 2.x 系維持)
  - lint / format:check / lint:rust / format:rust:check / generate がすべて成功する

## スコープ外

- メジャーバージョンアップ(Nuxt 5、Vuetify 4 など)
- CI(GitHub Actions)の整備
- AI機能・課金関連の実装(→ v0.3)

## 未解決事項

- `.claude/settings.json`(permissions allowlist)は Claude Code の自動分類でエージェントによる作成がブロックされるため、ユーザーが手動で追加する
- Vuetify/Nuxt のモジュール解決で問題が出た場合のみ `.npmrc`(`shamefully-hoist=true`)を追加する
