<template>
  <v-container>
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-btn icon="mdi-arrow-left" @click="$router.push('/')" class="mr-2"></v-btn>
        Settings
      </v-card-title>
      <v-card-text>
        <v-form @submit.prevent="saveSettings">
          <v-text-field v-model="domain" label="Domain (e.g., example.backlog.com)" required></v-text-field>
          <v-text-field v-model="apiKey" label="API Key" type="password" required></v-text-field>
          
          <v-autocomplete
            v-model="projectKeys"
            :items="availableProjects"
            item-title="name"
            item-value="key"
            label="Project Keys"
            multiple
            chips
            closable-chips
            hint="Select up to 5 projects"
            persistent-hint
            :rules="[v => v.length <= 5 || 'Maximum 5 projects allowed']"
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
          
          <v-btn type="submit" color="primary" :loading="saving" class="mt-4">Save Settings</v-btn>
        </v-form>

        <v-divider class="my-4"></v-divider>

        <v-btn color="secondary" @click="syncIssues" :loading="syncing">Sync Issues Now</v-btn>
        
        <v-alert v-if="message" :type="messageType" class="mt-4" closable>{{ message }}</v-alert>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'

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
    message.value = `Failed to load projects: ${e}`
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
      message.value = 'Maximum 5 projects allowed'
      messageType.value = 'error'
      return
    }
    
    await invoke('save_settings', { key: 'domain', value: domain.value })
    await invoke('save_settings', { key: 'api_key', value: apiKey.value })
    
    // 配列をカンマ区切り文字列に変換して保存
    const keysString = projectKeys.value.join(',')
    await invoke('save_settings', { key: 'project_key', value: keysString })
    
    message.value = 'Settings saved successfully'
    messageType.value = 'success'
  } catch (e) {
    message.value = `Error saving settings: ${e}`
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
    message.value = `Synced ${count} issues successfully`
    messageType.value = 'success'
  } catch (e) {
    message.value = `Error syncing issues: ${e}`
    messageType.value = 'error'
  } finally {
    syncing.value = false
  }
}
</script>
