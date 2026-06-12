export const meta = {
  name: 'qa-app',
  description: 'アプリを起動してスモークテストを行い、起動・同期・エラーの所見を報告する',
  whenToUse:
    '実装後にアプリが実際に動くことを確認したいとき。ビルド検証だけなら release-check を使う',
  phases: [{ title: 'スモークテスト', detail: 'tauri:dev 起動と動作観察', model: 'sonnet' }],
}

// モデル使い分けの方針: テスト実施 = sonnet

phase('スモークテスト')
const report = await agent(
  `リポジトリ /opt/dev/ProjectLens でアプリのスモークテストを実施し、所見を報告してください。

手順:
1. \`pnpm run tauri:dev\` をバックグラウンドで起動する(generate に数十秒、cargo ビルドに数分かかることがある)
2. 出力を監視し、以下を確認する:
   - Nuxt generate が成功するか
   - cargo build / 起動が成功するか
   - 起動後のログにエラー・panic・unwrap 失敗がないか
   - スケジューラーの初回同期(起動10秒後)のログが流れるか(ワークスペース未設定なら "No workspaces configured" で正常)
3. 3分程度観察したらプロセスを終了する(起動した tauri:dev のプロセスを kill する。他のプロセスは殺さないこと)
4. 所見を報告する: 起動成否 / 確認できた挙動 / エラー・警告(該当ログの抜粋つき) / 気になった点

アプリの GUI 操作はできないため、ログベースの確認に徹すること。`,
  { label: 'スモークテスト', phase: 'スモークテスト', model: 'sonnet' }
)

return { report }
