<template>
  <v-container>
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-btn icon="mdi-arrow-left" @click="$router.push('/')" class="mr-2"></v-btn>
        {{ $t('settings.title') }}
      </v-card-title>
      <v-card-text>
        <!-- Language Settings -->
        <v-select
          v-model="locale"
          :items="availableLocales"
          item-title="name"
          item-value="code"
          :label="$t('settings.language')"
          class="mb-4"
        ></v-select>

        <v-switch
          v-model="showOnlyMyIssues"
          :label="$t('settings.showOnlyMyIssues')"
          color="primary"
          hide-details
          class="mb-4"
        ></v-switch>

        <v-divider class="my-4"></v-divider>

        <!-- Workspaces List -->
        <div class="d-flex align-center justify-space-between mb-2">
          <h3 class="text-h6">{{ $t('settings.workspaces') }}</h3>
          <v-btn color="primary" size="small" prepend-icon="mdi-plus" @click="openDialog()">
            {{ $t('settings.addWorkspace') }}
          </v-btn>
        </div>

        <v-list v-if="workspaces.length > 0" border rounded>
          <template v-for="(ws, index) in workspaces" :key="ws.id">
            <v-list-item :class="{ 'text-grey': !ws.enabled }">
              <template v-slot:prepend>
                <v-avatar :color="ws.enabled ? 'primary' : 'grey'" variant="tonal">
                  <v-icon>mdi-domain</v-icon>
                </v-avatar>
              </template>
              <v-list-item-title class="font-weight-bold">
                {{ ws.domain }}
              </v-list-item-title>
              <v-list-item-subtitle>
                {{ ws.project_keys }}
              </v-list-item-subtitle>
              
              <div v-if="ws.api_limit && ws.api_remaining" class="mt-2 mb-1 pr-16" style="max-width: 90%;">
                <div class="d-flex justify-space-between text-caption mb-1">
                  <span>{{ $t('settings.apiUsage') }}</span>
                  <span>{{ ws.api_remaining }} / {{ ws.api_limit }}</span>
                </div>
                <v-progress-linear
                  :model-value="(ws.api_remaining / ws.api_limit) * 100"
                  :color="getApiUsageColor(ws.api_remaining, ws.api_limit)"
                  height="6"
                  rounded
                ></v-progress-linear>
                <div v-if="ws.api_reset" class="text-caption text-grey text-right mt-1">
                  {{ $t('settings.reset') }}: {{ formatResetTime(ws.api_reset) }}
                </div>
              </div>

              <template v-slot:append>
                <v-switch
                  v-model="ws.enabled"
                  @change="toggleWorkspace(ws)"
                  color="primary"
                  hide-details
                  density="compact"
                  class="mr-2"
                ></v-switch>
                <v-btn icon="mdi-pencil" variant="text" size="small" @click="openDialog(ws)"></v-btn>
                <v-btn icon="mdi-delete" variant="text" color="error" size="small" @click="confirmDelete(ws)"></v-btn>
              </template>
            </v-list-item>
            <v-divider v-if="index < workspaces.length - 1" />
          </template>
        </v-list>
        <v-alert v-else type="info" variant="tonal" class="mb-4">
          {{ $t('dashboard.noIssues') }}
        </v-alert>

        <v-divider class="my-4"></v-divider>

        <!-- Log Files Section -->
        <h3 class="text-h6 mb-2">{{ $t('settings.logFiles') }}</h3>
        <v-card variant="outlined" class="mb-4">
          <v-card-text>
            <div class="d-flex align-center justify-space-between">
              <div>
                <div class="text-caption text-grey">{{ $t('settings.logDirectory') }}</div>
                <div class="text-body-2 font-mono">{{ logDirectory || 'Loading...' }}</div>
              </div>
              <v-btn
                color="primary"
                variant="tonal"
                prepend-icon="mdi-folder-open"
                @click="openLogDir"
                :disabled="!logDirectory"
              >
                {{ $t('settings.openLogDirectory') }}
              </v-btn>
            </div>
          </v-card-text>
        </v-card>

        <v-divider class="my-4"></v-divider>

        <v-btn color="secondary" block @click="syncIssues" :loading="syncing" prepend-icon="mdi-sync">
          {{ $t('settings.syncNow') }}
        </v-btn>
        
        <v-alert v-if="message" :type="messageType" class="mt-4" closable>{{ message }}</v-alert>
      </v-card-text>
    </v-card>

    <!-- Workspace Dialog -->
    <v-dialog v-model="dialog" max-width="600px" persistent>
      <v-card>
        <v-card-title>
          {{ isEditing ? $t('settings.editWorkspace') : $t('settings.addWorkspace') }}
        </v-card-title>
        <v-card-text>
          <v-form @submit.prevent="saveWorkspace" ref="form">
            <v-text-field
              v-model="editedWorkspace.domain"
              :label="$t('settings.domain')"
              required
              :disabled="loadingProjects"
            ></v-text-field>
            <v-text-field
              v-model="editedWorkspace.api_key"
              :label="$t('settings.apiKey')"
              type="password"
              required
              :disabled="loadingProjects"
            ></v-text-field>
            
            <v-autocomplete
              v-model="editedProjectKeys"
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
                  :disabled="!editedWorkspace.domain || !editedWorkspace.api_key"
                  color="primary"
                ></v-btn>
              </template>
            </v-autocomplete>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="grey-darken-1" variant="text" @click="closeDialog">{{ $t('common.close') }}</v-btn>
          <v-btn color="primary" variant="text" @click="saveWorkspace" :loading="saving">
            {{ $t('settings.save') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete Confirmation Dialog -->
    <v-dialog v-model="deleteDialog" max-width="400px">
      <v-card>
        <v-card-title class="text-h6">{{ $t('settings.deleteWorkspace') }}</v-card-title>
        <v-card-text>{{ $t('settings.deleteWorkspaceConfirm') }}</v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="grey-darken-1" variant="text" @click="deleteDialog = false">{{ $t('common.close') }}</v-btn>
          <v-btn color="error" variant="text" @click="executeDelete" :loading="deleting">
            {{ $t('settings.deleteWorkspace') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch, nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useI18n } from 'vue-i18n'

interface Workspace {
  id: number
  domain: string
  api_key: string
  project_keys: string
  user_id?: number
  user_name?: string
  enabled: boolean
  api_limit?: number
  api_remaining?: number
  api_reset?: string
}

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
  // Save language setting to backend to update tray icon tooltip immediately
  try {
    await invoke('save_settings', { key: 'language', value: newLocale })
  } catch (e) {
    console.error('Failed to save language setting:', e)
  }
})

const workspaces = ref<Workspace[]>([])
const dialog = ref(false)
const deleteDialog = ref(false)
const isEditing = ref(false)
const workspaceToDelete = ref<Workspace | null>(null)
const showOnlyMyIssues = ref(false)

const editedWorkspace = ref({
  id: 0,
  domain: '',
  api_key: '',
})
const editedProjectKeys = ref<string[]>([])

const availableProjects = ref<{ key: string; name: string }[]>([])
const loadingProjects = ref(false)
const saving = ref(false)
const deleting = ref(false)
const syncing = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error' | 'info' | 'warning'>('success')
const logDirectory = ref<string>('')

const isInitialized = ref(false)

// Watch for showOnlyMyIssues changes and save
watch(showOnlyMyIssues, async (newValue) => {
  if (!isInitialized.value) return
  
  try {
    await invoke('save_settings', { key: 'show_only_my_issues', value: newValue.toString() })
    // 同期を促すメッセージを表示
    message.value = t('settings.syncRecommended')
    messageType.value = 'info'
  } catch (e) {
    console.error('Failed to save show_only_my_issues setting:', e)
  }
})

onMounted(async () => {
  try {
    const l = await invoke<string | null>('get_settings', { key: 'language' })
    if (l && (l === 'en' || l === 'ja')) {
      locale.value = l as 'en' | 'ja'
    }
    
    const s = await invoke<string | null>('get_settings', { key: 'show_only_my_issues' })
    if (s) {
      showOnlyMyIssues.value = s === 'true'
    }
    
    // ログディレクトリのパスを取得
    try {
      logDirectory.value = await invoke<string>('get_log_directory')
    } catch (e) {
      console.error('Failed to get log directory:', e)
    }
    
    // 初期値設定が完了したら、次の更新サイクルから監視を有効にする
    await nextTick()
    isInitialized.value = true
    
    await loadWorkspaces()
  } catch (e) {
    console.error(e)
  }
})

async function loadWorkspaces() {
  try {
    workspaces.value = await invoke<Workspace[]>('get_workspaces')
  } catch (e) {
    console.error('Failed to load workspaces:', e)
    message.value = `Failed to load workspaces: ${e}`
    messageType.value = 'error'
  }
}

function openDialog(workspace?: Workspace) {
  if (workspace) {
    isEditing.value = true
    editedWorkspace.value = {
      id: workspace.id,
      domain: workspace.domain,
      api_key: workspace.api_key,
    }
    editedProjectKeys.value = workspace.project_keys.split(',').map(k => k.trim()).filter(k => k.length > 0)
    // Try to load projects if we have credentials, to populate the list
    loadProjects()
  } else {
    isEditing.value = false
    editedWorkspace.value = {
      id: 0,
      domain: '',
      api_key: '',
    }
    editedProjectKeys.value = []
    availableProjects.value = []
  }
  dialog.value = true
}

function closeDialog() {
  dialog.value = false
}

async function loadProjects() {
  if (!editedWorkspace.value.domain || !editedWorkspace.value.api_key) return
  
  loadingProjects.value = true
  try {
    const projects = await invoke<[string, string][]>('fetch_projects', {
      domain: editedWorkspace.value.domain,
      apiKey: editedWorkspace.value.api_key
    })
    availableProjects.value = projects.map(([key, name]) => ({ key, name: `${key} - ${name}` }))
  } catch (e) {
    console.error('Failed to load projects:', e)
    message.value = t('settings.loadProjectsError', { error: e })
    messageType.value = 'error'
  } finally {
    loadingProjects.value = false
  }
}

async function saveWorkspace() {
  if (editedProjectKeys.value.length > 5) {
    message.value = t('settings.maxProjects')
    messageType.value = 'error'
    return
  }

  saving.value = true
  message.value = ''
  try {
    await invoke('save_workspace', {
      domain: editedWorkspace.value.domain,
      apiKey: editedWorkspace.value.api_key,
      projectKeys: editedProjectKeys.value
    })
    
    // 保存成功メッセージの後に同期推奨メッセージを表示
    message.value = `${t('settings.workspaceSaved')}. ${t('settings.syncRecommended')}`
    messageType.value = 'success'
    closeDialog()
    await loadWorkspaces()
  } catch (e) {
    message.value = t('settings.errorSaving', { error: e })
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

function confirmDelete(workspace: Workspace) {
  workspaceToDelete.value = workspace
  deleteDialog.value = true
}

async function executeDelete() {
  if (!workspaceToDelete.value) return
  
  deleting.value = true
  try {
    await invoke('delete_workspace', { id: workspaceToDelete.value.id })
    message.value = t('settings.workspaceDeleted')
    messageType.value = 'success'
    deleteDialog.value = false
    await loadWorkspaces()
  } catch (e) {
    message.value = `Failed to delete workspace: ${e}`
    messageType.value = 'error'
  } finally {
    deleting.value = false
  }
}

async function syncIssues() {
  syncing.value = true
  message.value = ''
  try {
    const count = await invoke<number>('fetch_issues')
    message.value = t('settings.synced', { count })
    messageType.value = 'success'
    
    // 同期後に最新のワークスペース情報（API使用状況など）を再読み込み
    await loadWorkspaces()
  } catch (e) {
    message.value = t('settings.errorSyncing', { error: e })
    messageType.value = 'error'
  } finally {
    syncing.value = false
  }
}

async function toggleWorkspace(workspace: Workspace) {
  try {
    await invoke('toggle_workspace_enabled', {
      workspaceId: workspace.id,
      enabled: workspace.enabled
    })
    message.value = workspace.enabled 
      ? t('settings.workspaceEnabled') 
      : t('settings.workspaceDisabled')
    messageType.value = 'success'
  } catch (e) {
    console.error('Failed to toggle workspace:', e)
    // エラー時は元に戻す
    workspace.enabled = !workspace.enabled
    message.value = `Failed to toggle workspace: ${e}`
    messageType.value = 'error'
  }
}

async function openLogDir() {
  try {
    await invoke('open_log_directory')
  } catch (e) {
    console.error('Failed to open log directory:', e)
    message.value = `Failed to open log directory: ${e}`
    messageType.value = 'error'
  }
}

function getApiUsageColor(remaining: number, limit: number): string {
  const percentage = remaining / limit
  if (percentage < 0.2) return 'error'
  if (percentage < 0.5) return 'warning'
  return 'success'
}

function formatResetTime(dateStr: string): string {
  try {
    // Unixタイムスタンプ（秒）かどうかをチェック
    // 数字のみで構成されている場合はUnixタイムスタンプとみなす
    if (/^\d+$/.test(dateStr)) {
      const timestamp = parseInt(dateStr, 10)
      const date = new Date(timestamp * 1000) // ミリ秒に変換
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    const date = new Date(dateStr)
    if (isNaN(date.getTime())) {
      return dateStr // パース失敗時はそのまま表示
    }
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch (e) {
    return dateStr
  }
}
</script>
