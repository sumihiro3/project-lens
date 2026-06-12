# CLAUDE.md — ProjectLens

Backlog のチケットを複数ワークスペース・複数プロジェクト横断で同期・可視化する macOS デスクトップアプリ。
Tauri 2 + Nuxt 4 (Vue 3 / Vuetify 3) + SQLite (sqlx)。

## コマンド

| 用途                 | コマンド                                               |
| -------------------- | ------------------------------------------------------ |
| 開発起動             | `pnpm run tauri:dev`                                   |
| フロント lint        | `pnpm run lint` (修正: `lint:fix`)                     |
| フロント format 確認 | `pnpm run format:check` (修正: `format`)               |
| Rust lint            | `pnpm run lint:rust` (= `cargo clippy -- -D warnings`) |
| Rust format          | `pnpm run format:rust:check` (修正: `format:rust`)     |
| 静的サイト生成       | `pnpm run generate`                                    |
| リリースビルド       | `pnpm run build:release` (= `./build.sh`)              |

パッケージマネージャは **pnpm**(corepack 管理)。npm / yarn を使わない。

## ドキュメント参照マップ

docs/ は「エージェントが読む仕様書」。役割ごとに参照先が決まっている:

| 知りたいこと                             | 参照先                                           |
| ---------------------------------------- | ------------------------------------------------ |
| 設計原則・コーディング規約・レビュー基準 | `docs/ARCHITECTURE.md`(規約。レビューの判定基準) |
| コンポーネント分割・命名の必須ルール     | `docs/COMPONENT_RULES.md`(規約)                  |
| 配色・テーマ                             | `docs/COLOR_SCHEME.md`(規約)                     |
| 実装済みコンポーネント・モジュールの現状 | `docs/COMPONENTS.md`(現状仕様。探索の入口)       |
| プロダクト全体の要件                     | `docs/REQUIREMENTS.md`(索引)                     |
| リリースごとの要件・設計・リリースノート | `docs/releases/vX.Y/`(リリース別)                |

## コーディング規約(要点)

- Rust: すべての公開関数に**日本語ドキュメントコメント**(役割・引数・戻り値)。モジュールは単一責任(詳細: `docs/ARCHITECTURE.md`)
- Vue: ページ 50-100行、コンポーネント 50-150行目安。ロジックは composables へ分離。Props/Emits に型定義必須
- TS/Vue のコメントは「なぜ」が非自明なときだけ
- i18n: UI 文言は `src/locales/{ja,en}.json` に追加(日英両方)
- コンポーネント追加時は `docs/COMPONENTS.md` を更新

## コミット規約

- Conventional Commits + **日本語サブジェクト**(例: `feat(ui): 設定画面にワークスペース管理を追加`)
- 論理的な単位でコミットを分割する(`/logical-commits` を使用)

## リリースサイクルの運用ルール

開発は「リリース(v1.1, v1.2, v2.0 …)」単位で以下のサイクルを回す:

1. `/refine-requirements` — 要件の壁打ち → `docs/releases/vX.Y/requirements.md` に確定要件を書き出す
2. `implement-feature` ワークフロー — requirements.md を入力に探索→設計→実装→検証
3. `review-changes` ワークフロー — 差分の多次元レビュー
4. `sync-docs` ワークフロー — docs/・README(英・日)を実装に同期
5. `release-check` ワークフロー — lint/format/clippy/build の一括検査
6. `/logical-commits` — 論理単位でコミット

ワークフローは `.claude/workflows/`、コマンドは `.claude/commands/` にある。

### ワークフローのモデル使い分け

| 工程                                     | モデル         |
| ---------------------------------------- | -------------- |
| 要件設定・設計                           | Opus           |
| 実装・テスト・ドキュメント化             | Sonnet(メイン) |
| 軽量タスク(コマンド実行・要約・定型更新) | Haiku          |
| 複雑な実装・レビュー                     | Opus           |

新しいワークフローを書くときは agent() の `model` オプションでこの方針に従うこと。
