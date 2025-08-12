# Create Pull Request

Creates a pull request with automatic issue closing.

## Usage

Provide comma-separated issue numbers as argument (e.g., "123,456")

## Implementation

I will help you create a pull request by following these steps:

1. **Pre-flight checks:**
   - Verify current branch is not main/master/develop
   - Confirm local changes exist using `git rev-list develop..HEAD --count`
   - Validate GitHub CLI authentication with `gh auth status`
   - Parse and verify issue numbers are accessible

2. **Branch preparation:**
   - Show change summary with `git log develop..HEAD --oneline` and `git diff develop --stat`
   - Ensure clean working directory (all changes committed)
   - Push feature branch with `git push -u origin HEAD`

3. **PR creation:**
   - Fetch issue details using `gh issue view <num> --json title,body,labels`
   - Generate intelligent PR title (single issue: use issue title with prefix, multiple issues: create summary, fallback: use commit message)
   - Create structured Japanese description with:
     - 変更の概要 (overview based on commits and issues)
     - 主な変更点 (main changes from git diff summary)
     - テスト方法 (testing method)
     - 関連Issue: Closes #<issue-numbers>

4. **Execute PR creation:**
   - Run `gh pr create` with generated title and Japanese description
   - Handle draft PR option for large changes
   - Auto-assign reviewers based on CODEOWNERS if available

5. **Post-creation:**
   - Display PR URL and number
   - Show CI/check status
   - Suggest next actions (request reviews, etc.)

## Error Handling

- No commits ahead of develop: Explain workflow and suggest next steps
- Issue numbers not found: List available open issues
- Permission denied: Provide authentication troubleshooting
- Merge conflicts: Offer resolution guidance
- Rate limiting: Suggest retry options
