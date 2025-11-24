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
          <v-text-field v-model="projectKey" label="Project Key (e.g., PROJ)" required></v-text-field>
          
          <v-btn type="submit" color="primary" :loading="saving">Save Settings</v-btn>
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
const projectKey = ref('')
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
    if (p) projectKey.value = p
  } catch (e) {
    console.error(e)
  }
})

async function saveSettings() {
  saving.value = true
  message.value = ''
  try {
    await invoke('save_settings', { key: 'domain', value: domain.value })
    await invoke('save_settings', { key: 'api_key', value: apiKey.value })
    await invoke('save_settings', { key: 'project_key', value: projectKey.value })
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
