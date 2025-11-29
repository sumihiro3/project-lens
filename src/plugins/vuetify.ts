import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

export default defineNuxtPlugin((nuxtApp) => {
  const vuetify = createVuetify({
    ssr: false,
    components,
    directives,
    theme: {
      defaultTheme: 'system',
      themes: {
        light: {
          dark: false,
          colors: {
            primary: '#2C9A7A',
            secondary: '#F4F5F7',
            accent: '#E83929',
            surface: '#FFFFFF',
            background: '#FFFFFF',
            error: '#E83929',
          },
        },
        dark: {
          dark: true,
          colors: {
            primary: '#4DB699',
            secondary: '#262626',
            accent: '#FF6B6B',
            surface: '#333333',
            background: '#121212',
            error: '#FF6B6B',
          },
        },
      },
    },
  })
  nuxtApp.vueApp.use(vuetify)
})
