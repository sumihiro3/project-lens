<template>
  <!--
    類似検索ダイアログ（ページレベルで1回だけマウントする想定）。
    useSimilarSearch のグローバルステートを参照し、IssueSimilarResults を v-dialog でラップする。
  -->
  <v-dialog :model-value="dialogOpen" max-width="640" scrollable @update:model-value="onUpdate">
    <IssueSimilarResults
      :query-issue="queryIssue"
      :results="results"
      :loading="loading"
      :summary="summary"
      :summary-loading="summaryLoading"
      :degraded-reason="degradedReason"
      @close="close"
      @open-in-browser="openInBrowser"
    />
  </v-dialog>
</template>

<script setup lang="ts">
import { useSimilarSearch } from '../composables/useSimilarSearch'
import IssueSimilarResults from './IssueSimilarResults.vue'

const {
  dialogOpen,
  queryIssue,
  results,
  loading,
  summary,
  summaryLoading,
  degradedReason,
  close,
  openInBrowser,
} = useSimilarSearch()

/**
 * v-dialog の開閉変更を受けてグローバルステートへ反映する
 *
 * @param value - 新しい開閉状態
 */
function onUpdate(value: boolean) {
  if (!value) close()
}
</script>
