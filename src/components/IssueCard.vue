<template>
  <v-card class="issue-card" :style="{ borderLeft: `4px solid ${projectColor}` }">
    <v-card-title class="d-flex align-center justify-space-between pa-3 pb-2">
      <div class="d-flex align-center flex-grow-1 overflow-hidden">
        <v-chip :color="projectColor" size="small" variant="flat" class="project-chip flex-shrink-0">
          {{ projectKey }}
        </v-chip>
        <span 
          class="text-h6 font-weight-bold issue-title text-truncate clickable-title" 
          @click="openInBrowser"
        >
          {{ issue.issueKey }} {{ issue.summary }}
        </span>
      </div>
      <div class="d-flex align-center gap-2 flex-shrink-0 ml-2">
        <v-chip color="purple" size="small" variant="flat" class="score-chip">
          {{ $t('issue.score', { score: issue.relevance_score }) }}
        </v-chip>
        <v-tooltip :text="$t('issue.openInBrowser')" location="bottom">
          <template v-slot:activator="{ props: tooltipProps }">
            <v-btn
              v-bind="tooltipProps"
              icon="mdi-open-in-new"
              size="small"
              variant="text"
              @click="openInBrowser"
            ></v-btn>
          </template>
        </v-tooltip>
      </div>
    </v-card-title>
    
    <v-card-text class="px-3 pt-2 pb-3">
      <!-- メタデータ -->
      <div class="d-flex gap-2 mb-3 align-center flex-wrap">
        <v-chip 
            v-if="issue.priority" 
            size="small" 
            :color="getPriorityColor(issue.priority?.name)"
            :style="{ color: getChipTextColor(getPriorityColor(issue.priority?.name)) }"
            prepend-icon="mdi-flag"
            class="metadata-chip"
          >
            {{ issue.priority?.name }}
          </v-chip>
        
        <v-chip 
            v-if="issue.status" 
            size="small" 
            :color="getStatusColor(issue.status?.name)"
            :style="{ color: getChipTextColor(getStatusColor(issue.status?.name)) }"
            prepend-icon="mdi-progress-check"
            class="metadata-chip"
          >
            {{ issue.status?.name }}
          </v-chip>
        
        <v-chip
    v-if="issue.assignee"
    size="small"
    prepend-icon="mdi-account"
    class="metadata-chip"
  >
    {{ issue.assignee.name }}
  </v-chip>
        
        <v-chip 
            v-if="issue.dueDate" 
            size="small" 
            :color="getDueDateColor(issue.dueDate)"
            :style="{ color: getChipTextColor(getDueDateColor(issue.dueDate)) }"
            prepend-icon="mdi-calendar-clock"
            class="metadata-chip"
          >
            {{ $t('issue.due', { date: formatDate(issue.dueDate) }) }}
          </v-chip>
      </div>
      
      <!-- 説明文 -->
      <div v-if="issue.description" class="text-body-2 text-medium-emphasis description-text">
        {{ issue.description }}
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-shell'
import type { Issue } from '../composables/useIssues'
import { 
  getPriorityColor, 
  getStatusColor, 
  getDueDateColor, 
  formatDate,
  getProjectColor,
  extractProjectKey,
  getChipTextColor
} from '../utils/issueHelpers'

interface Props {
  issue: Issue
}

const props = defineProps<Props>()

const projectColor = computed(() => getProjectColor(props.issue.issueKey))
const projectKey = computed(() => extractProjectKey(props.issue.issueKey))

/**
 * ブラウザでチケットを開く
 */
async function openInBrowser() {
  try {
    // ドメインを取得
    const domain = await invoke<string | null>('get_settings', { key: 'domain' })
    if (!domain) {
      console.error('Domain not configured')
      return
    }
    
    // BacklogのチケットURLを構築
    const url = `https://${domain}/view/${props.issue.issueKey}`
    
    // デフォルトブラウザで開く
    await open(url)
  } catch (e) {
    console.error('Failed to open in browser:', e)
  }
}
</script>

<style scoped>
.issue-card {
  transition: background-color 0.2s ease;
  margin-bottom: 8px; /* チケットレコード間の隙間を狭く */
}

.issue-card:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.12);
}

.project-chip {
  font-weight: 600;
  letter-spacing: 0.5px;
  color: white !important; /* バッジ内のテキストの視認性向上 */
}

.score-chip {
  font-weight: 500;
  color: white !important;
}

.issue-title {
  line-height: 1.4;
  word-break: break-word;
  margin-left: 16px; /* プロジェクトバッジとの間隔 */
}

.clickable-title {
  cursor: pointer;
  transition: text-decoration 0.2s ease;
}

.clickable-title:hover {
  text-decoration: underline;
}

.metadata-chip {
  font-weight: 500;
}

/* カラーチップのテキストを白に */
/* Text color for chips is now calculated dynamically */

.description-text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.5;
  margin-top: 4px; /* バッジと説明文の間にクリアランス */
}
</style>
