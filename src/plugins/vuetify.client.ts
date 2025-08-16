import { createVuetify } from 'vuetify'
import { aliases, mdi } from 'vuetify/iconsets/mdi'
import { ja, en } from 'vuetify/locale'
import { defineNuxtPlugin, type NuxtApp } from 'nuxt/app'

// パフォーマンス最適化: 必要なコンポーネントのみをインポート
// 全てのコンポーネントを一度にインポートする代わりに、遅延ローディングを使用
import {
  // レイアウトコンポーネント
  VApp,
  VMain,
  VContainer,
  VRow,
  VCol,
  VDivider,
  VSpacer,

  // ナビゲーション
  VNavigationDrawer,
  VAppBar,
  VAppBarTitle,
  VToolbar,
  VToolbarTitle,
  VToolbarItems,

  // ボタンとフォーム
  VBtn,
  VBtnGroup,
  VBtnToggle,
  VCard,
  VCardText,
  VCardTitle,
  VCardActions,
  VTextField,
  VTextarea,
  VSelect,
  VCheckbox,
  VRadio,
  VRadioGroup,
  VSwitch,

  // リスト
  VList,
  VListItem,
  VListItemTitle,
  VListItemSubtitle,
  VListItemAction,

  // 表示コンポーネント
  VIcon,
  VAvatar,
  VChip,
  VBadge,
  VAlert,
  VProgressLinear,
  VProgressCircular,

  // ダイアログ
  VDialog,
  VMenu,
  VTooltip,
  VSnackbar,

  // データ表示
  VDataTable,
  VDataTableServer,
  VPagination,

  // エキスパンション パネル
  VExpansionPanels,
  VExpansionPanel,
  VExpansionPanelTitle,
  VExpansionPanelText,
  VCardSubtitle,
} from 'vuetify/components'

// 必要なディレクティブのみをインポート
import {
  Ripple,
  Resize,
  Intersect,
  ClickOutside,
} from 'vuetify/directives'

// 使用するコンポーネントとディレクティブを定義
const components = {
  VApp,
  VMain,
  VContainer,
  VRow,
  VCol,
  VDivider,
  VSpacer,
  VNavigationDrawer,
  VAppBar,
  VToolbar,
  VToolbarTitle,
  VToolbarItems,
  VBtn,
  VBtnGroup,
  VBtnToggle,
  VCard,
  VCardText,
  VCardTitle,
  VCardActions,
  VTextField,
  VTextarea,
  VSelect,
  VCheckbox,
  VRadio,
  VRadioGroup,
  VSwitch,
  VList,
  VListItem,
  VListItemTitle,
  VListItemSubtitle,
  VListItemAction,
  VIcon,
  VAvatar,
  VChip,
  VBadge,
  VAlert,
  VProgressLinear,
  VProgressCircular,
  VDialog,
  VMenu,
  VTooltip,
  VSnackbar,
  VDataTable,
  VDataTableServer,
  VPagination,
  VExpansionPanels,
  VExpansionPanel,
  VExpansionPanelTitle,
  VExpansionPanelText,
  VCardSubtitle,
  VAppBarTitle,
}

const directives = {
  Ripple,
  Resize,
  Intersect,
  ClickOutside,
}

// 追加コンポーネントの動的ローディング用ヘルパー
export const loadVuetifyComponent = async (componentName: string) => {
  try {
    const component = await import(/* @vite-ignore */ `vuetify/components/${componentName}`)
    return component
  }
  catch (error) {
    console.warn(`Vuetifyコンポーネント ${componentName} の動的ローディングに失敗しました:`, error)
    return null
  }
}

export default defineNuxtPlugin((nuxtApp: NuxtApp) => {
  const vuetify = createVuetify({
    components,
    directives,

    // パフォーマンス最適化設定
    defaults: {
      global: {
        // リップルエフェクトを最適化
        ripple: {
          class: 'v-ripple--optimized',
        },
      },
      // 個別コンポーネントの最適化
      VCard: {
        flat: true, // デフォルトで影を無効化
      },
      VBtn: {
        color: 'primary',
      },
      VDataTable: {
        // データテーブルの最適化
        density: 'compact',
        showSelect: false,
      },
    },

    theme: {
      defaultTheme: 'light',
      // テーマの最適化: 使用しないCSS変数を削減
      variations: {
        colors: ['primary', 'secondary'],
        lighten: 1,
        darken: 1,
      },
      themes: {
        light: {
          dark: false,
          colors: {
            'primary': '#1976D2',
            'secondary': '#424242',
            'accent': '#82B1FF',
            'error': '#FF5252',
            'info': '#2196F3',
            'success': '#4CAF50',
            'warning': '#FFC107',
            // 必要最小限の色定義
            'background': '#FFFFFF',
            'surface': '#FFFFFF',
            'on-primary': '#FFFFFF',
            'on-secondary': '#FFFFFF',
            'on-surface': '#000000',
          },
        },
        dark: {
          dark: true,
          colors: {
            'primary': '#2196F3',
            'secondary': '#424242',
            'accent': '#FF4081',
            'error': '#FF5252',
            'info': '#2196F3',
            'success': '#4CAF50',
            'warning': '#FB8C00',
            'background': '#121212',
            'surface': '#212121',
            'on-primary': '#000000',
            'on-secondary': '#FFFFFF',
            'on-surface': '#FFFFFF',
          },
        },
      },
    },

    // アイコン設定の最適化 - SVGアイコンを使用
    icons: {
      defaultSet: 'mdi',
      aliases,
      sets: {
        mdi,
      },
    },

    // ロケール設定の最適化
    locale: {
      locale: 'ja',
      fallback: 'en',
      messages: { ja, en },
    },

    // 表示オプションの最適化
    display: {
      mobileBreakpoint: 'sm',
      thresholds: {
        xs: 0,
        sm: 600,
        md: 960,
        lg: 1280,
        xl: 1920,
      },
    },
  })

  nuxtApp.vueApp.use(vuetify)

  // 開発時のパフォーマンス警告
  if (process.env.NODE_ENV === 'development') {
    console.log('🎨 Vuetify (最適化版) が初期化されました')
    console.log('📦 登録済みコンポーネント数:', Object.keys(components).length)
    console.log('🎯 登録済みディレクティブ数:', Object.keys(directives).length)
  }
})
