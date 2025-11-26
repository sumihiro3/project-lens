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
      <v-icon color="primary">mdi-filter</v-icon>
    </template>
    
    <div class="text-body-2 text-primary">{{ filterSummary }}</div>
    
    <template v-slot:append>
      <div class="d-flex align-center">
        <v-chip size="small" color="primary" class="mr-2">
          {{ $t('filters.summary.count', { filtered: filteredCount, total: totalCount }) }}
        </v-chip>

        <v-menu location="bottom end">
          <template v-slot:activator="{ props }">
            <v-tooltip :text="$t('filters.sort.label')" location="bottom">
              <template v-slot:activator="{ props: tooltipProps }">
                <v-btn
                  v-bind="mergeProps(props, tooltipProps)"
                  icon="mdi-sort"
                  variant="text"
                  density="comfortable"
                  size="small"
                  :color="filters.sortKey !== 'relevance_score' ? 'primary' : undefined"
                ></v-btn>
              </template>
            </v-tooltip>
          </template>
          <v-list density="compact" nav width="200">
            <v-list-subheader>{{ $t('filters.sort.label') }}</v-list-subheader>
            
            <v-list-item
              v-for="option in sortOptions"
              :key="option.value"
              :value="option.value"
              @click="selectSortKey(option.value)"
              :active="filters.sortKey === option.value"
              color="primary"
            >
              <template v-slot:prepend>
                <v-icon :icon="option.icon"></v-icon>
              </template>
              <v-list-item-title>{{ option.title }}</v-list-item-title>
            </v-list-item>
            
            <v-divider class="my-2"></v-divider>
            
            <v-list-item @click="toggleSortOrder">
              <template v-slot:prepend>
                <v-icon :icon="filters.sortOrder === 'asc' ? 'mdi-sort-ascending' : 'mdi-sort-descending'"></v-icon>
              </template>
              <v-list-item-title>
                {{ filters.sortOrder === 'asc' ? '昇順' : '降順' }}
              </v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>
    </template>
  </v-alert>
</template>

<script setup lang="ts">
import { computed, mergeProps } from 'vue'
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

// ソートオプション
const sortOptions = computed(() => [
  { title: t('filters.sort.relevance_score'), value: 'relevance_score', icon: 'mdi-star' },
  { title: t('filters.sort.dueDate'), value: 'dueDate', icon: 'mdi-calendar-clock' },
  { title: t('filters.sort.priority'), value: 'priority', icon: 'mdi-flag' },
  { title: t('filters.sort.updated'), value: 'updated', icon: 'mdi-update' }
])

// ソートキー選択（デフォルトで降順にする）
function selectSortKey(key: string) {
  props.filters.sortKey = key
  props.filters.sortOrder = 'desc'
}

// ソート順切り替え
function toggleSortOrder() {
  props.filters.sortOrder = props.filters.sortOrder === 'asc' ? 'desc' : 'asc'
}

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

</style>
