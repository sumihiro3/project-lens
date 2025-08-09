# 多言語化実装例

## Nuxt I18n設定

### nuxt.config.ts

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: [
    '@nuxtjs/i18n',
    '@nuxtjs/pug'
  ],
  
  // Pug設定
  pug: {
    // Pugのコンパイルオプション
    compileDebug: process.env.NODE_ENV === 'development',
    pretty: process.env.NODE_ENV === 'development',
    // Pugのグローバル変数設定
    globals: ['require'],
    // Pugファイルの拡張子設定
    extensions: ['.pug']
  },
  
  // Vite設定でPugサポートを有効化
  vite: {
    vue: {
      template: {
        // Pugテンプレートエンジンの有効化
        preprocessors: {
          pug: 'pug'
        }
      }
    }
  },
  
  i18n: {
    locales: [
      {
        code: 'ja',
        file: 'ja/index.ts',
        name: '日本語'
      },
      {
        code: 'en',
        file: 'en/index.ts',
        name: 'English'
      }
    ],
    defaultLocale: 'ja',
    lazy: true,
    langDir: 'locales/',
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'i18n_redirected',
      redirectOn: 'root',
      alwaysRedirect: false,
      fallbackLocale: 'ja'
    },
    strategy: 'no_prefix'
  }
})
```

### Electronとの統合

```typescript
// composables/useI18n.ts
export const useProjectLensI18n = () => {
  const { locale, locales, t, n, d, setLocale } = useI18n()
  const settingsService = inject<SettingsService>('settingsService')
  
  // システム言語検出
  const detectSystemLocale = async (): Promise<string> => {
    if (process.client && window.electronAPI) {
      try {
        const systemLocale = await window.electronAPI.getSystemLocale()
        const normalizedLocale = systemLocale.split('-')[0].toLowerCase()
        return normalizedLocale === 'ja' ? 'ja' : 'en'
      } catch (error) {
        console.warn('Failed to detect system locale:', error)
      }
    }
    return navigator.language.split('-')[0] === 'ja' ? 'ja' : 'en'
  }
  
  // 初期化
  const initialize = async (): Promise<void> => {
    try {
      // ユーザー設定の言語を取得
      const settings = await settingsService?.get()
      const userLocale = settings?.language
      
      if (userLocale && ['ja', 'en'].includes(userLocale)) {
        await setLocale(userLocale)
        return
      }
      
      // システム言語検出
      const systemLocale = await detectSystemLocale()
      await setLocale(systemLocale)
      
    } catch (error) {
      console.warn('Failed to initialize locale:', error)
      await setLocale('ja') // フォールバック
    }
  }
  
  // 言語切り替え
  const switchLocale = async (newLocale: string): Promise<void> => {
    if (!['ja', 'en'].includes(newLocale)) {
      throw new Error(`Unsupported locale: ${newLocale}`)
    }
    
    try {
      await setLocale(newLocale)
      // ユーザー設定に保存
      await settingsService?.update({ language: newLocale })
    } catch (error) {
      console.error('Failed to switch locale:', error)
      throw error
    }
  }
  
  return {
    locale: readonly(locale),
    locales: readonly(locales),
    t,
    n,
    d,
    initialize,
    switchLocale,
    detectSystemLocale
  }
}
```

### プラグイン設定

```typescript
// plugins/i18n.client.ts
export default defineNuxtPlugin(async () => {
  const { initialize } = useProjectLensI18n()
  
  // アプリケーション開始時に言語を初期化
  await initialize()
})
```

## 翻訳ファイル例

### 日本語翻訳ファイル

```typescript
// locales/ja/index.ts
export default {
  app: {
    name: 'ProjectLens',
    description: 'Backlogチケット管理ツール'
  },
  
  actions: {
    save: '保存',
    cancel: 'キャンセル',
    delete: '削除',
    edit: '編集',
    refresh: '更新',
    sync: '同期',
    search: '検索',
    filter: 'フィルター',
    sort: '並び替え',
    add_space: 'スペース追加',
    test_connection: '接続テスト'
  },
  
  status: {
    loading: '読み込み中...',
    saving: '保存中...',
    syncing: '同期中...',
    complete: '完了',
    error: 'エラー',
    offline: 'オフライン',
    connecting: '接続中...',
    reconnecting: '再接続中...'
  },
  
  navigation: {
    dashboard: 'ダッシュボード',
    issues: 'チケット',
    settings: '設定',
    help: 'ヘルプ',
    about: 'アプリについて'
  },
  
  issues: {
    title: 'チケット一覧',
    no_issues: 'チケットがありません',
    loading_issues: 'チケットを読み込んでいます...',
    priority: {
      critical: '緊急',
      important: '重要',
      normal: '通常'
    },
    status: {
      open: '未対応',
      in_progress: '対応中',
      resolved: '解決済み',
      closed: '完了'
    },
    fields: {
      assignee: '担当者',
      due_date: '期限',
      created_date: '作成日',
      updated_date: '更新日',
      project: 'プロジェクト',
      milestone: 'マイルストーン'
    },
    actions: {
      view_details: '詳細を見る',
      mark_complete: '完了にする',
      assign_to_me: '自分に割り当て'
    }
  },
  
  settings: {
    title: '設定',
    general: '一般',
    spaces: 'スペース',
    notifications: '通知',
    ai: 'AI設定',
    language: '言語',
    theme: 'テーマ',
    current_language: '現在の言語: {language}',
    
    // 一般設定
    auto_start: 'システム起動時に自動開始',
    minimize_to_tray: 'トレイに最小化',
    check_updates: '自動更新確認',
    
    // スペース設定
    no_spaces: 'スペースが設定されていません',
    no_spaces_description: 'Backlogスペースを追加してチケットの監視を開始してください',
    add_space: 'スペース追加',
    space_name: 'スペース名',
    space_domain: 'ドメイン',
    api_key: 'APIキー',
    space_added: 'スペースが追加されました',
    space_deleted: 'スペースが削除されました',
    
    // 通知設定
    enable_notifications: '通知を有効にする',
    notification_sound: '通知音を再生',
    notification_priority: '通知する優先度',
    
    // AI設定
    enable_ai: 'AI機能を有効にする',
    ai_provider: 'AIプロバイダー',
    summary_length: '要約の長さ',
    local_ai: 'ローカルAI',
    
    // 保存確認
    saved_successfully: '設定が保存されました',
    save_failed: '設定の保存に失敗しました'
  },
  
  ai: {
    summary: 'AI要約',
    advice: 'AIアドバイス',
    generating: '生成中...',
    no_summary: '要約がありません',
    no_advice: 'アドバイスがありません',
    summary_error: '要約の生成に失敗しました',
    advice_error: 'アドバイスの生成に失敗しました'
  },
  
  notifications: {
    critical_issue: '緊急チケットが見つかりました',
    important_issues: '{count}件の重要なチケットがあります',
    sync_complete: '同期が完了しました',
    connection_lost: '接続が切断されました',
    connection_restored: '接続が復旧しました',
    fallback_mode: '制限モードで動作中です'
  },
  
  errors: {
    network: {
      connection_failed: '接続に失敗しました',
      timeout: '接続がタイムアウトしました',
      offline: 'オフラインです'
    },
    api: {
      authentication_failed: '認証に失敗しました',
      rate_limit_exceeded: 'レート制限を超過しました',
      server_error: 'サーバーエラーが発生しました'
    },
    validation: {
      required_field: 'このフィールドは必須です',
      invalid_url: '有効なURLを入力してください',
      invalid_api_key: '有効なAPIキーを入力してください'
    },
    general: {
      unknown_error: '不明なエラーが発生しました',
      try_again: 'もう一度お試しください',
      contact_support: 'サポートにお問い合わせください'
    }
  },
  
  fallback: {
    modes: {
      direct_api: '直接API接続',
      cached_data: 'キャッシュデータ',
      offline_mode: 'オフラインモード',
      local_ai: 'ローカルAI'
    },
    messages: {
      direct_api: '一部機能が制限されていますが、基本的な操作は継続できます',
      cached_data: 'オフラインデータを表示しています。最新情報は同期後に確認してください',
      offline_mode: 'オフラインモードです。接続復旧後に自動同期されます',
      local_ai: 'AI機能が制限モードで動作しています'
    },
    actions: {
      show_details: '詳細を表示',
      retry_connection: '再接続を試行',
      dismiss: '閉じる'
    }
  },
  
  time: {
    now: 'たった今',
    minutes_ago: '{count}分前',
    hours_ago: '{count}時間前',
    days_ago: '{count}日前',
    weeks_ago: '{count}週間前',
    months_ago: '{count}ヶ月前'
  }
}
```

### 英語翻訳ファイル

```typescript
// locales/en/index.ts
export default {
  app: {
    name: 'ProjectLens',
    description: 'Backlog Ticket Management Tool'
  },
  
  actions: {
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    refresh: 'Refresh',
    sync: 'Sync',
    search: 'Search',
    filter: 'Filter',
    sort: 'Sort',
    add_space: 'Add Space',
    test_connection: 'Test Connection'
  },
  
  status: {
    loading: 'Loading...',
    saving: 'Saving...',
    syncing: 'Syncing...',
    complete: 'Complete',
    error: 'Error',
    offline: 'Offline',
    connecting: 'Connecting...',
    reconnecting: 'Reconnecting...'
  },
  
  navigation: {
    dashboard: 'Dashboard',
    issues: 'Issues',
    settings: 'Settings',
    help: 'Help',
    about: 'About'
  },
  
  issues: {
    title: 'Issues',
    no_issues: 'No issues found',
    loading_issues: 'Loading issues...',
    priority: {
      critical: 'Critical',
      important: 'Important',
      normal: 'Normal'
    },
    status: {
      open: 'Open',
      in_progress: 'In Progress',
      resolved: 'Resolved',
      closed: 'Closed'
    },
    fields: {
      assignee: 'Assignee',
      due_date: 'Due Date',
      created_date: 'Created',
      updated_date: 'Updated',
      project: 'Project',
      milestone: 'Milestone'
    },
    actions: {
      view_details: 'View Details',
      mark_complete: 'Mark Complete',
      assign_to_me: 'Assign to Me'
    }
  },
  
  settings: {
    title: 'Settings',
    general: 'General',
    spaces: 'Spaces',
    notifications: 'Notifications',
    ai: 'AI Settings',
    language: 'Language',
    theme: 'Theme',
    current_language: 'Current language: {language}',
    
    // General settings
    auto_start: 'Start on system startup',
    minimize_to_tray: 'Minimize to tray',
    check_updates: 'Check for updates automatically',
    
    // Space settings
    no_spaces: 'No spaces configured',
    no_spaces_description: 'Add a Backlog space to start monitoring tickets',
    add_space: 'Add Space',
    space_name: 'Space Name',
    space_domain: 'Domain',
    api_key: 'API Key',
    space_added: 'Space has been added',
    space_deleted: 'Space has been deleted',
    
    // Notification settings
    enable_notifications: 'Enable notifications',
    notification_sound: 'Play notification sound',
    notification_priority: 'Notification priority',
    
    // AI settings
    enable_ai: 'Enable AI features',
    ai_provider: 'AI Provider',
    summary_length: 'Summary Length',
    local_ai: 'Local AI',
    
    // Save confirmation
    saved_successfully: 'Settings saved successfully',
    save_failed: 'Failed to save settings'
  },
  
  ai: {
    summary: 'AI Summary',
    advice: 'AI Advice',
    generating: 'Generating...',
    no_summary: 'No summary available',
    no_advice: 'No advice available',
    summary_error: 'Failed to generate summary',
    advice_error: 'Failed to generate advice'
  },
  
  notifications: {
    critical_issue: 'Critical issue found',
    important_issues: '{count} important issues found',
    sync_complete: 'Sync completed',
    connection_lost: 'Connection lost',
    connection_restored: 'Connection restored',
    fallback_mode: 'Running in fallback mode'
  },
  
  errors: {
    network: {
      connection_failed: 'Connection failed',
      timeout: 'Connection timeout',
      offline: 'You are offline'
    },
    api: {
      authentication_failed: 'Authentication failed',
      rate_limit_exceeded: 'Rate limit exceeded',
      server_error: 'Server error occurred'
    },
    validation: {
      required_field: 'This field is required',
      invalid_url: 'Please enter a valid URL',
      invalid_api_key: 'Please enter a valid API key'
    },
    general: {
      unknown_error: 'An unknown error occurred',
      try_again: 'Please try again',
      contact_support: 'Please contact support'
    }
  },
  
  fallback: {
    modes: {
      direct_api: 'Direct API',
      cached_data: 'Cached Data',
      offline_mode: 'Offline Mode',
      local_ai: 'Local AI'
    },
    messages: {
      direct_api: 'Some features are limited, but basic operations continue to work',
      cached_data: 'Displaying cached data. Latest information will be available after sync',
      offline_mode: 'Offline mode. Will sync automatically when connection is restored',
      local_ai: 'AI features are running in limited mode'
    },
    actions: {
      show_details: 'Show Details',
      retry_connection: 'Retry Connection',
      dismiss: 'Dismiss'
    }
  },
  
  time: {
    now: 'just now',
    minutes_ago: '{count} minutes ago',
    hours_ago: '{count} hours ago',
    days_ago: '{count} days ago',
    weeks_ago: '{count} weeks ago',
    months_ago: '{count} months ago'
  }
}
```

## テンプレートでの使用例

### Pugテンプレートでの多言語化

```vue
<template lang="pug">
v-app
  v-app-bar(color="primary" dark)
    v-app-bar-title {{ $t('app.name') }}
    v-spacer
    language-selector(
      :model-value="$i18n.locale"
      @update:model-value="switchLanguage"
    )
  
  v-main
    v-container
      v-row
        v-col
          h1.text-h4.mb-4 {{ $t('issues.title') }}
          
          // ローディング状態
          v-progress-linear(
            v-if="pending"
            indeterminate
            color="primary"
          )
          
          // エラー状態
          v-alert(
            v-if="error"
            type="error"
            :text="$t('errors.network.connection_failed')"
            class="mb-4"
          )
          
          // チケット一覧
          v-card(v-if="issues && issues.length > 0")
            v-list
              v-list-item(
                v-for="issue in issues"
                :key="issue.id"
              )
                v-list-item-title {{ issue.summary }}
                v-list-item-subtitle {{ $t('issues.fields.assignee') }}: {{ issue.assignee?.name || $t('status.loading') }}
                
                template(#append)
                  v-chip(
                    :color="getPriorityColor(issue.priority)"
                    size="small"
                  ) {{ $t(`issues.priority.${issue.priority}`) }}
          
          // 空の状態
          v-empty-state(
            v-else-if="!pending"
            icon="mdi-ticket-outline"
            :title="$t('issues.no_issues')"
          )
</template>

<script setup lang="ts">
const { t, locale } = useI18n()
const { switchLocale } = useProjectLensI18n()

// データ取得
const { data: issues, pending, error } = await useLazyFetch('/api/issues')

const switchLanguage = async (newLocale: string) => {
  await switchLocale(newLocale)
}

const getPriorityColor = (priority: string) => {
  const colors = {
    critical: 'red',
    important: 'orange',
    normal: 'grey'
  }
  return colors[priority] || 'grey'
}

// メタ情報の多言語化
useSeoMeta({
  title: computed(() => t('app.name')),
  description: computed(() => t('app.description'))
})
</script>
```

### 日時フォーマットの多言語対応

```typescript
// composables/useDateTime.ts
export const useDateTime = () => {
  const { locale, d, n } = useI18n()
  
  const formatDate = (date: Date | string | null): string => {
    if (!date) return ''
    
    const dateObj = typeof date === 'string' ? new Date(date) : date
    return d(dateObj, 'short')
  }
  
  const formatDateTime = (date: Date | string | null): string => {
    if (!date) return ''
    
    const dateObj = typeof date === 'string' ? new Date(date) : date
    return d(dateObj, 'long')
  }
  
  const formatRelativeTime = (date: Date | string): string => {
    const now = new Date()
    const dateObj = typeof date === 'string' ? new Date(date) : date
    const diffMs = now.getTime() - dateObj.getTime()
    
    const diffMinutes = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    const diffWeeks = Math.floor(diffDays / 7)
    const diffMonths = Math.floor(diffDays / 30)
    
    if (diffMinutes < 1) return t('time.now')
    if (diffMinutes < 60) return t('time.minutes_ago', { count: diffMinutes })
    if (diffHours < 24) return t('time.hours_ago', { count: diffHours })
    if (diffDays < 7) return t('time.days_ago', { count: diffDays })
    if (diffWeeks < 4) return t('time.weeks_ago', { count: diffWeeks })
    return t('time.months_ago', { count: diffMonths })
  }
  
  return {
    formatDate,
    formatDateTime,
    formatRelativeTime
  }
}
```