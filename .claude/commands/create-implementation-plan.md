name: create-implementation-plan
description: |
  タスクIDを指定して詳細な実装計画を作成し、GitHub Issueに登録するコマンド

  使用方法:

- タスク番号を指定 (例: 3.1, 5.2, 12.1)
- 実装計画の自動生成
- GitHub Issue作成の確認

usage: |
  タスク番号を提供してください (例: 3.1, 5.2, 12.1)

process: |

  1. **タスク分析フェーズ**
     - tasks.mdからタスク詳細を抽出
     - 要件参照の解析と要件詳細の取得
     - タスク依存関係の分析
     - 前提条件・並行可能タスクの特定

  2. **コードベース調査フェーズ**
     - 関連キーワードでの既存実装検索
     - アーキテクチャパターンの分析
     - 統合ポイントの特定

  3. **プロジェクト文脈分析フェーズ**
     - 設計仕様・要件・技術スタック情報の収集
     - アーキテクチャ制約の確認
     - ベストプラクティスの抽出

  4. **包括的計画立案フェーズ**
     - 粒度の細かい実装ステップの分解
     - 技術アプローチの決定
     - テスト戦略・パフォーマンス考慮事項の計画

  5. **GitHub Issue作成フェーズ**
     - 詳細な実装計画をIssue本文に含める
     - 適切なラベル・マイルストーンの適用
     - プロジェクト連携の設定

tools:

- name: file_edit
- name: bash
- name: search_replace

subagent: electron-developer

steps:

- name: task_analysis
    description: タスク分析と要件抽出
    action: |

  # 1. タスクファイルからタスク詳細を抽出

      echo "=== タスク分析開始 ==="

  # タスクファイルの確認

      if [ ! -f ".kiro/specs/project-lens-desktop-app/tasks.md" ]; then
        echo "❌ tasks.md ファイルが見つかりません"
        exit 1
      fi

  # タスク番号の検証と抽出

      TASK_NUMBER="$1"
      if [ -z "$TASK_NUMBER" ]; then
        echo "❌ タスク番号を指定してください (例: 3.1, 5.2, 12.1)"
        exit 1
      fi

      echo "📋 対象タスク: $TASK_NUMBER"

  # タスク詳細の抽出（より正確なパターンマッチング）

      echo "タスク詳細を抽出中..."
      # タスク形式: "- [ ] 1.1 タスク名" に対応
      TASK_SECTION=$(awk "/^- \[ \] $TASK_NUMBER /,/^- \[ \] [0-9]/ {if (/^- \[ \] [0-9]/ && !/^- \[ \] $TASK_NUMBER /) exit; print}" .kiro/specs/project-lens-desktop-app/tasks.md)
      
      if [ -z "$TASK_SECTION" ]; then
        echo "❌ タスク $TASK_NUMBER が見つかりません"
        exit 1
      fi
      
      echo "$TASK_SECTION"
      
      # 要件参照の抽出
      REQUIREMENTS=$(echo "$TASK_SECTION" | grep "_要件:" | sed 's/.*_要件: //' | sed 's/_.*//') 
      echo "📋 要件参照: $REQUIREMENTS"
      
      # 依存関係の抽出 
      DEPENDENCIES=$(echo "$TASK_SECTION" | grep "_依存関係:" | sed 's/.*_依存関係: //' | sed 's/_.*//') 
      echo "🔗 直接依存関係: $DEPENDENCIES"

- name: dependency_analysis
    description: 動的依存関係分析
    action: |
      echo "=== 依存関係分析開始 ==="
      
      # フェーズ間依存関係の確認
      echo "🔍 フェーズ間依存関係を分析中..."
      PHASE_DEPS=$(grep -A 20 "フェーズ間依存関係" .kiro/specs/project-lens-desktop-app/tasks.md)
      echo "$PHASE_DEPS"
      
      # タスク内依存関係の確認
      PHASE_NUMBER="${TASK_NUMBER%.*}"
      echo "🔗 フェーズ${PHASE_NUMBER}内の依存関係を分析中..."
      TASK_DEPS=$(grep -A 15 "フェーズ${PHASE_NUMBER}内の依存関係" .kiro/specs/project-lens-desktop-app/tasks.md)
      echo "$TASK_DEPS"
      
      # 推奨実装順序の確認
      echo "📋 推奨実装順序を確認中..."
      IMPL_ORDER=$(grep -A 10 "推奨実装順序" .kiro/specs/project-lens-desktop-app/tasks.md)
      echo "$IMPL_ORDER"

- name: requirements_analysis
    description: 要件詳細の分析
    action: |
      echo "=== 要件分析開始 ==="

  # 要件ファイルの確認と詳細分析

      if [ -f ".kiro/specs/project-lens-desktop-app/requirements.md" ]; then
        echo "📖 要件ファイルから詳細を抽出中..."
        
        # 要件参照IDに基づく詳細情報の取得
        if [ ! -z "$REQUIREMENTS" ]; then
          echo "🎯 関連要件を分析中: $REQUIREMENTS"
          for req in $(echo $REQUIREMENTS | tr ',' ' '); do
            echo "--- 要件 $req の詳細 ---"
            grep -A 5 "^$req\." .kiro/specs/project-lens-desktop-app/requirements.md || echo "要件詳細が見つかりません"
          done
        fi
      else
        echo "⚠️ requirements.md ファイルが見つかりません"
      fi

- name: codebase_reconnaissance
    description: コードベース調査と技術アプローチ提案
    action: |
      echo "=== コードベース調査開始 ==="

  # タスク固有キーワードの動的生成

      echo "🔍 タスク固有の関連実装を検索中..."
      # タスク名から技術キーワードを抽出
      TASK_KEYWORDS=$(echo "$TASK_SECTION" | grep -o -E "(Electron|Nuxt|Vue|TypeScript|Pug|SQLite|Drizzle|Pinia|Mastra|API|Database|UI)" | tr '\n' '|' | sed 's/|$//')
      
      if [ ! -z "$TASK_KEYWORDS" ]; then
        echo "📋 検索キーワード: $TASK_KEYWORDS"
        git grep -rn "$TASK_KEYWORDS" --include="*.ts" --include="*.vue" --include="*.rs" --include="*.js" 2>/dev/null | head -15 || echo "関連実装が見つかりませんでした"
      fi

  # プロジェクト構造の分析

      echo "🏗️ プロジェクト構造を分析中..."
      find . -maxdepth 3 -type d -name "src" -o -name "components" -o -name "pages" -o -name "stores" -o -name "composables" | head -10

  # electron-developer エージェントによる技術アプローチ提案

      echo "🤖 electron-developer エージェントによる技術提案を生成中..."
      # 注: 実際の実装時にはClaude Code Task APIを使用
      echo "--- 技術アプローチ提案 (electron-developer) ---"
      echo "タスク: $TASK_NUMBER"
      echo "推奨パターン: コンポーネント分離, レイヤー化アーキテクチャ, テスト駆動開発"
      echo "ベストプラクティス: TypeScript strict mode, Vue Composition API, Pinia状態管理"

- name: project_context_analysis
    description: プロジェクト文脈分析（強化版）
    action: |
      echo "=== プロジェクト文脈分析開始 ==="

  # 技術制約とアーキテクチャ要件の抽出

      if [ -f ".kiro/steering/tech.md" ]; then
        echo "🔧 技術スタック制約を抽出中..."
        grep -A 5 -i "技術スタック\|アーキテクチャ\|制約" .kiro/steering/tech.md
        echo ""
      fi

  # パフォーマンス要件の抽出

      if [ -f ".kiro/steering/product.md" ]; then
        echo "⚡ パフォーマンス要件を抽出中..."
        grep -A 3 -i "パフォーマンス\|メモリ\|起動時間\|軽量" .kiro/steering/product.md
        echo ""
      fi

  # ファイル構造パターンの抽出

      if [ -f ".kiro/steering/structure.md" ]; then
        echo "📁 ファイル構造パターンを確認中..."
        grep -A 5 -i "ディレクトリ\|フォルダ\|構造\|パターン" .kiro/steering/structure.md
        echo ""
      fi

  # 設計仕様の確認

      if [ -f ".kiro/specs/project-lens-desktop-app/design.md" ]; then
        echo "📐 設計仕様を確認中..."
        head -10 ".kiro/specs/project-lens-desktop-app/design.md"
        echo ""
      fi

  # セキュリティとプライバシー要件の確認

      echo "🔒 セキュリティ要件を確認中..."
      grep -r -i "セキュリティ\|暗号化\|プライバシー\|認証" .kiro/steering/ .kiro/specs/ | head -5 || echo "特定のセキュリティ要件は見つかりませんでした"

- name: create_github_issue_with_plan
    description: 実装計画を含むGitHub Issue作成
    action: |
      echo "=== GitHub Issue作成開始 ==="

  # GitHub CLI の確認

      if ! command -v gh &> /dev/null; then
        echo "❌ GitHub CLI (gh) がインストールされていません"
        echo "GitHub CLI をインストールしてください: https://cli.github.com/"
        exit 1
      fi

  # GitHub認証確認

      if ! gh auth status &> /dev/null; then
        echo "❌ GitHub認証が必要です"
        echo "以下のコマンドで認証してください:"
        echo "  gh auth login"
        exit 1
      fi

  # 分析結果の統合

      CURRENT_DATE=$(date +"%Y-%m-%d")
      
      # 前のステップで抽出した情報を活用
      TASK_DETAILS=$(echo "$TASK_SECTION" | head -15)
      
      # 依存関係情報の整理
      PREREQUISITE_TASKS="$DEPENDENCIES"
      if [ -z "$PREREQUISITE_TASKS" ] || [ "$PREREQUISITE_TASKS" = "なし" ]; then
        PREREQUISITE_TASKS="なし（独立実行可能）"
      fi
      
      # 要件詳細の整理
      RELATED_REQUIREMENTS="$REQUIREMENTS"
      if [ -z "$RELATED_REQUIREMENTS" ]; then
        RELATED_REQUIREMENTS="要件参照なし"
      fi

  # Issue タイトルとボディの準備

      ISSUE_TITLE="[Task $TASK_NUMBER] 実装タスク"

  # 詳細な実装計画をIssue本文に含める

      ISSUE_BODY="# 📋 実装計画概要

**対象タスク**: $TASK_NUMBER
**計画作成日**: $CURRENT_DATE
**推定工数**: 未算出

## 🎯 タスク概要

\`\`\`
$TASK_DETAILS
\`\`\`

## 🏗️ 技術設計

### アプローチ

- **技術スタック**: Elextron + Vue.js (Nuxt3) + TypeScript + Pug
- **データ保存**: SQLite（ローカル）
- **AI統合**: Mastra（OpenAI/Claude/Gemini 対応）

### 影響範囲

- [ ] 新規コンポーネント作成
- [ ] 既存APIの拡張
- [ ] データベーススキーマの更新

### 依存関係

**前提タスク（完了が必要）:**

- $PREREQUISITE_TASKS

**関連要件:**

- $RELATED_REQUIREMENTS

**フェーズ間制約:**

- tasks.mdの依存関係マップに準拠

## ✅ 実装ステップ

- [ ] 要件詳細の確認と分析
- [ ] 技術設計の詳細化
- [ ] データモデルの設計
- [ ] フロントエンド実装
    - [ ] Vue.js コンポーネント作成
    - [ ] Pinia ストア設定
    - [ ] TypeScript 型定義
- [ ] バックエンド実装
    - [ ] Rust API エンドポイント
    - [ ] SQLite スキーマ更新
    - [ ] データアクセス層
- [ ] 統合テスト
- [ ] ドキュメント更新

## 🧪 テスト計画

### テスト戦略

- ユニットテスト駆動開発
- 統合テストでの動作確認
- E2Eテストでのユーザーシナリオ検証

### テスト種別

- **ユニットテスト**: コンポーネント単位のテスト
- **統合テスト**: API連携のテスト
- **E2Eテスト**: ユーザーワークフローのテスト

### テスト網羅度目標

- **機能カバレッジ**: 最低80%
- **エラーパステスト**: 例外処理とエラーハンドリング
- **パフォーマンステスト**: レスポンス時間とメモリ使用量

## ⚠️ リスクと考慮事項

- [ ] パフォーマンスへの影響
- [ ] セキュリティ要件の確認
- [ ] 既存機能への影響
- [ ] メモリ使用量の最適化
- [ ] 軽量起動の維持

## 📋 アーキテクチャ参照

- **レイヤー構成**: プレゼンテーション層(Vue/Nuxt3) → アプリケーション層(Rust) → データ層(SQLite)
- **セキュリティ**: APIキー暗号化保存、ローカルのみでのデータ処理
- **パフォーマンス**: 軽量起動、低メモリ使用量重視

## ✅ Definition of Done

- [ ] 全機能が要件を満たして動作する
- [ ] 全テストケースが通過する（最低80%カバレッジ）
- [ ] エラーハンドリングが適切に実装されている
- [ ] パフォーマンス基準を満たしている
- [ ] セキュリティ要件を満たしている
- [ ] ドキュメント（コメント・README）が更新されている
- [ ] コードレビューが完了している
- [ ] 統合テストで既存機能に問題が発生しない

## 📝 レビューチェックリスト

### コード品質

- [ ] コーディング規約に準拠している
- [ ] 適切なエラーハンドリングが実装されている
- [ ] パフォーマンスへの配慮がされている
- [ ] セキュリティベストプラクティスが適用されている

### アーキテクチャ準拠

- [ ] 既存のアーキテクチャパターンに従っている
- [ ] レイヤー分離が適切に実装されている
- [ ] 依存関係の注入が適切に行われている
- [ ] 単一責任の原則が守られている

### テスト

- [ ] テストケースが網羅的である
- [ ] エッジケースがテストされている
- [ ] モックが適切に使用されている
- [ ] テストの可読性が高い

---

## 💡 実装完了後

完了時は以下のコマンドで実装ログを作成:
\`\`\`bash
claude-code create-implementation-log $TASK_NUMBER
\`\`\`"

        # GitHub Issue の作成
        echo "GitHub Issue を作成中..."
        ISSUE_URL=$(gh issue create \
          --title "$ISSUE_TITLE" \
          --body "$ISSUE_BODY" \
          --label "enhancement,task,implementation" \
          --assignee "@me" \
          2>&1)

        if [ $? -eq 0 ]; then
          echo "✅ GitHub Issue を作成しました"
          echo "🔗 Issue URL: $ISSUE_URL"
        else
          echo "❌ GitHub Issue の作成に失敗しました"
          echo "エラー: $ISSUE_URL"
          exit 1
        fi

- name: completion_summary
    description: 実行完了サマリー
    action: |
      echo ""
      echo "🎉 実装計画作成が完了しました！"
      echo ""
      echo "📋 作成されたもの:"
      echo "  - GitHub Issue: [Task $TASK_NUMBER] 実装タスク"
      echo ""
      echo "📝 次のステップ:"
      echo "  1. GitHub Issue で実装計画を確認・詳細化"
      echo "  2. タスクの依存関係を確認"
      echo "  3. 実装開始"
      echo "  4. 完了後に実装ログを作成"
      echo ""
      echo "💡 実装ログ作成コマンド（完了後）:"
      echo "  claude-code create-implementation-log $TASK_NUMBER"
      echo ""
      echo "🔗 GitHub Issue を確認:"
      echo "  gh issue list --label task"

error_handling: |

- タスク番号が見つからない場合の適切なエラーメッセージ
- 必要ファイルが存在しない場合の警告
- GitHub認証エラーの適切な処理
- ファイル作成権限エラーの処理
- 不正なタスク番号形式の検出
- 依存関係分析でのファイル読み取りエラー処理
- electron-developer エージェント呼び出し失敗時のフォールバック

validation: |

- タスク番号の形式検証（例: 1.1, 12.3形式）
- 必要ディレクトリの存在確認（.kiro/specs/, .kiro/steering/）
- GitHub CLI と認証状態の確認
- tasks.mdファイルの構造検証
- 抽出された要件IDとしてのフォーマット確認
- ステアリングファイルのアクセス権限確認

output_format: |

- 進行状況の明確な表示
- エラー時の適切な説明
- 成功時の次ステップガイダンス
- 作成されたファイルパスの明示
