Implement GitHub issue with guided assistance and interactive decision-making.

Arguments: <issue-number> (required)

**Important: All guidance, suggestions, explanations, and user interactions should be in Japanese.**

**Agent: Use the `electron-developer` agent for all implementation work, as this project uses Electron + Nuxt3 + Vuetify3 stack.**

Phase 1: Issue Analysis and Setup

1. **Issue comprehension**

- Load issue details: `gh issue view $1 --json title,body,labels,state,assignees,comments`
- Parse and categorize requirements into actionable items (explain in Japanese)
- Assess complexity level and estimated implementation scope (present in Japanese)
- Check for existing implementation plans or related PRs (report findings in Japanese)

2. **Environment preparation**

- Verify clean working directory: `git status --porcelain`
- Confirm current branch: `git branch --show-current`
- Create feature branch: `git checkout -b feature-$1`
- Handle existing branch conflicts with user confirmation

3. **Codebase analysis**

- Search relevant files using issue keywords and context
- Identify existing patterns and architectural conventions
- Map potential files requiring modification (present analysis in Japanese)
- Present initial implementation strategy for user approval (explain in Japanese)

Phase 2: Interactive Implementation

4. **Present implementation plan**

```
🔍 Issue分析完了
📋 実装計画:
1. [ファイル/コンポーネント1] - [目的]
2. [ファイル/コンポーネント2] - [目的]
3. [テスト] - [カバー範囲]

この計画で進めますか？ [Y/n/modify]:
```

5. **File-by-file guided implementation**
**Use the `electron-developer` agent for all code implementation tasks.**
For each implementation step (communicate in Japanese):

- **Present Context**: Show current state and proposed changes in Japanese
- **Offer Options**: Templates, patterns, or custom implementation (explain in Japanese)
- **Seek Confirmation**: Before making significant changes (ask in Japanese)
- **Provide Rationale**: Explain why this approach is recommended (in Japanese)

```
📁 次: src/components/LoginForm.tsx
現在: ファイルが存在しません
提案: フォームバリデーション付きReactコンポーネント

実装オプション:
1. 既存フォームテンプレートを使用して修正
2. プロジェクトパターンに従ってゼロから作成
3. 手動で実装

選択してください [1/2/3]:
```

6. **Continuous validation and feedback**

- **Incremental Testing**: Run relevant tests after each file change (report results in Japanese)
- **Immediate Feedback**: Show test results and linting issues (in Japanese)
- **Progressive Fixes**: Address issues before moving to next step (guide in Japanese)
- **Checkpoint Commits**: Create safe points for complex changes (explain in Japanese)

```
🧪 LoginForm.tsxをテスト中...
✅ コンポーネントが正常にレンダリングされました
⚠️  PropTypesが不足しています（推奨ですが必須ではありません）
❌ ログインバリデーションテストが失敗しています

アクション:
[テスト修正/PropTypes追加/続行/コードレビュー]:
```

Phase 3: Quality Assurance and Finalization

7. **Comprehensive validation**

- Execute full test suite with detailed reporting (present results in Japanese)
- Perform complete linting and type checking (communicate status in Japanese)
- Validate implementation against original issue requirements (explain in Japanese)
- Check for potential breaking changes or regressions (report in Japanese)

8. **Commit preparation and finalization**

- Generate clear commit message following conventional format (present in Japanese)
- Include appropriate issue references (e.g., "fixes #$1") (explain in Japanese)
- Offer commit message customization before finalizing (interact in Japanese)
- Provide next steps guidance (PR creation, review assignment) (explain in Japanese)

```
🎯 実装サマリー:
- 3ファイル作成、2ファイル修正
- 8テスト追加、すべて通過
- リント問題 0件
- Issue要件: ✅ すべて対応済み

コミットメッセージ:
"feat(auth): ユーザーログイン機能を実装

- バリデーション付きLoginFormコンポーネントを追加
- JWT認証サービスを統合
- 包括的なテストカバレッジを追加

Fixes #123"

コミットしますか？ [Y/edit/review]:
```

Key Features:

**Interactive Decision Making (in Japanese):**

- Always ask for confirmation before significant changes (in Japanese)
- Provide multiple implementation options with rationale (explain in Japanese)
- Allow switching approaches mid-process (guide in Japanese)
- Support pause/resume functionality (communicate in Japanese)

**Safety Measures (communicate in Japanese):**

- Validation gates preventing progression with failing tests (explain in Japanese)
- Rollback options at multiple checkpoints (present options in Japanese)
- Conflict resolution guidance (provide instructions in Japanese)
- Partial implementation support with TODO markers (explain in Japanese)

**Quality Assurance (report in Japanese):**

- Incremental testing after each change (show results in Japanese)
- Continuous linting and type checking (communicate status in Japanese)
- Requirement validation against original issue (explain findings in Japanese)
- Performance impact assessment (present analysis in Japanese)

**Learning Opportunities (provide in Japanese):**

- Explain code patterns and architectural decisions (in Japanese)
- Show why certain approaches are recommended (explain reasoning in Japanese)
- Provide detailed explanations when requested (in Japanese)
- Maintain consistency with existing codebase (explain patterns in Japanese)

Example Interaction Flow (in Japanese):

```
🔍 Issue #123を分析中: "ユーザー認証の追加"
📋 要件を発見: ログインフォーム、JWT認証、ユーザーセッション
🎯 実装計画準備完了 - 進めますか？ [Y/n/modify]

📁 LoginForm.tsxを作成中...
💡 オプション: [テンプレート/カスタム/既存パターン]
🧪 テスト実行中... ✅ すべて通過
📝 次: AuthService実装...
```

Remember to use GitHub CLI (`gh`) for all GitHub-related operations.
