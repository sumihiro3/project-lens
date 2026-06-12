<template>
  <v-card class="h-100">
    <v-card-title class="text-subtitle-1 font-weight-bold">
      {{ $t('dashboard.recentUpdates') }}
    </v-card-title>
    <v-card-subtitle class="text-caption text-medium-emphasis pb-0" style="white-space: normal;">
      {{ $t('dashboard.recentUpdatesDescription') }}
    </v-card-subtitle>
    <v-card-text class="pa-0">
      <v-list v-if="recentIssues.length > 0" density="compact">
        <template v-for="(issue, index) in recentIssues" :key="issue.id">
          <v-tooltip :text="$t('dashboard.clickToOpenIssue')" location="bottom">
            <template v-slot:activator="{ props }">
              <v-list-item
                v-bind="props"
                @click="openIssue(issue)"
                class="cursor-pointer"
              >
                <template v-slot:prepend>
                  <v-chip
                    :color="getPriorityColor(issue.priority?.name)"
                    size="x-small"
                    class="mr-2"
                  >
                    {{ issue.priority?.name || '-' }}
                  </v-chip>
                </template>
                <v-list-item-title class="text-body-2">
                  <span class="font-weight-bold">{{ issue.issueKey }}</span> {{ issue.summary }}
                </v-list-item-title>
                <v-list-item-subtitle class="d-flex align-center gap-2 mt-1">
                  <v-chip
                    v-if="issue.dueDate"
                    :color="getDueDateColor(issue.dueDate)"
                    size="x-small"
                    prepend-icon="mdi-calendar-clock"
                  >
                    {{ formatDate(issue.dueDate) }}
                  </v-chip>
                </v-list-item-subtitle>
                <template v-slot:append>
                  <span class="text-caption text-medium-emphasis">
                    {{ formatRelativeTime(issue.updated, t) }}
                  </span>
                </template>
              </v-list-item>
            </template>
          </v-tooltip>
          <v-divider v-if="index < recentIssues.length - 1" />
        </template>
      </v-list>
      <div v-else class="pa-4 text-center text-medium-emphasis">
        {{ $t('dashboard.noRecentUpdates') }}
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Issue } from '../../composables/useIssues'
import { getPriorityColor, getDueDateColor, formatDate, formatRelativeTime } from '../../utils/issueHelpers'
import { useI18n } from 'vue-i18n'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-shell'

const props = defineProps<{
  issues: Issue[]
}>()

const { t } = useI18n()

// 最近更新された5件を取得（更新日時の降順）
const recentIssues = computed(() => {
  return [...props.issues]
    .sort((a, b) => {
      const dateA = a.updated || ''
      const dateB = b.updated || ''
      return dateB.localeCompare(dateA)
    })
    .slice(0, 5)
})

// チケットをブラウザで開く
async function openIssue(issue: Issue) {
  console.log('openIssue called with:', issue.issueKey, 'workspace_id:', issue.workspace_id)
  
  if (!issue.issueKey || !issue.workspace_id) {
    console.error('No issue key or workspace_id provided')
    return
  }
  
  try {
    // ワークスペース情報を取得
    console.log('Fetching workspace by ID:', issue.workspace_id)
    const workspace = await invoke<{ id: number; domain: string; api_key: string; project_keys: string } | null>(
      'get_workspace_by_id',
      { workspaceId: issue.workspace_id }
    )
    console.log('Workspace:', workspace)
    
    if (!workspace || !workspace.domain) {
      console.error('Workspace not found or domain not configured')
      return
    }
    
    // BacklogのチケットURLを構築
    const url = `https://${workspace.domain}/view/${issue.issueKey}`
    console.log('Opening URL:', url)
    
    // デフォルトブラウザで開く
    await open(url)
    console.log('Successfully opened URL')
  } catch (error) {
    console.error('Failed to open issue:', error)
  }
}
</script>

<style scoped>
.cursor-pointer {
  cursor: pointer;
}

.cursor-pointer:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.05);
}
</style>
