// https://nuxt.com/docs/api/configuration/nuxt-config
import { defineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({

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
  srcDir: 'src/',

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
    vue: {
      template: {
        preprocessOptions: {
          pug: {
            pretty: true,
          },
        },
      },
    },
  },

  // TypeScript configuration
  typescript: {
    strict: true,
    typeCheck: true,
  },

})
