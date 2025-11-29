import en from './locales/en.json'
import ja from './locales/ja.json'

console.log('i18n config loaded')

export default defineI18nConfig(() => ({
  legacy: false,
  locale: 'ja',
  fallbackLocale: 'ja',
  messages: {
    en,
    ja
  }
}))
