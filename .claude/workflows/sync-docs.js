export const meta = {
  name: 'sync-docs',
  description: '実装差分を docs/・README(英日)・Obsidian Vault の project overview に同期する',
  whenToUse:
    '実装・レビュー完了後のドキュメント同期。args: {base: "main", release: "v0.2"} で差分の比較先と対象リリースを指定(いずれも省略可)',
  phases: [
    { title: '差分把握', detail: '変更内容の要約', model: 'sonnet' },
    { title: '同期', detail: 'docs / README / Vault を並列更新', model: 'sonnet/haiku' },
  ],
}

// モデル使い分けの方針: ドキュメント化 = sonnet / 軽量な更新(Vault overview) = haiku

// args は JSON 文字列で渡ってくる場合があるためパースする
let input = args
if (typeof input === 'string') {
  try {
    input = JSON.parse(input)
  } catch (e) {
    input = {}
  }
}
input = input || {}

const base = input.base || 'main'
const release = input.release || ''
const REPO = 'リポジトリは /opt/dev/ProjectLens。'

phase('差分把握')
const diffSummary = await agent(
  `${REPO}git diff ${base}... と git status / git diff(未コミット分)を確認し、今回の変更内容を要約してください: 追加・変更されたコンポーネント/モジュール/コマンド、ユーザーに見える変更、開発環境の変更(ツール・依存関係)。ドキュメント更新の判断材料になる粒度で。${release ? `対象リリース: ${release}` : ''}`,
  { label: '差分要約', phase: '差分把握', model: 'sonnet' }
)

phase('同期')
const updates = await parallel([
  () =>
    agent(
      `${REPO}以下の変更要約をもとに docs/ を実装に同期してください。対象: docs/COMPONENTS.md(コンポーネント・モジュール・コマンドの追加変更)、docs/ARCHITECTURE.md(構成や規約に影響する変更のみ)、docs/REQUIREMENTS.md(リリースのステータス変化のみ)。乖離がなければ変更しないこと。各ファイルの役割ヘッダーの記述レベルに合わせること。\n\n## 変更要約\n${diffSummary}`,
      { label: 'docs更新', phase: '同期', model: 'sonnet' }
    ),
  () =>
    agent(
      `${REPO}以下の変更要約をもとに README.md(英語)と README_JP.md(日本語)を同期してください。ユーザーに見える機能変更・セットアップ手順の変更(パッケージマネージャ等)のみ反映し、両言語で内容を一致させること。乖離がなければ変更しないこと。\n\n## 変更要約\n${diffSummary}`,
      { label: 'README更新', phase: '同期', model: 'sonnet' }
    ),
  () =>
    agent(
      `Obsidian Vault のプロジェクトノート /Users/sumihiro/SumihiroObsidianVault/Projects/ProjectLens/overview.md を更新してください。手順: 1) 現在の overview.md を読む 2) frontmatter と既存構成を保ったまま、以下の変更要約をもとに「現状」「直近の作業」に相当するセクションを更新する(なければ「## 直近の作業」セクションを作る)。日付(\`date +%F\` で取得)とリリース番号${release ? `(${release})` : ''}を明記する 3) 過去の記載は消さず、古くなった記述のみ更新する。ファイルへの書き込みは Edit/Write ツールを使うこと。\n\n## 変更要約\n${diffSummary}`,
      { label: 'Vault更新', phase: '同期', model: 'haiku' }
    ),
])

return {
  diffSummary,
  docs: updates[0],
  readme: updates[1],
  vault: updates[2],
}
