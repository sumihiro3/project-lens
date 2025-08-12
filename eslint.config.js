import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  rules: {
    // TypeScript関連のルール
    '@typescript-eslint/no-unused-vars': 'warn',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-non-null-assertion': 'warn',
    '@typescript-eslint/no-var-requires': 'error',
    // '@typescript-eslint/consistent-type-imports': 'error', // 型情報が必要
    '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],

    // Vue.js関連のルール
    'vue/multi-word-component-names': 'off',
    'vue/no-multiple-template-root': 'off',
    'vue/no-unused-vars': 'warn',
    'vue/no-v-html': 'warn',

    // 一般的なJavaScript/TypeScriptルール
    'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    'no-alert': 'warn',
    'no-var': 'error',
    'prefer-const': 'error',
    'prefer-arrow-callback': 'error',
    'arrow-spacing': 'error',
    'comma-dangle': 'off', // Prettierに任せる
    'semi': 'off', // Prettierに任せる
    'quotes': 'off', // Prettierに任せる
    'indent': 'off', // Prettierに任せる

    // パフォーマンス関連のルール
    'vue/no-async-in-computed-properties': 'error',
    'vue/no-side-effects-in-computed-properties': 'error',
    'vue/return-in-computed-property': 'error',
  },

  // グローバル設定
  languageOptions: {
    globals: {
      // Electron関連のグローバル変数
      electronAPI: 'readonly',
      // Node.js関連
      process: 'readonly',
      global: 'readonly',
      Buffer: 'readonly',
    },
  },

  // 除外するファイル
  ignores: [
    'dist/**',
    'dist-electron/**',
    '.nuxt/**',
    '.output/**',
    'node_modules/**',
    'coverage/**',
    '*.min.js',
    'public/**',
    'scripts/**', // scriptsディレクトリ全体を除外
    '.performance/**', // パフォーマンス測定結果を除外
    '*.tsbuildinfo', // TypeScriptビルド情報ファイルを除外
  ],
})
