<template>
  <v-container>
    <!-- Empty State: ワークスペース未設定 -->
    <v-row v-if="issues.length === 0" class="mt-8">
      <v-col cols="12" class="text-center">
        <v-card class="mx-auto pa-8" max-width="600" elevation="0" variant="outlined">
          <v-icon icon="mdi-cog-outline" size="80" color="primary" class="mb-4"></v-icon>
          <h2 class="text-h5 font-weight-bold mb-4">{{ $t('dashboard.welcomeTitle') }}</h2>
          <p class="text-body-1 text-medium-emphasis mb-6">
            {{ $t('dashboard.welcomeMessage') }}
          </p>
          <v-btn
            color="primary"
            size="x-large"
            prepend-icon="mdi-cog"
            to="/settings"
          >
            {{ $t('dashboard.goToSettings') }}
          </v-btn>
        </v-card>
      </v-col>
    </v-row>

    <!-- Dashboard Content -->
    <template v-else>
      <!-- Welcome Section -->
      <v-row class="mb-2">
        <v-col cols="12">
          <h1 class="text-h4 font-weight-bold mb-2">{{ $t('dashboard.title') }}</h1>
          <p class="text-body-1 text-medium-emphasis">
            {{ $t('dashboard.description') }}
          </p>
        </v-col>
      </v-row>

      <!-- KPI Cards -->
      <v-row>
        <v-col cols="12" md="4">
          <KpiCard
            :title="$t('dashboard.overdue')"
            :count="overdueCount"
            :tooltip="$t('dashboard.overdueTooltip')"
            icon="mdi-alert-circle"
            color="error"
            @click="navigateToOverdue"
          />
        </v-col>
        <v-col cols="12" md="4">
          <KpiCard
            :title="$t('dashboard.dueSoon')"
            :count="dueSoonCount"
            :tooltip="$t('dashboard.dueSoonTooltip')"
            icon="mdi-clock-alert"
            color="warning"
            @click="navigateToDueSoon"
          />
        </v-col>
        <v-col cols="12" md="4">
          <KpiCard
            :title="$t('dashboard.stagnant')"
            :count="stagnantCount"
            :tooltip="$t('dashboard.stagnantTooltip')"
            icon="mdi-sleep"
            color="info"
            @click="navigateToStagnant"
          />
        </v-col>
      </v-row>


      <!-- Charts and Recent Updates -->
      <v-row>
        <!-- Status Distribution Chart -->
        <v-col cols="12" md="6">
          <StatusChart
            :status-counts="statusCounts"
            @click-segment="navigateToStatus"
          />
        </v-col>
        
        <!-- Priority Distribution Chart -->
        <v-col cols="12" md="6">
          <PriorityChart
            :priority-counts="priorityCounts"
            @click-segment="navigateToPriority"
          />
        </v-col>
      </v-row>

      <!-- Recent Updates -->
      <v-row>
        <v-col cols="12">
          <RecentUpdates :issues="issues" />
        </v-col>
      </v-row>
    </template>
  </v-container>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useIssues } from '../composables/useIssues'
import { useIssueFilters } from '../composables/useIssueFilters'
import { parseDueDate, isOverdue } from '../utils/issueHelpers'
import KpiCard from '../components/dashboard/KpiCard.vue'
import StatusChart from '../components/dashboard/StatusChart.vue'
import PriorityChart from '../components/dashboard/PriorityChart.vue'
import RecentUpdates from '../components/dashboard/RecentUpdates.vue'
import { listen } from '@tauri-apps/api/event'

const router = useRouter()

// 課題データ管理
const { issues, loadIssues } = useIssues()

// フィルター管理（グローバルステートにアクセスするため）
const { filters } = useIssueFilters(issues)

// 自動更新イベントのリスナー解除関数
let unlisten: (() => void) | null = null

// 初期データ読み込み
onMounted(async () => {
  await loadIssues()
  
  // バックグラウンド同期完了イベントを監視
  unlisten = await listen('refresh-issues', () => {
    console.log('Received refresh-issues event, reloading...')
    loadIssues()
  })
})

onUnmounted(() => {
  if (unlisten) {
    unlisten()
  }
})

// ステータス定義
const completedStatuses = ['完了', 'Closed', 'Done']
const resolvedStatuses = ['処理済み', 'Resolved']

// 期限切れチケット数
const overdueCount = computed(() => {
  return issues.value.filter(issue => {
    const dueDate = parseDueDate(issue.dueDate)
    return dueDate && isOverdue(dueDate)
  }).length
})

// 期限間近チケット数（今日〜3日後）
const dueSoonCount = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  const targetDate = new Date(today)
  targetDate.setDate(targetDate.getDate() + 3)
  
  return issues.value.filter(issue => {
    const dueDate = parseDueDate(issue.dueDate)
    if (!dueDate) return false
    
    // 期限切れは除外（別カードで管理）
    return dueDate >= today && dueDate <= targetDate
  }).length
})

// 放置チケット数（5日以上更新なし、かつ未完了）
const stagnantCount = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  const thresholdDate = new Date(today)
  thresholdDate.setDate(thresholdDate.getDate() - 5)
  
  return issues.value.filter(issue => {
    const updated = parseDueDate(issue.updated)
    if (!updated) return false
    
    const statusName = issue.status?.name
    const isCompleted = statusName && (
      completedStatuses.some(s => statusName.includes(s)) ||
      resolvedStatuses.some(s => statusName.includes(s))
    )
    
    return updated < thresholdDate && !isCompleted
  }).length
})

// ステータス別カウント
const statusCounts = computed(() => {
  const counts: Record<string, number> = {}
  
  issues.value.forEach(issue => {
    const status = issue.status?.name || '不明'
    counts[status] = (counts[status] || 0) + 1
  })
  
  return counts
})

// 優先度別カウント
const priorityCounts = computed(() => {
  const counts: Record<string, number> = {}
  
  issues.value.forEach(issue => {
    const priority = issue.priority?.name || '不明'
    counts[priority] = (counts[priority] || 0) + 1
  })
  
  return counts
})

// フィルターをリセットしてから特定の条件を設定
function resetFilters() {
  filters.value.searchQuery = ''
  filters.value.statusFilter = 'all'
  filters.value.dueDateFilter = ''
  filters.value.dueSoonDays = null
  filters.value.stagnantDays = null
  filters.value.minScore = 0
  filters.value.selectedPriorities = []
  filters.value.selectedAssignees = []
  filters.value.selectedProjects = []
}

// 期限切れチケット一覧へ遷移
function navigateToOverdue() {
  resetFilters()
  filters.value.dueDateFilter = 'overdue'
  router.push('/issues')
}

// 期限間近チケット一覧へ遷移
function navigateToDueSoon() {
  resetFilters()
  filters.value.dueSoonDays = 3
  router.push('/issues')
}

// 放置チケット一覧へ遷移
function navigateToStagnant() {
  resetFilters()
  filters.value.stagnantDays = 5
  router.push('/issues')
}

// 特定ステータスのチケット一覧へ遷移
function navigateToStatus(statusName: string) {
  resetFilters()
  filters.value.statusFilter = statusName
  router.push('/issues')
}

// 特定優先度のチケット一覧へ遷移
function navigateToPriority(priorityName: string) {
  resetFilters()
  filters.value.selectedPriorities = [priorityName]
  router.push('/issues')
}
</script>
