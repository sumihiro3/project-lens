<template>
  <v-alert
    color="info"
    variant="tonal"
    density="compact"
    class="filter-summary-bar mb-4"
    @click="$emit('open-filter-dialog')"
    style="cursor: pointer;"
  >
    <template v-slot:prepend>
      <v-icon>mdi-filter</v-icon>
    </template>
    
    <div class="text-body-2">{{ filterSummary }}</div>
    
    <template v-slot:append>
      <v-chip size="small" color="primary">
        {{ $t('filters.summary.count', { filtered: filteredCount, total: totalCount }) }}
      </v-chip>
    </template>
  </v-alert>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FilterState } from '../composables/useIssueFilters'

interface Props {
  filters: FilterState
  totalCount: number
  filteredCount: number
}

const props = defineProps<Props>()

defineEmits<{
  'open-filter-dialog': []
}>()

const { t } = useI18n()

// ステータスフィルターオプション（表示用）
const statusFilterOptions = computed(() => [
  { title: t('filters.status.unprocessed'), value: 'unprocessed' },
  { title: t('filters.status.in_progress'), value: 'in_progress' },
  { title: t('filters.status.all'), value: 'all' }
])

// 期限フィルターオプション（表示用）
const dueDateFilterOptions = computed(() => [
  { title: t('filters.dueDate.overdue'), value: 'overdue' },
  { title: t('filters.dueDate.today'), value: 'today' },
  { title: t('filters.dueDate.this_week'), value: 'this_week' },
  { title: t('filters.dueDate.this_month'), value: 'this_month' },
  { title: t('filters.dueDate.no_due_date'), value: 'no_due_date' }
])

// 現在のフィルター設定のサマリー
const filterSummary = computed(() => {
  const parts: string[] = []
  
  // 検索クエリ
  if (props.filters.searchQuery) {
    parts.push(t('filters.summary.search', { query: props.filters.searchQuery }))
  }
  
  // ステータス
  const statusOption = statusFilterOptions.value.find(opt => opt.value === props.filters.statusFilter)
  if (statusOption && props.filters.statusFilter !== 'hide_completed') {
    parts.push(t('filters.summary.status', { value: statusOption.title }))
  }
  
  // プロジェクト
  if (props.filters.selectedProjects && props.filters.selectedProjects.length > 0) {
    parts.push(t('filters.summary.project', { value: props.filters.selectedProjects.join(', ') }))
  }
  
  // 期限
  const dueDateOption = dueDateFilterOptions.value.find(opt => opt.value === props.filters.dueDateFilter)
  if (dueDateOption) {
    parts.push(t('filters.summary.dueDate', { value: dueDateOption.title }))
  }
  
  // スコア
  if (props.filters.minScore > 0) {
    parts.push(t('filters.summary.minScore', { score: props.filters.minScore }))
  }
  
  // 優先度
  if (props.filters.selectedPriorities.length > 0) {
    parts.push(t('filters.summary.priority', { value: props.filters.selectedPriorities.join(', ') }))
  }
  
  // 担当者
  if (props.filters.selectedAssignees.length > 0) {
    parts.push(t('filters.summary.assignee', { value: props.filters.selectedAssignees.join(', ') }))
  }
  
  return parts.length > 0 ? parts.join(' | ') : t('filters.summary.noFilter')
})
</script>

<style scoped>
.filter-summary-bar {
  position: sticky;
  top: 64px; /* v-app-barの高さ分 */
  z-index: 10;
  background-color: rgb(var(--v-theme-surface));
}
</style>
