import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  // スキーマファイルの場所
  schema: './electron/main/database/schema/*.ts',
  // マイグレーションファイルの出力先
  out: './drizzle',
  // データベースドライバー
  dialect: 'sqlite',
  // データベースファイルのパス（開発時）
  dbCredentials: {
    url: './dev-database.sqlite3',
  },
  // マイグレーション設定
  verbose: true,
  strict: true,
})
