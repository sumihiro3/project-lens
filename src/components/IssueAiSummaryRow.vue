<template>
  <!-- AI 要約行（ai_summary がある場合のみ表示。IssueCard から分離） -->
  <div v-if="issue.ai_summary" class="d-flex align-center gap-2 mb-2">
    <!-- AI リスクバッジ（risk_level がある場合のみ。クリックで詳細ダイアログを開く） -->
    <v-tooltip v-if="issue.ai_risk_level" :text="riskTooltip" location="bottom">
      <template #activator="{ props: tooltipProps }">
        <v-chip
          v-bind="tooltipProps"
          :color="riskColor.color"
          size="x-small"
          variant="flat"
          :style="{ color: getChipTextColor(riskColor.hex), cursor: 'pointer' }"
          class="risk-badge flex-shrink-0"
          @click.stop="emit('open-detail', issue)"
        >
          {{ $t(`ai.riskBadge.${issue.ai_risk_level}`) }}
        </v-chip>
      </template>
    </v-tooltip>

    <!-- AI 生成アイコン -->
    <v-tooltip :text="$t('ai.tooltip.generated')" location="bottom">
      <template #activator="{ props: tooltipProps }">
        <v-icon v-bind="tooltipProps" size="14" color="purple-darken-1" class="flex-shrink-0">
          mdi-creation
        </v-icon>
      </template>
    </v-tooltip>

    <!-- 1行要約テキスト -->
    <span class="text-body-2 text-medium-emphasis ai-summary-text text-truncate">
      {{ issue.ai_summary }}
    </span>

    <!-- 詳細を開くボタン -->
    <v-tooltip :text="$t('ai.issueDetail.title')" location="bottom">
      <template #activator="{ props: tooltipProps }">
        <v-btn
          v-bind="tooltipProps"
          icon="mdi-chevron-right"
          size="x-small"
          variant="text"
          color="grey-darken-1"
          class="flex-shrink-0"
          @click.stop="emit('open-detail', issue)"
        />
      </template>
    </v-tooltip>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Issue } from '../composables/useIssues'
import { getChipTextColor, getRiskColor } from '../utils/issueHelpers'

interface Props {
  issue: Issue
}

interface Emits {
  (e: 'open-detail', issue: Issue): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const { t } = useI18n()

/** リスクレベルの色情報（issueHelpers に集約） */
const riskColor = computed(() => getRiskColor(props.issue.ai_risk_level))

/** リスクレベルに対応するツールチップ文字列 */
const riskTooltip = computed(() => {
  switch (props.issue.ai_risk_level) {
    case 'high':
      return t('ai.tooltip.riskHigh')
    case 'medium':
      return t('ai.tooltip.riskMedium')
    case 'low':
      return t('ai.tooltip.riskLow')
    default:
      return t('ai.tooltip.generated')
  }
})
</script>

<style scoped>
.risk-badge {
  font-weight: 600;
}

.ai-summary-text {
  flex: 1;
  min-width: 0;
}
</style>
