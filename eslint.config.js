import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  rules: {
    // Customize rules here
    '@typescript-eslint/no-unused-vars': 'warn',
    'vue/multi-word-component-names': 'off',
    'vue/no-multiple-template-root': 'off'
  }
})