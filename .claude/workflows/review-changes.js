export const meta = {
  name: 'review-changes',
  description:
    '差分を4次元(バグ/性能/アーキ規約/i18n)で並列レビューし、敵対的検証を通った所見のみ報告',
  whenToUse:
    '実装後の差分レビュー。args: {base: "main"} で比較先ブランチを指定(省略時は main)。未コミット変更も含めてレビューする',
  phases: [
    { title: 'レビュー', detail: '4次元の並列レビュー', model: 'opus' },
    { title: '検証', detail: '所見ごとの敵対的検証', model: 'sonnet' },
  ],
}

// モデル使い分けの方針: 複雑なレビュー = opus / 敵対的検証 = sonnet

// args は JSON 文字列で渡ってくる場合があるためパースする
let input = args
if (typeof input === 'string') {
  try {
    input = JSON.parse(input)
  } catch (e) {
    input = { base: input }
  }
}
input = input || {}

const base = input.base || 'main'
const DIFF = `リポジトリは /opt/dev/ProjectLens。レビュー対象は「${base} との差分 + 未コミットの変更」。git diff ${base}... と git status / git diff で対象を確認すること。`

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'file', 'detail', 'severity'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string', description: 'file:line 形式' },
          detail: { type: 'string', description: '問題の内容と根拠' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['isReal', 'reason'],
  properties: {
    isReal: { type: 'boolean', description: '実在する問題なら true' },
    reason: { type: 'string' },
  },
}

const DIMENSIONS = [
  {
    key: 'bugs',
    prompt: `${DIFF}\n正確性のレビュー: ロジックバグ、エラーハンドリング漏れ、境界条件、async/await の誤用、Rust の unwrap/expect 乱用を探してください。確信度の高いものだけ報告すること。`,
  },
  {
    key: 'perf',
    prompt: `${DIFF}\n性能のレビュー: 不要な再レンダリング、N+1 的な API/DB アクセス、大きなデータの無駄なクローン、バックグラウンド処理のブロッキングを探してください。実害のあるものだけ報告すること。`,
  },
  {
    key: 'arch',
    prompt: `${DIFF}\nアーキテクチャ規約のレビュー: docs/ARCHITECTURE.md と docs/COMPONENT_RULES.md を読み、規約違反(モジュール単一責任、コンポーネント行数目安、命名規則、Rust 公開関数の日本語ドキュメントコメント、Props/Emits 型定義、docs/COMPONENTS.md の更新漏れ)を探してください。`,
  },
  {
    key: 'i18n',
    prompt: `${DIFF}\ni18n のレビュー: UI 文言のハードコード(src/locales/{ja,en}.json を経由していない)、ja/en のキー不整合、片方の言語にしかないキーを探してください。`,
  },
]

phase('レビュー')
const results = await pipeline(
  DIMENSIONS,
  d =>
    agent(d.prompt, {
      label: `review:${d.key}`,
      phase: 'レビュー',
      schema: FINDINGS_SCHEMA,
      model: 'opus',
    }),
  (review, d) =>
    parallel(
      review.findings.map(
        f => () =>
          agent(
            `リポジトリ /opt/dev/ProjectLens で次のレビュー所見を敵対的に検証してください。コードを実際に読み、所見が誤りである可能性を積極的に探すこと。誤検出と思われる場合や再現根拠が弱い場合は isReal: false にすること。\n\n## 所見(${d.key})\n${f.title}\n対象: ${f.file}\n${f.detail}`,
            { label: `verify:${f.file}`, phase: '検証', schema: VERDICT_SCHEMA, model: 'sonnet' }
          ).then(v => ({ ...f, dimension: d.key, verdict: v }))
      )
    )
)

const confirmed = results
  .filter(Boolean)
  .flat()
  .filter(Boolean)
  .filter(f => f.verdict && f.verdict.isReal)

log(`確定所見: ${confirmed.length} 件`)

return {
  confirmed: confirmed.map(f => ({
    dimension: f.dimension,
    severity: f.severity,
    title: f.title,
    file: f.file,
    detail: f.detail,
    verifiedReason: f.verdict.reason,
  })),
  summary:
    confirmed.length === 0
      ? '確定した所見はありません'
      : `severity 順に対応を検討してください(${confirmed.length} 件)`,
}
