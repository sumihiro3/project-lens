<template>
  <v-container>
    <div class="d-flex align-center mb-4 gap-2 sticky-header pt-2">
      <FilterSummaryBar
        class="flex-grow-1 mb-0"
        :filters="filters"
        :total-count="issues.length"
        :filtered-count="filteredIssues.length"
        @open-filter-dialog="filterPanelRef?.openDialog()"
      />
      <v-tooltip :text="$t('dashboard.refresh')" location="bottom">
        <template v-slot:activator="{ props }">
          <v-btn 
            v-bind="props"
            icon="mdi-refresh" 
            @click="handleRefresh" 
            :loading="loading" 
            variant="text" 
            size="small"
          ></v-btn>
        </template>
      </v-tooltip>
    </div>



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
    <v-snackbar
      v-model="snackbar"
      :color="snackbarColor"
      timeout="3000"
    >
      {{ snackbarText }}
      <template v-slot:actions>
        <v-btn variant="text" @click="snackbar = false">Close</v-btn>
      </template>
    </v-snackbar>
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
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// 課題データ管理
const { issues, loading, loadIssues, syncIssues } = useIssues()

// スナックバー管理
const snackbar = ref(false)
const snackbarText = ref('')
const snackbarColor = ref('success')

// 手動同期ハンドラ
async function handleRefresh() {
  try {
    await syncIssues()
    snackbarText.value = t('settings.synced', { count: issues.value.length })
    snackbarColor.value = 'success'
    snackbar.value = true
  } catch (e) {
    snackbarText.value = t('settings.errorSyncing', { error: e })
    snackbarColor.value = 'error'
    snackbar.value = true
  }
}

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

<style scoped>
.sticky-header {
  position: sticky;
  top: 64px;
  z-index: 10;
  background-color: rgb(var(--v-theme-background));
  margin-top: -16px; /* コンテナのパディングを相殺 */
  padding-top: 16px;
  padding-bottom: 8px;
}
</style>
