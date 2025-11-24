<template>
  <v-container>
    <v-card title="Dashboard" class="mb-4">
      <v-card-text>
        <div class="d-flex justify-space-between align-center">
          <p>Welcome to ProjectLens.</p>
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
    />

    <!-- 課題リスト -->
    <IssueList
      :issues="filteredIssues"
      :loading="loading"
      :empty-message="issues.length === 0 ? 'No issues found. Go to Settings to sync.' : 'フィルター条件に一致する課題がありません。'"
    />
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useIssues } from '../composables/useIssues'
import { useIssueFilters } from '../composables/useIssueFilters'
import IssueFilterPanel from '../components/IssueFilterPanel.vue'
import FilterSummaryBar from '../components/FilterSummaryBar.vue'
import IssueList from '../components/IssueList.vue'

// 課題データ管理
const { issues, loading, loadIssues } = useIssues()

// フィルター管理
const { filters, filteredIssues, availablePriorities, availableAssignees } = useIssueFilters(issues)

// フィルターパネルへの参照
const filterPanelRef = ref<InstanceType<typeof IssueFilterPanel>>()

// 初期データ読み込み
onMounted(() => {
  loadIssues()
})
</script>
