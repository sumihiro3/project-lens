export const meta = {
  name: 'implement-feature',
  description: 'リリース要件を入力に、探索→設計→実装→検証を行う機能実装パイプライン',
  whenToUse:
    '確定済み要件 (docs/releases/vX.Y/requirements.md) を実装するとき。args: {release: "v0.2"} でリリース指定、または {task: "..."} で単発タスク指定。スコープを絞る場合は {scope: "..."} を併用',
  phases: [
    { title: '探索', detail: '要件と関連コードの並列調査', model: 'haiku/sonnet' },
    { title: '設計', detail: '実装計画と作業項目への分解', model: 'opus' },
    { title: '実装', detail: '作業項目を順に実装(ファイル競合を避けるため逐次)', model: 'sonnet' },
    { title: '検証', detail: 'lint / format / clippy / generate の実行', model: 'haiku' },
  ],
}

// モデル使い分けの方針: 要件・設計 = opus / 実装・ドキュメント = sonnet / 軽量タスク = haiku

// args は JSON 文字列で渡ってくる場合があるためパースする
let input = args
if (typeof input === 'string') {
  try {
    input = JSON.parse(input)
  } catch (e) {
    input = { task: input }
  }
}
input = input || {}

const release = input.release
const taskDesc = input.task || ''
const scope = input.scope || ''
if (!release && !taskDesc) {
  throw new Error('args.release(例: {release: "v0.2"})または args.task を指定してください')
}
const reqPath = release ? `docs/releases/${release}/requirements.md` : null
const target = reqPath
  ? `要件ファイル ${reqPath}${scope ? `(今回のスコープ: ${scope})` : ''}`
  : `タスク: ${taskDesc}`

const RULES =
  'リポジトリは /opt/dev/ProjectLens。CLAUDE.md と docs/ARCHITECTURE.md・docs/COMPONENT_RULES.md の規約に従うこと。'

phase('探索')
const [reqSummary, codeMap] = await parallel([
  () =>
    agent(
      `${RULES}\n${target} と CLAUDE.md を読み、実装すべき要件の要点を返してください: 機能要件(受け入れ基準つき)、スコープ外、未解決事項。原文の構造を保ち簡潔に。`,
      { label: '要件読込', phase: '探索', model: 'haiku' }
    ),
  () =>
    agent(
      `${RULES}\n${target} に関連する既存コードを調査してください。docs/COMPONENTS.md を入口に、関連ファイルパス、既存パターン(composables / Tauri コマンド / db / scheduler)、再利用できる実装、変更が必要になりそうな箇所を報告してください。`,
      { label: 'コード調査', phase: '探索', agentType: 'Explore', model: 'sonnet' }
    ),
])

phase('設計')
const DESIGN_SCHEMA = {
  type: 'object',
  required: ['summary', 'items'],
  properties: {
    summary: { type: 'string', description: '実装方針の要約' },
    items: {
      type: 'array',
      description: '実装順に並べた作業項目',
      items: {
        type: 'object',
        required: ['title', 'description', 'files', 'complex'],
        properties: {
          title: { type: 'string' },
          description: { type: 'string', description: '変更内容と完了条件' },
          files: { type: 'array', items: { type: 'string' }, description: '触る予定のファイル' },
          complex: {
            type: 'boolean',
            description:
              '設計判断やロジックの新規実装を伴う複雑な項目なら true(高性能モデルを割り当てる)。機械的な置換・設定変更なら false',
          },
        },
      },
    },
  },
}
const design = await agent(
  `${RULES}\n以下の要件と現状調査をもとに実装計画を設計し、実装順に並べた作業項目に分解してください。各項目は独立して検証できる粒度にすること。\n\n## 要件\n${reqSummary}\n\n## 現状調査\n${codeMap}`,
  { label: '設計', phase: '設計', schema: DESIGN_SCHEMA, model: 'opus' }
)
log(`設計完了: ${design.items.length} 作業項目`)

phase('実装')
const results = []
for (let i = 0; i < design.items.length; i++) {
  const item = design.items[i]
  log(`実装 ${i + 1}/${design.items.length}: ${item.title}`)
  const r = await agent(
    `${RULES}\n次の作業項目を実装してください。実装後、変更したファイル一覧と判断に迷った点を報告してください。docs/COMPONENTS.md の更新が必要な変更(コンポーネント・コマンド追加など)はこの場で更新してください。\n\n## 実装方針(全体)\n${design.summary}\n\n## 作業項目\n${item.title}\n${item.description}\n対象ファイル目安: ${item.files.join(', ')}\n\n## 要件(参照用)\n${reqSummary}`,
    { label: `実装: ${item.title}`, phase: '実装', model: item.complex ? 'opus' : 'sonnet' }
  )
  results.push({ item: item.title, report: r })
}

phase('検証')
const verify = await agent(
  `リポジトリ /opt/dev/ProjectLens で次の検証コマンドを順に実行し、それぞれの成否と失敗時の要点を報告してください。失敗があっても自分で修正せず、報告のみ行うこと:\n1. pnpm run lint\n2. pnpm run format:check\n3. pnpm run lint:rust\n4. pnpm run format:rust:check\n5. pnpm run generate`,
  { label: '検証', phase: '検証', model: 'haiku' }
)

return {
  design: design.summary,
  implemented: results.map(r => r.item),
  reports: results,
  verification: verify,
  next: 'review-changes ワークフローで差分レビューを実施してください',
}
