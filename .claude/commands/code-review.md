# Code review based on GitHub issue implementation plan

Arguments: <issue-number> (required) [--quick|--thorough] (optional)

Workflow:

1. Verify prerequisites (git repo, GitHub CLI, issue access)
2. Extract issue context:

   ```bash
   gh issue view $1 --json title,body,labels,assignees,milestone
   ```

3. Analyze local changes with enhanced metrics:

   ```bash
   # File changes overview
   git diff main...HEAD --name-status
   git diff main...HEAD --stat

   # Detailed changes
   git diff main...HEAD

   # Commit history
   git log main..HEAD --oneline

   # Focus on critical files
   git diff main...HEAD --name-only | grep -E '\.(ts|tsx|js|jsx)$'
   ```

4. Issue type-based review strategy:
   - **bug**: Focus on error handling, edge cases, test coverage
   - **feature**: Prioritize requirement compliance, design patterns
   - **refactor**: Emphasize code quality, maintainability
   - **performance**: Include performance metrics and benchmarks
   - **security**: Deep dive into vulnerability patterns

5. Pre-PR validation checks:

   ```bash
   # Run tests if available
   npm test 2>/dev/null || echo "No test suite found"

   # Run linter if available
   npm run lint 2>/dev/null || echo "No linter configured"

   # Type checking if TypeScript
   npm run typecheck 2>/dev/null || echo "No type checking configured"
   ```

6. Execute comprehensive code review using `code-reviewer` agent:
   - REQUIRED: Always use the `code-reviewer` specialized agent for analysis
   - Pass issue context, diff data, and review requirements to the agent
   - Agent will perform deep code analysis with security and best practices focus

7. Post review results to GitHub issue as comment:

   ```bash
   # Post review comment to GitHub issue
   gh issue comment $1 --body-file /tmp/review-comment.md
   ```

Review dimensions:

- **Requirement Compliance**: Alignment with issue requirements and acceptance criteria
- **Code Quality**: Readability, maintainability, SOLID principles, design patterns
- **Bug Risk Assessment**: Error handling, edge cases, input validation
- **Test Coverage**: Unit tests, integration tests, test effectiveness
- **Performance**: Time complexity, space complexity, scalability concerns
- **Security**: OWASP top 10, injection risks, authentication/authorization
- **CI/CD Readiness**: Build stability, deployment requirements

Output specification:

- Primary output: GitHub issue comment (posted directly via `gh issue comment`)
- Local backup: `/docs/code-reviews/{issue-number}/review-{issue-number}-{YYYYMMDD-HHMMSS}.md`
- Format for GitHub comment:

  ```markdown
  ## 🔍 Code Review for Local Changes

  ### 📊 変更サマリー
  - 変更ファイル数: X files
  - 追加行数: +XXX
  - 削除行数: -XXX

  ### ✅ 良い点
  - [Specific positive feedback from code-reviewer agent]

  ### ⚠️ 改善が必要な点

  #### High Priority
  - [ ] [Critical issues that must be fixed]

  #### Medium Priority
  - [ ] [Should be addressed before PR]

  #### Low Priority
  - [ ] [Nice to have improvements]

  ### 💡 提案事項
  - [Suggestions for better implementation]

  ### 🔧 アクションアイテム
  - [ ] 必須: [Required actions before PR]
  - [ ] 推奨: [Recommended improvements]

  ### ✔️ PR作成前チェックリスト
  - [ ] テスト実行・成功確認
  - [ ] Lintエラーなし
  - [ ] 型チェック通過
  - [ ] Issue要件を満たしている

  ---
  *Review conducted by code-reviewer agent at {timestamp}*
  ```

Review modes:

- **--quick**: Essential files only, basic validation checks (< 10 minutes)
- **--thorough**: Full codebase review including security and performance analysis
- **Auto-detection**: Suggest --quick mode when changes exceed 10 files

Error recovery:

- Missing issue: List available issues with `gh issue list --limit 10`
- No changes: Notify user and suggest development workflow
- Permission issues: Check GitHub auth status with `gh auth status`
- Large diff: Propose incremental review approach for extensive changes

Review history:

- Previous reviews: Reference past reviews in `/docs/code-reviews/{issue-number}/` directory
- Continuous review: Track iterative improvements for same issue
