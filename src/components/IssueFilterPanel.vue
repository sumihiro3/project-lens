<template>
  <div>
    <!-- フィルター設定ダイアログ -->
    <v-dialog v-model="dialog" max-width="600">
      <v-card title="フィルター・検索設定">
        <v-card-text>
          <!-- 検索バー -->
          <v-text-field
            v-model="localFilters.searchQuery"
            label="検索（課題キー、件名、説明）"
            prepend-inner-icon="mdi-magnify"
            clearable
            class="mb-4"
          ></v-text-field>

          <!-- ステータスフィルター -->
          <v-select
            v-model="localFilters.statusFilter"
            :items="statusFilterOptions"
            label="ステータス"
            clearable
            class="mb-4"
          ></v-select>

          <!-- 期限フィルター -->
          <v-select
            v-model="localFilters.dueDateFilter"
            :items="dueDateFilterOptions"
            label="期限"
            clearable
            class="mb-4"
          ></v-select>

          <!-- 最小スコアフィルター -->
          <div class="mb-4">
            <v-label>最小スコア: {{ localFilters.minScore }}</v-label>
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
            label="優先度"
            multiple
            chips
            clearable
            class="mb-4"
          ></v-select>

          <!-- 担当者フィルター -->
          <v-select
            v-model="localFilters.selectedAssignees"
            :items="availableAssignees"
            label="担当者"
            multiple
            chips
            clearable
          ></v-select>
        </v-card-text>

        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn text @click="resetFilters">リセット</v-btn>
          <v-btn color="primary" @click="dialog = false">適用</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { FilterState } from '../composables/useIssueFilters'

interface Props {
  modelValue: FilterState
  availablePriorities: string[]
  availableAssignees: string[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: FilterState]
}>()

// ダイアログ表示状態
const dialog = ref(false)

// ローカルフィルター状態（v-model用）
const localFilters = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

// ステータスフィルターオプション
const statusFilterOptions = [
  { title: '未処理のみ', value: 'unprocessed' },
  { title: '処理中のみ', value: 'in_progress' },
  { title: '完了を非表示', value: 'hide_completed' },
  { title: 'すべて表示', value: 'all' }
]

// 期限フィルターオプション
const dueDateFilterOptions = [
  { title: '期限切れ', value: 'overdue' },
  { title: '今日まで', value: 'today' },
  { title: '今週まで', value: 'this_week' },
  { title: '今月まで', value: 'this_month' },
  { title: '期限なし', value: 'no_due_date' }
]

// フィルターをリセット
function resetFilters() {
  emit('update:modelValue', {
    searchQuery: '',
    statusFilter: 'hide_completed',
    dueDateFilter: '',
    minScore: 0,
    selectedPriorities: [],
    selectedAssignees: []
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
