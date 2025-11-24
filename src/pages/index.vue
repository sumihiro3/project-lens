<template>
  <v-container>
    <v-card title="Dashboard" class="mb-4">
      <v-card-text>
        <div class="d-flex justify-space-between align-center mb-4">
          <p>Welcome to ProjectLens.</p>
          <v-btn icon="mdi-refresh" @click="loadIssues" :loading="loading"></v-btn>
        </div>

        <!-- フィルター・検索エリア -->
        <v-expansion-panels class="mb-4">
          <v-expansion-panel>
            <v-expansion-panel-title>
              <v-icon class="mr-2">mdi-filter</v-icon>
              フィルター・検索
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <!-- 検索バー -->
              <v-text-field
                v-model="searchQuery"
                label="検索（課題キー、件名、説明）"
                prepend-inner-icon="mdi-magnify"
                clearable
                class="mb-4"
              ></v-text-field>

              <!-- ステータスフィルター -->
              <v-checkbox
                v-model="hideCompleted"
                label="完了・処理済みを非表示"
                hide-details
                class="mb-2"
              ></v-checkbox>

              <!-- 最小スコアフィルター -->
              <div class="mb-4">
                <v-label>最小スコア: {{ minScore }}</v-label>
                <v-slider
                  v-model="minScore"
                  :min="0"
                  :max="200"
                  :step="10"
                  thumb-label
                ></v-slider>
              </div>

              <!-- 優先度フィルター -->
              <v-select
                v-model="selectedPriorities"
                :items="availablePriorities"
                label="優先度"
                multiple
                chips
                clearable
                class="mb-4"
              ></v-select>

              <!-- 担当者フィルター -->
              <v-select
                v-model="selectedAssignees"
                :items="availableAssignees"
                label="担当者"
                multiple
                chips
                clearable
              ></v-select>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>

        <!-- 表示件数 -->
        <v-chip class="mb-4" color="primary">
          {{ filteredIssues.length }} / {{ issues.length }} 件表示
        </v-chip>
      </v-card-text>
    </v-card>

    <!-- 課題リスト -->
    <v-row>
      <v-col v-for="issue in filteredIssues" :key="issue.id" cols="12">
        <v-card :title="issue.issueKey + ' ' + issue.summary" :subtitle="issue.status?.name">
          <v-card-text>
            <div class="d-flex gap-2 mb-2 align-center flex-wrap">
              <v-chip color="purple" size="small" variant="flat">Score: {{ issue.relevance_score }}</v-chip>
              <v-chip size="small" :color="getPriorityColor(issue.priority?.name)">{{ issue.priority?.name }}</v-chip>
              <v-chip size="small" v-if="issue.assignee">{{ issue.assignee.name }}</v-chip>
              <v-chip size="small" v-if="issue.dueDate">Due: {{ issue.dueDate }}</v-chip>
              <v-chip size="small" :color="getStatusColor(issue.status?.name)">{{ issue.status?.name }}</v-chip>
            </div>
            <div class="text-truncate">{{ issue.description }}</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
    
    <v-alert v-if="filteredIssues.length === 0 && issues.length > 0" type="info" class="mt-4">
      フィルター条件に一致する課題がありません。
    </v-alert>

    <v-alert v-if="issues.length === 0 && !loading" type="info" class="mt-4">
      No issues found. Go to Settings to sync.
    </v-alert>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'

const issues = ref<any[]>([])
const loading = ref(false)

// フィルター状態
const searchQuery = ref('')
const hideCompleted = ref(true)
const minScore = ref(0)
const selectedPriorities = ref<string[]>([])
const selectedAssignees = ref<string[]>([])

// 完了・処理済みステータスのリスト
const completedStatuses = ['完了', '処理済み', 'Closed', 'Resolved', 'Done']

// 利用可能な優先度リスト
const availablePriorities = computed(() => {
  const priorities = new Set<string>()
  issues.value.forEach(issue => {
    if (issue.priority?.name) {
      priorities.add(issue.priority.name)
    }
  })
  return Array.from(priorities).sort()
})

// 利用可能な担当者リスト
const availableAssignees = computed(() => {
  const assignees = new Set<string>()
  issues.value.forEach(issue => {
    if (issue.assignee?.name) {
      assignees.add(issue.assignee.name)
    }
  })
  return Array.from(assignees).sort()
})

// フィルター適用後の課題リスト
const filteredIssues = computed(() => {
  return issues.value.filter(issue => {
    // 完了・処理済みフィルター
    if (hideCompleted.value && issue.status?.name) {
      if (completedStatuses.some(status => issue.status.name.includes(status))) {
        return false
      }
    }

    // スコアフィルター
    if (issue.relevance_score < minScore.value) {
      return false
    }

    // 優先度フィルター
    if (selectedPriorities.value.length > 0) {
      if (!issue.priority?.name || !selectedPriorities.value.includes(issue.priority.name)) {
        return false
      }
    }

    // 担当者フィルター
    if (selectedAssignees.value.length > 0) {
      if (!issue.assignee?.name || !selectedAssignees.value.includes(issue.assignee.name)) {
        return false
      }
    }

    // 検索クエリフィルター
    if (searchQuery.value) {
      const query = searchQuery.value.toLowerCase()
      const matchesKey = issue.issueKey?.toLowerCase().includes(query)
      const matchesSummary = issue.summary?.toLowerCase().includes(query)
      const matchesDescription = issue.description?.toLowerCase().includes(query)
      
      if (!matchesKey && !matchesSummary && !matchesDescription) {
        return false
      }
    }

    return true
  })
})

onMounted(() => {
  loadIssues()
})

async function loadIssues() {
  loading.value = true
  try {
    issues.value = await invoke('get_issues')
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

function getPriorityColor(priority: string | undefined) {
  if (!priority) return 'grey'
  if (priority === 'High' || priority === '高') return 'red'
  if (priority === 'Normal' || priority === '中') return 'blue'
  return 'grey'
}

function getStatusColor(status: string | undefined) {
  if (!status) return 'grey'
  if (completedStatuses.some(s => status.includes(s))) return 'green'
  return 'grey'
}
</script>
