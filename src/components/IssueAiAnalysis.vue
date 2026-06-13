<template>
  <!-- AI 分析結果セクション（IssueDetailDialog から分離） -->
  <template v-if="hasAiResult">
    <div class="ai-section mb-1">
      <!-- AI 生成ラベル -->
      <div class="d-flex align-center gap-1 mb-3">
        <v-icon size="16" color="purple-darken-1">mdi-creation</v-icon>
        <span class="text-caption text-medium-emphasis">{{ $t('ai.settings.generated') }}</span>
        <span v-if="issue.ai_processed_at" class="text-caption text-medium-emphasis">
          —
          {{
            $t('ai.issueDetail.generatedAt', {
              datetime: formatProcessedAt(issue.ai_processed_at),
            })
          }}
        </span>
      </div>

      <!-- リスクバッジ + 遅延日数 -->
      <div class="d-flex align-center gap-2 mb-3">
        <v-chip
          :color="riskColor.color"
          size="small"
          variant="flat"
          :style="{ color: getChipTextColor(riskColor.hex) }"
          prepend-icon="mdi-alert-circle-outline"
        >
          {{ $t(`ai.riskLevel.${issue.ai_risk_level}`) }}
        </v-chip>
        <span class="text-body-2">
          <template v-if="(issue.ai_delay_days ?? 0) > 0">
            {{ $t('ai.issueDetail.delayDaysValue', { days: issue.ai_delay_days }) }}
          </template>
          <template v-else>
            {{ $t('ai.issueDetail.notDelayed') }}
          </template>
        </span>
      </div>

      <!-- 1行要約 -->
      <div v-if="issue.ai_summary" class="mb-3">
        <div class="text-caption text-medium-emphasis mb-1">
          {{ $t('ai.issueDetail.summary') }}
        </div>
        <div class="text-body-2 ai-text-box pa-2 rounded">{{ issue.ai_summary }}</div>
      </div>

      <!-- 対応提案 -->
      <div v-if="issue.ai_suggestion">
        <div class="text-caption text-medium-emphasis mb-1">
          {{ $t('ai.issueDetail.suggestion') }}
        </div>
        <div class="text-body-2 ai-text-box pa-2 rounded">{{ issue.ai_suggestion }}</div>
      </div>
    </div>
  </template>

  <!-- AI 結果なし -->
  <template v-else>
    <div class="d-flex align-center gap-2 text-medium-emphasis py-2">
      <v-icon size="18" color="grey">mdi-creation-outline</v-icon>
      <span class="text-body-2">{{ $t('ai.issueDetail.noResult') }}</span>
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Issue } from '../composables/useIssues'
import { getChipTextColor, getRiskColor } from '../utils/issueHelpers'

interface Props {
  issue: Issue
}

const props = defineProps<Props>()

/** AI 結果があるか（リスクレベルの有無で判定。ワーカーは risk_level を必ず設定する） */
const hasAiResult = computed(() => !!props.issue.ai_risk_level)

/** リスクレベルの色情報（Vuetify カラー名 + getChipTextColor 用 16進値）。issueHelpers に集約 */
const riskColor = computed(() => getRiskColor(props.issue.ai_risk_level))

/**
 * AI 処理日時を表示用にフォーマットする
 */
function formatProcessedAt(isoStr: string): string {
  try {
    const d = new Date(isoStr)
    return d.toLocaleString()
  } catch {
    return isoStr
  }
}
</script>

<style scoped>
.ai-section {
  border-left: 3px solid rgba(var(--v-theme-secondary), 0.4);
  padding-left: 12px;
}

.ai-text-box {
  background-color: rgba(var(--v-theme-surface-variant, 0, 0, 0), 0.05);
  border: 1px solid rgba(var(--v-theme-outline, 0, 0, 0), 0.12);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
