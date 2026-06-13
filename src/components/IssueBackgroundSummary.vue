<template>
  <!-- 背景・経緯の要約セクション（コメント再利用。FR-V045-004） -->
  <template v-if="show">
    <v-divider class="my-4" />
    <div class="background-summary">
      <!-- AI 生成ラベル -->
      <div class="d-flex align-center gap-1 mb-2">
        <v-icon size="16" color="purple-darken-1">mdi-creation</v-icon>
        <span class="text-caption text-medium-emphasis">
          {{ $t('ai.issueDetail.backgroundSummaryTitle') }}
        </span>
      </div>

      <!-- 生成中スピナー -->
      <div
        v-if="backgroundSummaryLoading"
        class="d-flex align-center gap-2 text-medium-emphasis py-2"
      >
        <v-progress-circular indeterminate size="18" width="2" color="purple-darken-1" />
        <span class="text-body-2">{{ $t('ai.issueDetail.backgroundSummarizing') }}</span>
      </div>

      <!-- 要約テキスト -->
      <div v-else-if="backgroundSummary" class="text-body-2 ai-text-box pa-2 rounded">
        {{ backgroundSummary }}
      </div>

      <!-- コメントなし（要約対象なし） -->
      <div v-else class="d-flex align-center gap-2 text-medium-emphasis py-1">
        <v-icon size="18" color="grey">mdi-comment-off-outline</v-icon>
        <span class="text-body-2">{{ $t('ai.issueDetail.backgroundNoComments') }}</span>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useReports } from '../composables/useReports'

interface Props {
  /** ダイアログ開閉状態。開いたら前の課題の要約をクリアして取り違えを防ぐ */
  open: boolean
}

const props = defineProps<Props>()

// 背景要約は useReports のグローバルステート（同時に開く詳細ダイアログは1つ）。
// 生成トリガー（ボタン）は親の詳細ダイアログのアクション行に置き、本コンポーネントは表示に専念する。
const {
  backgroundSummary,
  backgroundSummaryLoading,
  backgroundSummaryLoaded,
  resetBackgroundSummary,
} = useReports()

/** 一度でも生成を実行したら表示する（生成中・要約あり・コメントなしはテンプレートで分岐） */
const show = computed(() => backgroundSummaryLoading.value || backgroundSummaryLoaded.value)

// ダイアログを開くたびに前の課題の背景要約をクリアする。
watch(
  () => props.open,
  isOpen => {
    if (isOpen) resetBackgroundSummary()
  }
)
</script>

<style scoped>
.background-summary .ai-text-box {
  background-color: rgba(var(--v-theme-surface-variant, 0, 0, 0), 0.05);
  border: 1px solid rgba(var(--v-theme-outline, 0, 0, 0), 0.12);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
