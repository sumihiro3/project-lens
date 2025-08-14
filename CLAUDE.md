# Claude Code Spec-Driven Development

Kiro-style Spec Driven Development implementation using claude code slash commands, hooks and agents.

## Project Context

### Important

- When the task is complete, run:
  - `afplay /System/Library/Sounds/Hero.aiff` to play the notification sound
  - `osascript -e 'display dialog "作業が完了しました" buttons {"OK"} with title "Claude Code"'` to show system notification (fallback: display dialog if notifications disabled)
- When asking for user input or requiring user response, use appropriate dialog based on operation risk:

### Dialog Levels

#### Level 1: Information Dialog (Low Risk)
- **Use for**: File reading, status checks, harmless operations
- **Sound**: `afplay /System/Library/Sounds/Ping.aiff`
- **Dialog**: 
  ```bash
  osascript -e 'display dialog "操作を実行します: [OPERATION]" buttons {"続行"} default button "続行" with title "Claude Code - 情報"'
  ```

#### Level 2: Confirmation Dialog (Medium Risk)
- **Use for**: File editing, test execution, configuration changes
- **Sound**: `afplay /System/Library/Sounds/Submarine.aiff`
- **Dialog**:
  ```bash
  osascript -e 'display dialog "実行確認\n\n操作: [OPERATION]\n内容: [DETAILS]" buttons {"実行", "キャンセル"} default button "実行" with title "Claude Code - 確認"'
  ```

#### Level 3: Critical Confirmation Dialog (High Risk)
- **Use for**: Git operations, PR creation, deletions, deployments
- **Sound**: `afplay /System/Library/Sounds/Sosumi.aiff`
- **Dialog**:
  ```bash
  osascript -e 'display dialog "⚠️ 重要な操作\n\nコマンド: [COMMAND]\n影響範囲: [SCOPE]\n説明: [DESCRIPTION]\n\n続行しますか？" buttons {"実行", "詳細確認", "キャンセル"} default button "キャンセル" with title "Claude Code - 重要確認"'
  ```

### Dialog Usage Rules
1. **Always** include specific operation details in [OPERATION], [COMMAND], etc.
2. **Replace placeholders** with actual command and impact information
3. **Handle "キャンセル"** responses by stopping execution and explaining next steps
4. **Handle "詳細確認"** by showing more detailed information before asking again

### Implementation Examples

#### Git Commit Example (Level 3)
```bash
# Sound
afplay /System/Library/Sounds/Sosumi.aiff

# Dialog with actual details
osascript -e 'display dialog "⚠️ 重要な操作\n\nコマンド: git commit -m \"feat: add user dashboard\"\n影響範囲: ローカルリポジトリ (3ファイル変更)\n説明: ユーザーダッシュボード機能を追加\n変更ファイル:\n- src/components/Dashboard.tsx\n- src/types/user.ts\n- tests/dashboard.test.ts\n\n続行しますか？" buttons {"実行", "詳細確認", "キャンセル"} default button "キャンセル" with title "Claude Code - 重要確認"'

# Handle response
if [ "$response" = "詳細確認" ]; then
  # Show detailed git diff summary
  git diff --stat
  # Ask again with more info
fi
```

#### File Edit Example (Level 2)  
```bash
# Sound
afplay /System/Library/Sounds/Submarine.aiff

# Dialog
osascript -e 'display dialog "実行確認\n\n操作: TypeScript設定ファイル更新\n内容: tsconfig.jsonにstrict:trueを追加\n影響: 型チェックが厳格になります" buttons {"実行", "キャンセル"} default button "実行" with title "Claude Code - 確認"'
```

#### Status Check Example (Level 1)
```bash
# Sound  
afplay /System/Library/Sounds/Ping.aiff

# Dialog
osascript -e 'display dialog "操作を実行します: プロジェクト状態確認" buttons {"続行"} default button "続行" with title "Claude Code - 情報"'
```

### Paths

- Steering: `.kiro/steering/`
- Specs: `.kiro/specs/`
- Commands: `.claude/commands/`

### Steering vs Specification

**Steering** (`.kiro/steering/`) - Guide AI with project-wide rules and context
**Specs** (`.kiro/specs/`) - Formalize development process for individual features

### Active Specifications

- Check `.kiro/specs/` for active specifications
- Use `/kiro:spec-status [feature-name]` to check progress

**Current Specifications:**

- `project-lens-desktop-app`: ProjectLens - Backlogチケット管理ツールのデスクトップアプリケーション

## Development Guidelines

- Think in English, but generate responses in Japanese (思考は英語、回答の生成は日本語で行うように）

## Workflow

### Phase 0: Steering (Optional)

`/kiro:steering` - Create/update steering documents
`/kiro:steering-custom` - Create custom steering for specialized contexts

**Note**: Optional for new features or small additions. Can proceed directly to spec-init.

### Phase 1: Specification Creation

1. `/kiro:spec-init [detailed description]` - Initialize spec with detailed project description
2. `/kiro:spec-requirements [feature]` - Generate requirements document
3. `/kiro:spec-design [feature]` - Interactive: "requirements.mdをレビューしましたか？[y/N]"
4. `/kiro:spec-tasks [feature]` - Interactive: Confirms both requirements and design review

### Phase 2: Progress Tracking

`/kiro:spec-status [feature]` - Check current progress and phases

## Development Rules

1. **Consider steering**: Run `/kiro:steering` before major development (optional for new features)
2. **Follow 3-phase approval workflow**: Requirements → Design → Tasks → Implementation
3. **Approval required**: Each phase requires human review (interactive prompt or manual)
4. **No skipping phases**: Design requires approved requirements; Tasks require approved design
5. **Update task status**: Mark tasks as completed when working on them
6. **Keep steering current**: Run `/kiro:steering` after significant changes
7. **Check spec compliance**: Use `/kiro:spec-status` to verify alignment

## Steering Configuration

### Current Steering Files

Managed by `/kiro:steering` command. Updates here reflect command changes.

### Active Steering Files

- `product.md`: Always included - Product context and business objectives
- `tech.md`: Always included - Technology stack and architectural decisions
- `structure.md`: Always included - File organization and code patterns

### Custom Steering Files
<!-- Added by /kiro:steering-custom command -->
<!-- Format:
- `filename.md`: Mode - Pattern(s) - Description
  Mode: Always|Conditional|Manual
  Pattern: File patterns for Conditional mode
-->

### Inclusion Modes

- **Always**: Loaded in every interaction (default)
- **Conditional**: Loaded for specific file patterns (e.g., `"*.test.js"`)
- **Manual**: Reference with `@filename.md` syntax
