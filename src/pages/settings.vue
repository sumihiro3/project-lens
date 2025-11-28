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

        <v-divider class="my-4"></v-divider>

        <!-- Workspaces List -->
        <div class="d-flex align-center justify-space-between mb-2">
          <h3 class="text-h6">{{ $t('settings.workspaces') }}</h3>
          <v-btn color="primary" size="small" prepend-icon="mdi-plus" @click="openDialog()">
            {{ $t('settings.addWorkspace') }}
          </v-btn>
        </div>

        <v-list v-if="workspaces.length > 0" border rounded>
          <v-list-item v-for="ws in workspaces" :key="ws.id">
            <template v-slot:prepend>
              <v-avatar color="primary" variant="tonal">
                <v-icon>mdi-domain</v-icon>
              </v-avatar>
            </template>
            <v-list-item-title class="font-weight-bold">{{ ws.domain }}</v-list-item-title>
            <v-list-item-subtitle>{{ ws.project_keys }}</v-list-item-subtitle>
            <template v-slot:append>
              <v-btn icon="mdi-pencil" variant="text" size="small" @click="openDialog(ws)"></v-btn>
              <v-btn icon="mdi-delete" variant="text" color="error" size="small" @click="confirmDelete(ws)"></v-btn>
            </template>
          </v-list-item>
        </v-list>
        <v-alert v-else type="info" variant="tonal" class="mb-4">
          {{ $t('dashboard.noIssues') }}
        </v-alert>

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
import { ref, onMounted, computed, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useI18n } from 'vue-i18n'

interface Workspace {
  id: number
  domain: string
  api_key: string
  project_keys: string
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
const messageType = ref<'success' | 'error'>('success')

onMounted(async () => {
  try {
    const l = await invoke<string | null>('get_settings', { key: 'language' })
    if (l) {
      locale.value = l
    }
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
    
    message.value = t('settings.workspaceSaved')
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
  } catch (e) {
    message.value = t('settings.errorSyncing', { error: e })
    messageType.value = 'error'
  } finally {
    syncing.value = false
  }
}
</script>
