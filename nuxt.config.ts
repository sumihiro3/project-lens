// https://nuxt.com/docs/api/configuration/nuxt-config
import { defineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
  srcDir: 'src/',

  // Modules
  modules: [
    '@nuxtjs/i18n',
    ['@nuxt/eslint', {
    config: {
      stylistic: true,
    },
  }], ['@pinia/nuxt', {
    storesDirs: ['./stores/**'],
  }], '@vueuse/nuxt'],
  ssr: false,
  devtools: { enabled: true },

  // Electron optimization
  app: {
    baseURL: './',
  },

  // CSS framework
  css: [
    'vuetify/lib/styles/main.sass',
    '@mdi/font/css/materialdesignicons.css',
  ],

  // Build configuration
  build: {
    transpile: ['vuetify'],
  },

  nitro: {
    preset: 'static',
    experimental: {
      wasm: true,
    },
  },

  // Vite configuration
  vite: {
    define: {
      'process.env.DEBUG': false,
    },
    ssr: {
      noExternal: ['vuetify'],
    },
    build: {
      rollupOptions: {
        external: [],
      },
    },
  },

  // TypeScript configuration
  typescript: {
    strict: true,
    typeCheck: true,
  },

})
