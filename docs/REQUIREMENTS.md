# ProjectLens 要件索引

> **役割**: 要件の索引。リリースごとの確定要件は `docs/releases/vX.Y/requirements.md` にある
> **更新タイミング**: 新しいリリースの要件が確定したとき(`/refine-requirements` が更新する)

## プロダクト概要

Backlog の課題を複数ワークスペース・複数プロジェクト横断で同期し、ユーザーにとって重要な課題を
自動的に優先順位付け(スコアリング)して表示する macOS デスクトップアプリケーション。

- 対象ユーザー: Backlog を日常的に使用する開発者・プロジェクトマネージャー
- 解決する課題: 大量の課題からの重要課題の発見、複数プロジェクトの一元管理、重要課題の見逃し防止

## リリース一覧

| リリース | 内容                                                                         | 要件                                                           | ステータス            |
| -------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------- |
| v0.1     | 初期リリース(同期・スコアリング・通知・ダッシュボード・ワークスペース管理)   | [releases/v0.1/requirements.md](releases/v0.1/requirements.md) | ✅ 実装済み           |
| v0.2     | 開発基盤整備(pnpm 移行・ライブラリ最新化・Dynamic Workflows 確立)            | [releases/v0.2/requirements.md](releases/v0.2/requirements.md) | ✅ 実装済み(PR #23)   |
| v0.3     | AI機能基盤(macOS 搭載モデル/FoundationModels + チケット要約・遅延リスク検知) | [releases/v0.3/requirements.md](releases/v0.3/requirements.md) | ✅ 実装済み           |
| v0.4     | AIユースケース拡充 / MLX(Qwen3)バックエンド追加                              | [releases/v0.4/requirements.md](releases/v0.4/requirements.md) | 📝 ドラフト(壁打ち前) |
| v0.5     | フリーミアム課金 + ライセンス管理(Stripe + Workers + D1)                     | [releases/v0.5/requirements.md](releases/v0.5/requirements.md) | 📝 ドラフト(壁打ち前) |

## リリースサイクル

要件は `/refine-requirements`(壁打ち)で確定させてから実装に着手する。
運用ルールは [CLAUDE.md](../CLAUDE.md) の「リリースサイクルの運用ルール」を参照。
