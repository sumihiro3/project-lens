<template>
  <v-alert
    color="info"
    variant="tonal"
    density="compact"
    class="filter-summary-bar mb-4"
  >
    <template v-slot:prepend>
      <v-btn
        icon="mdi-filter"
        size="small"
        variant="text"
        @click="$emit('open-filter-dialog')"
      ></v-btn>
    </template>
    
    <div class="text-body-2">{{ filterSummary }}</div>
    
    <template v-slot:append>
      <v-chip size="small" color="primary">
        {{ filteredCount }} / {{ totalCount }} 件
      </v-chip>
    </template>
  </v-alert>
</template>

<script setup lang="ts">
import { computed } from 'vue'
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

// ステータスフィルターオプション（表示用）
const statusFilterOptions = [
  { title: '未処理のみ', value: 'unprocessed' },
  { title: '処理中のみ', value: 'in_progress' },
  { title: '完了を非表示', value: 'hide_completed' },
  { title: 'すべて表示', value: 'all' }
]

// 期限フィルターオプション（表示用）
const dueDateFilterOptions = [
  { title: '期限切れ', value: 'overdue' },
  { title: '今日まで', value: 'today' },
  { title: '今週まで', value: 'this_week' },
  { title: '今月まで', value: 'this_month' },
  { title: '期限なし', value: 'no_due_date' }
]

// 現在のフィルター設定のサマリー
const filterSummary = computed(() => {
  const parts: string[] = []
  
  // 検索クエリ
  if (props.filters.searchQuery) {
    parts.push(`検索: "${props.filters.searchQuery}"`)
  }
  
  // ステータス
  const statusOption = statusFilterOptions.find(opt => opt.value === props.filters.statusFilter)
  if (statusOption && props.filters.statusFilter !== 'hide_completed') {
    parts.push(`ステータス: ${statusOption.title}`)
  }
  
  // 期限
  const dueDateOption = dueDateFilterOptions.find(opt => opt.value === props.filters.dueDateFilter)
  if (dueDateOption) {
    parts.push(`期限: ${dueDateOption.title}`)
  }
  
  // スコア
  if (props.filters.minScore > 0) {
    parts.push(`スコア≥${props.filters.minScore}`)
  }
  
  // 優先度
  if (props.filters.selectedPriorities.length > 0) {
    parts.push(`優先度: ${props.filters.selectedPriorities.join(', ')}`)
  }
  
  // 担当者
  if (props.filters.selectedAssignees.length > 0) {
    parts.push(`担当者: ${props.filters.selectedAssignees.join(', ')}`)
  }
  
  return parts.length > 0 ? parts.join(' | ') : 'フィルターなし（完了を非表示）'
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
