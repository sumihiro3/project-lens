# コンポーネント実装例

## IssueCard コンポーネント

### Pugテンプレートベース実装

```vue
<template lang="pug">
v-card.issue-card.elevation-2(
  :class="priorityClass"
  :loading="loading"
  @click="$emit('click', issue)"
)
  v-card-title.d-flex.align-center
    v-icon.mr-2(:color="priorityColor" size="small") {{ priorityIcon }}
    span.text-subtitle-1.font-weight-medium {{ issue.key }}
    v-spacer
    v-chip.ml-2(
      :color="statusColor"
      size="small"
      variant="flat"
    ) {{ $t(`issues.status.${status}`) }}

  v-card-text
    h3.issue-summary.text-h6.mb-2 {{ issue.summary }}
    p.issue-description.text-body-2.text-medium-emphasis(
      v-if="issue.description"
    ) {{ truncatedDescription }}

  v-card-actions.pt-0
    .d-flex.align-center.w-100
      .assignee-info(v-if="issue.assignee")
        v-avatar.mr-2(size="24")
          v-img(
            :src="issue.assignee.iconUrl"
            :alt="issue.assignee.name"
          )
        span.text-caption {{ issue.assignee.name }}
      v-spacer
      .due-date-info(v-if="issue.dueDate")
        v-icon.mr-1(
          :color="dueDateColor"
          size="small"
        ) mdi-calendar-clock
        span.text-caption(:class="dueDateClass") {{ formattedDueDate }}

  // AI要約表示
  v-expand-transition
    v-card-text.pt-0(v-if="showAISummary && aiSummary")
      v-alert.ai-summary(
        type="info"
        variant="tonal"
        density="compact"
      )
        template(#prepend)
          v-icon mdi-robot
        .text-caption
          strong {{ $t('ai.summary') }}:
          | {{ aiSummary.content }}
</template>

<script setup lang="ts">
interface Props {
  issue: Issue
  loading?: boolean
  showAISummary?: boolean
}

interface Emits {
  (event: 'click', issue: Issue): void
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  showAISummary: false
})

const emit = defineEmits<Emits>()

const { t, d } = useI18n()

// AI要約データの取得
const { data: aiSummary } = await useLazyFetch<Summary>(
  `/api/ai/summary/${props.issue.id}`,
  {
    server: false,
    default: () => null
  }
)

// 優先度に基づくスタイリング
const priorityClass = computed(() => ({
  'issue-card--critical': props.issue.priority === 'critical',
  'issue-card--important': props.issue.priority === 'important',
  'issue-card--normal': props.issue.priority === 'normal'
}))

const priorityColor = computed(() => {
  const colors = {
    critical: 'red',
    important: 'orange',
    normal: 'grey'
  }
  return colors[props.issue.priority] || 'grey'
})

const priorityIcon = computed(() => {
  const icons = {
    critical: 'mdi-alert-circle',
    important: 'mdi-alert',
    normal: 'mdi-information-outline'
  }
  return icons[props.issue.priority] || 'mdi-information-outline'
})

// ステータスカラー
const statusColor = computed(() => {
  const colors = {
    open: 'blue',
    in_progress: 'orange',
    resolved: 'green',
    closed: 'grey'
  }
  return colors[props.issue.status] || 'grey'
})

const status = computed(() => {
  const statusMap = {
    1: 'open',
    2: 'in_progress',
    3: 'in_progress',
    4: 'resolved'
  }
  return statusMap[props.issue.statusId] || 'open'
})

// 説明文の切り詰め
const truncatedDescription = computed(() => {
  const maxLength = 120
  if (!props.issue.description) return ''
  return props.issue.description.length > maxLength
    ? `${props.issue.description.slice(0, maxLength)}...`
    : props.issue.description
})

// 期限日の表示
const formattedDueDate = computed(() => {
  if (!props.issue.dueDate) return ''
  return d(props.issue.dueDate, 'short')
})

const dueDateColor = computed(() => {
  if (!props.issue.dueDate) return 'grey'
  
  const now = new Date()
  const dueDate = new Date(props.issue.dueDate)
  const diffDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  
  if (diffDays < 0) return 'red'      // 過去
  if (diffDays <= 1) return 'orange'  // 明日まで
  if (diffDays <= 3) return 'yellow'  // 3日以内
  return 'grey'
})

const dueDateClass = computed(() => ({
  'text-red': dueDateColor.value === 'red',
  'text-orange': dueDateColor.value === 'orange',
  'text-yellow-darken-2': dueDateColor.value === 'yellow'
}))
</script>

<style scoped lang="scss">
.issue-card {
  cursor: pointer;
  transition: all 0.2s ease-in-out;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.1);
  }

  &--critical {
    border-left: 4px solid rgb(var(--v-theme-error));
  }

  &--important {
    border-left: 4px solid rgb(var(--v-theme-warning));
  }

  &--normal {
    border-left: 4px solid rgb(var(--v-theme-info));
  }
}

.issue-summary {
  line-height: 1.3;
}

.issue-description {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  line-height: 1.4;
}

.assignee-info,
.due-date-info {
  display: flex;
  align-items: center;
}

.ai-summary {
  margin-top: 8px;
  
  .v-alert__content {
    font-size: 0.75rem;
  }
}
</style>
```

## SettingsDialog コンポーネント

### モーダル形式の設定画面

```vue
<template lang="pug">
v-dialog.settings-dialog(
  v-model="dialog"
  max-width="800"
  persistent
  scrollable
)
  template(#activator="{ props: activatorProps }")
    v-btn(
      v-bind="activatorProps"
      icon
      variant="text"
    )
      v-icon mdi-cog
      v-tooltip(activator="parent") {{ $t('settings.title') }}

  v-card.elevation-8
    v-card-title.d-flex.align-center.pa-6.bg-primary.text-white
      v-icon.mr-3 mdi-cog
      span {{ $t('settings.title') }}
      v-spacer
      v-btn(
        icon
        variant="text"
        @click="closeDialog"
      )
        v-icon mdi-close

    v-card-text.pa-0
      v-row(no-gutters)
        // サイドナビゲーション
        v-col(cols="3")
          v-list.settings-nav(density="compact" nav)
            v-list-item(
              v-for="section in settingSections"
              :key="section.key"
              :active="activeSection === section.key"
              :prepend-icon="section.icon"
              @click="activeSection = section.key"
            )
              v-list-item-title {{ $t(section.title) }}

        // 設定コンテンツ
        v-col(cols="9")
          v-container.settings-content.pa-6
            // 一般設定
            v-card.mb-6(v-show="activeSection === 'general'" flat)
              v-card-title {{ $t('settings.general') }}
              v-card-text
                v-row
                  v-col(cols="12")
                    language-selector(
                      v-model="settings.language"
                      @update:model-value="updateLanguage"
                    )
                  v-col(cols="12")
                    v-switch(
                      v-model="settings.autoStart"
                      :label="$t('settings.auto_start')"
                      color="primary"
                    )
                  v-col(cols="12")
                    v-switch(
                      v-model="settings.minimizeToTray"
                      :label="$t('settings.minimize_to_tray')"
                      color="primary"
                    )

            // スペース設定
            v-card.mb-6(v-show="activeSection === 'spaces'" flat)
              v-card-title.d-flex.align-center
                span {{ $t('settings.spaces') }}
                v-spacer
                v-btn(
                  color="primary"
                  prepend-icon="mdi-plus"
                  @click="showAddSpaceDialog = true"
                ) {{ $t('actions.add_space') }}

              v-card-text
                v-list(v-if="spaces.length > 0")
                  v-list-item(
                    v-for="space in spaces"
                    :key="space.id"
                  )
                    template(#prepend)
                      v-avatar(color="primary")
                        v-icon mdi-view-dashboard
                    
                    v-list-item-title {{ space.name }}
                    v-list-item-subtitle {{ space.domain }}
                    
                    template(#append)
                      v-btn(
                        icon
                        variant="text"
                        size="small"
                        @click="editSpace(space)"
                      )
                        v-icon mdi-pencil
                      v-btn(
                        icon
                        variant="text"
                        size="small"
                        color="error"
                        @click="deleteSpace(space.id)"
                      )
                        v-icon mdi-delete
                v-empty-state(
                  v-else
                  icon="mdi-view-dashboard-outline"
                  :title="$t('settings.no_spaces')"
                  :text="$t('settings.no_spaces_description')"
                )

            // 通知設定
            v-card.mb-6(v-show="activeSection === 'notifications'" flat)
              v-card-title {{ $t('settings.notifications') }}
              v-card-text
                v-row
                  v-col(cols="12")
                    v-switch(
                      v-model="settings.notifications.enabled"
                      :label="$t('settings.enable_notifications')"
                      color="primary"
                    )
                  v-col(cols="12")
                    v-switch(
                      v-model="settings.notifications.sound"
                      :label="$t('settings.notification_sound')"
                      :disabled="!settings.notifications.enabled"
                      color="primary"
                    )
                  v-col(cols="12")
                    v-select(
                      v-model="settings.notifications.priority"
                      :items="priorityOptions"
                      :label="$t('settings.notification_priority')"
                      :disabled="!settings.notifications.enabled"
                    )

            // AI設定
            v-card(v-show="activeSection === 'ai'" flat)
              v-card-title {{ $t('settings.ai') }}
              v-card-text
                v-row
                  v-col(cols="12")
                    v-switch(
                      v-model="settings.ai.enabled"
                      :label="$t('settings.enable_ai')"
                      color="primary"
                    )
                  v-col(cols="12")
                    v-select(
                      v-model="settings.ai.provider"
                      :items="aiProviders"
                      :label="$t('settings.ai_provider')"
                      :disabled="!settings.ai.enabled"
                    )
                  v-col(cols="12")
                    v-slider(
                      v-model="settings.ai.summaryLength"
                      :min="50"
                      :max="300"
                      :step="50"
                      :label="$t('settings.summary_length')"
                      :disabled="!settings.ai.enabled"
                      thumb-label
                    )

    v-card-actions.pa-6
      v-spacer
      v-btn(
        variant="text"
        @click="closeDialog"
      ) {{ $t('actions.cancel') }}
      v-btn(
        color="primary"
        :loading="saving"
        @click="saveSettings"
      ) {{ $t('actions.save') }}

// スペース追加ダイアログ
space-add-dialog(
  v-model="showAddSpaceDialog"
  @added="handleSpaceAdded"
)
</template>

<script setup lang="ts">
interface Settings {
  language: string
  autoStart: boolean
  minimizeToTray: boolean
  notifications: {
    enabled: boolean
    sound: boolean
    priority: string
  }
  ai: {
    enabled: boolean
    provider: string
    summaryLength: number
  }
}

const dialog = ref(false)
const activeSection = ref('general')
const saving = ref(false)
const showAddSpaceDialog = ref(false)

const { t } = useI18n()
const settingsService = inject<SettingsService>('settingsService')
const spaceService = inject<SpaceService>('spaceService')

// 設定データの取得
const { data: settings, refresh: refreshSettings } = await useLazyAsyncData<Settings>(
  'settings',
  () => settingsService.get()
)

// スペースデータの取得
const { data: spaces, refresh: refreshSpaces } = await useLazyAsyncData(
  'spaces',
  () => spaceService.getAll()
)

const settingSections = [
  { key: 'general', title: 'settings.general', icon: 'mdi-cog' },
  { key: 'spaces', title: 'settings.spaces', icon: 'mdi-view-dashboard' },
  { key: 'notifications', title: 'settings.notifications', icon: 'mdi-bell' },
  { key: 'ai', title: 'settings.ai', icon: 'mdi-robot' }
]

const priorityOptions = [
  { title: t('issues.priority.critical'), value: 'critical' },
  { title: t('issues.priority.important'), value: 'important' },
  { title: t('issues.priority.normal'), value: 'normal' }
]

const aiProviders = [
  { title: 'OpenAI GPT-4', value: 'openai' },
  { title: 'Claude (Anthropic)', value: 'anthropic' },
  { title: 'Gemini (Google)', value: 'google' },
  { title: t('settings.local_ai'), value: 'local' }
]

const closeDialog = () => {
  dialog.value = false
  activeSection.value = 'general'
}

const updateLanguage = async (newLanguage: string) => {
  const { switchLocale } = useProjectLensI18n()
  await switchLocale(newLanguage)
}

const saveSettings = async () => {
  if (!settings.value) return

  saving.value = true
  try {
    await settingsService.update(settings.value)
    await refreshSettings()
    
    // 成功通知
    $toast.success(t('settings.saved_successfully'))
    closeDialog()
  } catch (error) {
    console.error('Settings save failed:', error)
    $toast.error(t('errors.save_failed'))
  } finally {
    saving.value = false
  }
}

const editSpace = (space: Space) => {
  // スペース編集処理
  console.log('Edit space:', space)
}

const deleteSpace = async (spaceId: string) => {
  try {
    await spaceService.delete(spaceId)
    await refreshSpaces()
    $toast.success(t('settings.space_deleted'))
  } catch (error) {
    console.error('Space delete failed:', error)
    $toast.error(t('errors.delete_failed'))
  }
}

const handleSpaceAdded = () => {
  showAddSpaceDialog.value = false
  refreshSpaces()
}
</script>

<style scoped lang="scss">
.settings-dialog {
  .v-card {
    min-height: 600px;
  }
}

.settings-nav {
  border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  min-height: 500px;
}

.settings-content {
  max-height: 500px;
  overflow-y: auto;
}
</style>
```

## LanguageSelector コンポーネント

### 言語切り替えUI

```vue
<template lang="pug">
v-select.language-selector(
  :model-value="modelValue"
  :items="languageOptions"
  :label="$t('settings.language')"
  prepend-inner-icon="mdi-translate"
  variant="outlined"
  density="comfortable"
  @update:model-value="$emit('update:modelValue', $event)"
)
  template(#item="{ props, item }")
    v-list-item(v-bind="props")
      template(#prepend)
        v-avatar.mr-2(size="24")
          span.flag-emoji {{ item.raw.flag }}
      v-list-item-title {{ item.raw.name }}
      v-list-item-subtitle {{ item.raw.nativeName }}

  template(#selection="{ item }")
    .d-flex.align-center
      v-avatar.mr-2(size="20")
        span.flag-emoji {{ item.raw.flag }}
      span {{ item.raw.name }}
</template>

<script setup lang="ts">
interface Props {
  modelValue: string
}

interface Emits {
  (event: 'update:modelValue', value: string): void
}

defineProps<Props>()
defineEmits<Emits>()

const languageOptions = [
  {
    value: 'ja',
    name: '日本語',
    nativeName: 'Japanese',
    flag: '🇯🇵'
  },
  {
    value: 'en',
    name: 'English',
    nativeName: 'English',
    flag: '🇺🇸'
  }
]
</script>

<style scoped lang="scss">
.flag-emoji {
  font-size: 16px;
  line-height: 1;
}
</style>
```

## NotificationToast コンポーネント

### システム通知UI

```vue
<template lang="pug">
teleport(to="body")
  v-snackbar.notification-toast(
    v-model="show"
    :timeout="timeout"
    :color="color"
    :location="location"
    :multi-line="multiLine"
    elevation="8"
  )
    .d-flex.align-center
      v-icon.mr-3(v-if="icon" :color="iconColor") {{ icon }}
      .flex-grow-1
        .notification-title(v-if="title") {{ title }}
        .notification-message {{ message }}
      v-btn(
        v-if="action"
        :color="actionColor"
        variant="text"
        size="small"
        @click="handleAction"
      ) {{ action.label }}
      v-btn(
        icon
        variant="text"
        size="small"
        @click="close"
      )
        v-icon mdi-close
</template>

<script setup lang="ts">
interface Props {
  modelValue: boolean
  type?: 'success' | 'error' | 'warning' | 'info'
  title?: string
  message: string
  timeout?: number
  action?: {
    label: string
    handler: () => void
  }
  location?: 'top' | 'bottom'
}

interface Emits {
  (event: 'update:modelValue', value: boolean): void
  (event: 'close'): void
}

const props = withDefaults(defineProps<Props>(), {
  type: 'info',
  timeout: 5000,
  location: 'top'
})

const emit = defineEmits<Emits>()

const show = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const color = computed(() => {
  const colors = {
    success: 'success',
    error: 'error',
    warning: 'warning',
    info: 'info'
  }
  return colors[props.type]
})

const icon = computed(() => {
  const icons = {
    success: 'mdi-check-circle',
    error: 'mdi-alert-circle',
    warning: 'mdi-alert',
    info: 'mdi-information'
  }
  return icons[props.type]
})

const iconColor = computed(() => {
  return props.type === 'error' ? 'white' : undefined
})

const actionColor = computed(() => {
  return props.type === 'error' ? 'white' : 'primary'
})

const multiLine = computed(() => {
  return Boolean(props.title) || props.message.length > 50
})

const close = () => {
  show.value = false
  emit('close')
}

const handleAction = () => {
  if (props.action?.handler) {
    props.action.handler()
  }
  close()
}
</script>

<style scoped lang="scss">
.notification-toast {
  .notification-title {
    font-weight: 600;
    font-size: 0.875rem;
    margin-bottom: 4px;
  }

  .notification-message {
    font-size: 0.875rem;
    line-height: 1.4;
  }
}
</style>
```