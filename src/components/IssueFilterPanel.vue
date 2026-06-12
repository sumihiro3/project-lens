<template>
  <div>
    <!-- フィルター設定ダイアログ -->
    <v-dialog v-model="dialog" max-width="600">
      <v-card :title="$t('filters.dialogTitle')">
        <v-card-text>
          <!-- 検索バー -->
          <v-text-field
            v-model="localFilters.searchQuery"
            :label="$t('filters.searchPlaceholder')"
            prepend-inner-icon="mdi-magnify"
            clearable
            class="mb-4"
          ></v-text-field>

          <!-- ステータスフィルター -->
          <v-select
            v-model="localFilters.statusFilter"
            :items="statusFilterOptions"
            :label="$t('filters.status.label')"
            clearable
            class="mb-4"
          ></v-select>

          <!-- プロジェクトフィルター -->
          <v-select
            v-model="localFilters.selectedProjects"
            :items="availableProjects"
            :label="$t('filters.project')"
            multiple
            chips
            clearable
            class="mb-4"
          ></v-select>

          <!-- 期限フィルター -->
          <v-select
            v-model="localFilters.dueDateFilter"
            :items="dueDateFilterOptions"
            :label="$t('filters.dueDate.label')"
            clearable
            class="mb-4"
          ></v-select>

          <!-- 最小スコアフィルター -->
          <div class="mb-4">
            <v-label>{{ $t('filters.minScore') }}: {{ localFilters.minScore }}</v-label>
            <v-slider
              v-model="localFilters.minScore"
              :min="0"
              :max="200"
              :step="10"
              thumb-label
            ></v-slider>
          </div>

          <!-- 優先度フィルター -->
          <v-select
            v-model="localFilters.selectedPriorities"
            :items="availablePriorities"
            :label="$t('filters.priority')"
            multiple
            chips
            clearable
            class="mb-4"
          ></v-select>

          <!-- 担当者フィルター -->
          <v-select
            v-model="localFilters.selectedAssignees"
            :items="availableAssignees"
            :label="$t('filters.assignee')"
            multiple
            chips
            clearable
          ></v-select>
        </v-card-text>

        <v-card-actions>
          <v-spacer></v-spacer>
          <v-tooltip :text="$t('filters.resetFiltersTooltip')" location="bottom">
            <template v-slot:activator="{ props }">
              <v-btn v-bind="props" text @click="resetFilters">{{ $t('filters.reset') }}</v-btn>
            </template>
          </v-tooltip>
          <v-tooltip :text="$t('filters.applyFiltersTooltip')" location="bottom">
            <template v-slot:activator="{ props }">
              <v-btn v-bind="props" color="primary" @click="dialog = false">{{ $t('filters.apply') }}</v-btn>
            </template>
          </v-tooltip>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FilterState } from '../composables/useIssueFilters'

interface Props {
  modelValue: FilterState
  availablePriorities: string[]
  availableAssignees: string[]
  availableProjects: string[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: FilterState]
}>()

const { t } = useI18n()

// ダイアログ表示状態
const dialog = ref(false)

// ローカルフィルター状態（v-model用）
const localFilters = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

// ステータスフィルターオプション
const statusFilterOptions = computed(() => [
  { title: t('filters.status.unprocessed'), value: 'unprocessed' },
  { title: t('filters.status.in_progress'), value: 'in_progress' },
  { title: t('filters.status.all'), value: 'all' }
])

// 期限フィルターオプション
const dueDateFilterOptions = computed(() => [
  { title: t('filters.dueDate.overdue'), value: 'overdue' },
  { title: t('filters.dueDate.today'), value: 'today' },
  { title: t('filters.dueDate.this_week'), value: 'this_week' },
  { title: t('filters.dueDate.this_month'), value: 'this_month' },
  { title: t('filters.dueDate.no_due_date'), value: 'no_due_date' }
])

// フィルターをリセット
function resetFilters() {
  emit('update:modelValue', {
    searchQuery: '',
    statusFilter: 'all',
    dueDateFilter: '',
    dueSoonDays: null,
    stagnantDays: null,
    minScore: 0,
    selectedPriorities: [],
    selectedAssignees: [],
    selectedProjects: [],
    sortKey: 'relevance_score',
    sortOrder: 'desc'
  })
}

// 外部からダイアログを開く
function openDialog() {
  dialog.value = true
}

// 外部から呼び出せるようにexpose
defineExpose({
  openDialog
})
</script>
