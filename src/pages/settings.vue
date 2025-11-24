<template>
  <v-container>
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-btn icon="mdi-arrow-left" @click="$router.push('/')" class="mr-2"></v-btn>
        {{ $t('settings.title') }}
      </v-card-title>
      <v-card-text>
        <v-form @submit.prevent="saveSettings">
          <v-select
            v-model="locale"
            :items="availableLocales"
            item-title="name"
            item-value="code"
            :label="$t('settings.language')"
            class="mb-4"
          ></v-select>

          <v-text-field v-model="domain" :label="$t('settings.domain')" required></v-text-field>
          <v-text-field v-model="apiKey" :label="$t('settings.apiKey')" type="password" required></v-text-field>
          
          <v-autocomplete
            v-model="projectKeys"
            :items="availableProjects"
            item-title="name"
            item-value="key"
            :label="$t('settings.projectKeys')"
            multiple
            chips
            closable-chips
            :hint="$t('settings.projectKeysHint')"
            persistent-hint
            :rules="[v => v.length <= 5 || $t('settings.maxProjects')]"
            :loading="loadingProjects"
            required
          >
            <template v-slot:prepend>
              <v-btn 
                icon="mdi-refresh" 
                size="small" 
                variant="text"
                @click="loadProjects"
                :loading="loadingProjects"
              ></v-btn>
            </template>
          </v-autocomplete>
          
          <v-btn type="submit" color="primary" :loading="saving" class="mt-4">{{ $t('settings.save') }}</v-btn>
        </v-form>

        <v-divider class="my-4"></v-divider>

        <v-btn color="secondary" @click="syncIssues" :loading="syncing">{{ $t('settings.syncNow') }}</v-btn>
        
        <v-alert v-if="message" :type="messageType" class="mt-4" closable>{{ message }}</v-alert>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'

const { t, locale, locales, setLocale } = useI18n()
const availableLocales = computed(() => {
  return (locales.value as any[]).map(i => ({
    name: i.name,
    code: i.code
  }))
})

// Watch for locale changes and call setLocale
watch(locale, async (newLocale) => {
  await setLocale(newLocale)
})

const domain = ref('')
const apiKey = ref('')
const projectKeys = ref<string[]>([])
const availableProjects = ref<{ key: string; name: string }[]>([])
const loadingProjects = ref(false)
const saving = ref(false)
const syncing = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')

onMounted(async () => {
  try {
    const d = await invoke<string | null>('get_settings', { key: 'domain' })
    const k = await invoke<string | null>('get_settings', { key: 'api_key' })
    const p = await invoke<string | null>('get_settings', { key: 'project_key' })
    if (d) domain.value = d
    if (k) apiKey.value = k
    if (p) {
      // カンマ区切り文字列を配列に変換
      projectKeys.value = p.split(',').map(k => k.trim()).filter(k => k.length > 0)
    }
    
    // プロジェクト一覧を読み込み
    if (d && k) {
      await loadProjects()
    }
  } catch (e) {
    console.error(e)
  }
})

async function loadProjects() {
  loadingProjects.value = true
  try {
    const projects = await invoke<[string, string][]>('fetch_projects')
    availableProjects.value = projects.map(([key, name]) => ({ key, name: `${key} - ${name}` }))
  } catch (e) {
    console.error('Failed to load projects:', e)
    message.value = t('settings.loadProjectsError', { error: e })
    messageType.value = 'error'
  } finally {
    loadingProjects.value = false
  }
}

async function saveSettings() {
  saving.value = true
  message.value = ''
  try {
    // プロジェクト数の検証
    if (projectKeys.value.length > 5) {
      message.value = t('settings.maxProjects')
      messageType.value = 'error'
      return
    }
    
    await invoke('save_settings', { key: 'domain', value: domain.value })
    await invoke('save_settings', { key: 'api_key', value: apiKey.value })
    
    // 配列をカンマ区切り文字列に変換して保存
    const keysString = projectKeys.value.join(',')
    await invoke('save_settings', { key: 'project_key', value: keysString })
    
    message.value = t('settings.saved')
    messageType.value = 'success'
  } catch (e) {
    message.value = t('settings.errorSaving', { error: e })
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

async function syncIssues() {
  syncing.value = true
  message.value = ''
  try {
    const count = await invoke<number>('fetch_issues')
    message.value = t('settings.synced', { count })
    messageType.value = 'success'
  } catch (e) {
    message.value = t('settings.errorSyncing', { error: e })
    messageType.value = 'error'
  } finally {
    syncing.value = false
  }
}
</script>
