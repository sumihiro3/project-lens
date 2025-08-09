// https://nuxt.com/docs/api/configuration/nuxt-config
import { defineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
  devtools: { enabled: true },
  ssr: false,
  
  // Electron optimization
  app: {
    baseURL: './'
  },
  
  nitro: {
    preset: 'static'
  },
  
  // CSS framework
  css: [
    'vuetify/lib/styles/main.sass',
    '@mdi/font/css/materialdesignicons.css'
  ],
  
  // Build configuration
  build: {
    transpile: ['vuetify']
  },
  
  // Modules
  modules: [
    ['@nuxt/eslint', {
      config: {
        stylistic: true
      }
    }],
    ['@pinia/nuxt', {
      storesDirs: ['./stores/**']
    }],
    '@vueuse/nuxt'
    // '@nuxtjs/i18n'  // Temporarily disabled for testing
  ],
  
  // i18n configuration (temporarily disabled)
  // i18n: {
  //   locales: [
  //     { code: 'en', language: 'en-US', name: 'English', file: 'en.json' },
  //     { code: 'ja', language: 'ja-JP', name: '日本語', file: 'ja.json' }
  //   ],
  //   defaultLocale: 'ja',
  //   langDir: 'locales/',
  //   strategy: 'no_prefix'
  // },
  
  // Vite configuration
  vite: {
    define: {
      'process.env.DEBUG': false
    },
    ssr: {
      noExternal: ['vuetify']
    }
  },
  
  // TypeScript configuration
  typescript: {
    strict: true,
    typeCheck: true
  },
  
})