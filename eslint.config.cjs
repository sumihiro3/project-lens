const nuxt = require('@nuxt/eslint-config').default
const tseslint = require('@typescript-eslint/eslint-plugin')
const tsParser = require('@typescript-eslint/parser')
const prettierRecommended = require('eslint-plugin-prettier/recommended')

// ESLint 9 フラットコンフィグ。旧 .eslintrc.cjs + .eslintignore から移行。
// @nuxt/eslint-config(Vue/import/Nuxt)・@typescript-eslint/recommended・
// prettier/recommended を合成し、末尾でカスタムルールを上書きする。
// nuxt() は非同期で Promise を返すため、設定全体を Promise として export する
// (ESLint 9 は非同期フラットコンフィグをサポートする)。
module.exports = (async () => {
  const nuxtConfigs = await nuxt()

  return [
    {
      // 旧 .eslintignore の置き換え
      ignores: [
        'node_modules/**',
        'dist/**',
        '.nuxt/**',
        '.output/**',
        '**/*.log',
        '**/.DS_Store',
        'src-tauri/**',
        // ワークフロー実行ランナー専用の DSL スクリプト(独自実行コンテキストで
        // トップレベル return を使うためアプリの lint 対象外)
        '.claude/**',
      ],
    },
    ...nuxtConfigs,
    // TS recommended は .ts のみに適用する。
    // .vue に適用すると TS パーサーが vue-eslint-parser を上書きし、
    // テンプレート部のパースが壊れるため除外する。
    ...tseslint.configs['flat/recommended'].map(config => ({
      ...config,
      files: ['**/*.ts'],
    })),
    // .vue の <script lang="ts"> を TS パーサーで解釈させる(vue-eslint-parser 配下)
    {
      files: ['**/*.vue'],
      languageOptions: {
        parserOptions: {
          parser: tsParser,
        },
      },
    },
    prettierRecommended,
    {
      rules: {
        'vue/multi-word-component-names': 'off',
        'prettier/prettier': 'warn',
      },
    },
    {
      files: ['**/*.ts', '**/*.vue'],
      plugins: { '@typescript-eslint': tseslint },
      rules: {
        // TS の no-unused-vars を使うため、コア no-unused-vars は無効化する
        // (旧 .eslintrc は @typescript-eslint/recommended 経由でこれを行っていた)
        'no-unused-vars': 'off',
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      },
    },
  ]
})()
