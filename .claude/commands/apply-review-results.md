# Apply code review results from GitHub issue

Arguments: <issue-number> (required) [--required-only|--all] (optional, default: --required-only)

Workflow:

1. Verify prerequisites (git repo, GitHub CLI, issue access)

2. Fetch latest review comment from GitHub issue:

   ```bash
   gh issue view $1 --json comments --jq '.comments[-1].body'
   ```

3. Parse review results:
   - Extract 必須 (required) action items
   - Extract 推奨 (recommended) improvements
   - Identify file modifications needed

4. Determine scope based on argument:
   - **--required-only**: Only implement 必須 items
   - **--all**: Implement both 必須 and 推奨 items

5. Use `electron-developer` agent for implementation:
   - REQUIRED: Always use the `electron-developer` specialized agent
   - Pass review feedback and implementation scope to the agent
   - Agent will implement changes following Electron + Nuxt3 + Vuetify3 best practices

6. Validation after implementation:

   ```bash
   # Run tests if available
   npm test 2>/dev/null || echo "No test suite found"

   # Run linter if available
   npm run lint 2>/dev/null || echo "No linter configured"

   # Type checking if TypeScript
   npm run typecheck 2>/dev/null || echo "No type checking configured"
   ```

7. Post implementation results to GitHub issue:

   ```bash
   gh issue comment $1 --body-file /tmp/implementation-result.md
   ```

Implementation result format:

```markdown
## ✅ コードレビュー対応完了

### 📝 対応内容
- 対応範囲: [必須のみ / 必須＋推奨]
- 修正ファイル数: X files

### 🔧 実装した項目

#### 必須項目
- [x] [Implemented required item 1]
- [x] [Implemented required item 2]

#### 推奨項目 (--all の場合のみ)
- [x] [Implemented recommended item 1]
- [ ] [Skipped item with reason]

### ✔️ 検証結果
- テスト: [PASS/FAIL]
- Lint: [PASS/FAIL]
- 型チェック: [PASS/FAIL]

### 📌 次のステップ
- [ ] PR作成準備完了
- [ ] 追加テストが必要な場合はその内容

---
*Implementation completed by electron-developer agent at {timestamp}*
```

Error handling:

- Missing issue: List available issues with `gh issue list --limit 10`
- No review comments: Prompt user to run code-review command first
- Parse errors: Show unparseable sections and request manual clarification
- Implementation failures: Report specific errors and suggest manual intervention

Additional requirements:

- Prioritize critical/blocking issues first
- Maintain code style consistency with existing codebase
- Create atomic commits for each logical change
- Provide clear progress updates during implementation
