// https://nuxt.com/docs/api/configuration/nuxt-config
import vuetify, { transformAssetUrls } from 'vite-plugin-vuetify'
export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },
  ssr: false,
  srcDir: 'src/',
  build: {
    transpile: ['vuetify'],
  },
  modules: [
    (_options, nuxt) => {
      nuxt.hooks.hook('vite:extendConfig', config => {
        // @ts-expect-error vite-plugin-vuetify の型が Nuxt の plugins 型と一致しないため
        config.plugins.push(vuetify({ autoImport: true }))
      })
    },
    '@nuxtjs/i18n',
  ],
  i18n: {
    locales: [
      { code: 'en', name: 'English', file: 'en.json' },
      { code: 'ja', name: '日本語', file: 'ja.json' },
    ],
    langDir: '../src/locales',
    defaultLocale: 'ja',
    strategy: 'no_prefix',
  },
  vite: {
    vue: {
      template: {
        transformAssetUrls,
      },
    },
  },
})
