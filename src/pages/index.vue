<template>
  <v-container>
    <v-card :title="$t('dashboard.title')" class="mb-4">
      <v-card-text>
        <div class="d-flex justify-space-between align-center">
          <p>{{ $t('dashboard.welcome') }}</p>
          <v-btn icon="mdi-refresh" @click="loadIssues" :loading="loading"></v-btn>
        </div>
      </v-card-text>
    </v-card>

    <!-- フィルター設定サマリーバー -->
    <FilterSummaryBar
      :filters="filters"
      :total-count="issues.length"
      :filtered-count="filteredIssues.length"
      @open-filter-dialog="filterPanelRef?.openDialog()"
    />

    <!-- フィルター設定ダイアログ（非表示） -->
    <IssueFilterPanel
      ref="filterPanelRef"
      v-model="filters"
      :available-priorities="availablePriorities"
      :available-assignees="availableAssignees"
      :available-projects="availableProjects"
    />

    <!-- 課題リスト -->
    <IssueList
      :issues="filteredIssues"
      :loading="loading"
      :empty-message="issues.length === 0 ? $t('dashboard.noIssues') : $t('dashboard.noFilteredIssues')"
    />
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useIssues } from '../composables/useIssues'
import { useIssueFilters } from '../composables/useIssueFilters'
import IssueFilterPanel from '../components/IssueFilterPanel.vue'
import FilterSummaryBar from '../components/FilterSummaryBar.vue'
import IssueList from '../components/IssueList.vue'
import { listen } from '@tauri-apps/api/event'

// 課題データ管理
const { issues, loading, loadIssues } = useIssues()

// フィルター管理
const {
  filters,
  filteredIssues,
  availablePriorities,
  availableAssignees,
  availableProjects
} = useIssueFilters(issues)

// フィルターパネルへの参照
const filterPanelRef = ref<InstanceType<typeof IssueFilterPanel>>()

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
</script>
