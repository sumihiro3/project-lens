/**
 * Prettier設定
 */

module.exports = {
  // 基本設定
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: false,
  singleQuote: true,
  quoteProps: 'as-needed',
  trailingComma: 'none',
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: 'avoid',
  endOfLine: 'lf',

  // Vue.js固有の設定
  vueIndentScriptAndStyle: false,

  // HTML設定
  htmlWhitespaceSensitivity: 'css',

  // Markdown設定
  proseWrap: 'preserve',

  // ファイルタイプ別のオーバーライド
  overrides: [
    {
      files: ['*.json', '*.jsonc'],
      options: {
        printWidth: 80,
        tabWidth: 2,
      },
    },
    {
      files: ['*.yml', '*.yaml'],
      options: {
        tabWidth: 2,
        singleQuote: false,
      },
    },
    {
      files: ['*.md'],
      options: {
        printWidth: 80,
        proseWrap: 'always',
        tabWidth: 2,
      },
    },
    {
      files: ['*.vue'],
      options: {
        printWidth: 100,
        singleQuote: true,
        semi: false,
      },
    },
    {
      files: ['*.ts', '*.tsx'],
      options: {
        printWidth: 100,
        singleQuote: true,
        semi: false,
        trailingComma: 'none',
      },
    },
    {
      files: ['*.js', '*.jsx'],
      options: {
        printWidth: 100,
        singleQuote: true,
        semi: false,
      },
    },
  ],
}
