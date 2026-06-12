export const meta = {
  name: 'release-check',
  description: 'リリース前検査: lint / format / clippy / 生成ビルドを並列実行して失敗を集約報告',
  whenToUse: 'コミット・リリース前の最終検査。修正はせず検査結果の報告のみ行う',
  phases: [{ title: '検査', detail: '5種の検査を並列実行', model: 'haiku' }],
}

// モデル使い分けの方針: コマンド実行と結果報告のみの軽量タスク = haiku

const CHECK_SCHEMA = {
  type: 'object',
  required: ['check', 'passed', 'detail'],
  properties: {
    check: { type: 'string' },
    passed: { type: 'boolean' },
    detail: { type: 'string', description: '成功時は一言、失敗時はエラーの要点(該当箇所つき)' },
  },
}

const CHECKS = [
  { key: 'lint', cmd: 'pnpm run lint' },
  { key: 'format', cmd: 'pnpm run format:check' },
  { key: 'clippy', cmd: 'pnpm run lint:rust' },
  { key: 'rustfmt', cmd: 'pnpm run format:rust:check' },
  { key: 'generate', cmd: 'pnpm run generate' },
]

phase('検査')
const results = await parallel(
  CHECKS.map(
    c => () =>
      agent(
        `リポジトリ /opt/dev/ProjectLens で \`${c.cmd}\` を実行し、結果を報告してください。失敗しても修正せず、check="${c.key}" として成否とエラーの要点(ファイル:行)のみ返すこと。`,
        { label: c.key, phase: '検査', schema: CHECK_SCHEMA, model: 'haiku' }
      )
  )
)

const checks = results.filter(Boolean)
const failed = checks.filter(c => !c.passed)
log(failed.length === 0 ? '全検査パス' : `${failed.length} 件の検査が失敗`)

return {
  passed: failed.length === 0,
  results: checks,
  failed,
}
