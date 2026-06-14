<template>
  <!-- 横断サマリの AI 構造化インサイト（概況 + 推奨アクション）。FR-V046-004 -->
  <div class="ai-section">
    <!-- AI 生成ラベル -->
    <div class="d-flex align-center gap-1 mb-2">
      <v-icon size="16" color="purple-darken-1">mdi-creation</v-icon>
      <span class="text-caption text-medium-emphasis">{{ $t('reports.aiGeneratedLabel') }}</span>
      <span class="text-caption text-medium-emphasis"
        >— {{ $t('reports.cross.insight.title') }}</span
      >
    </div>

    <template v-if="insight">
      <!-- 概況 -->
      <div class="text-overline text-medium-emphasis">
        {{ $t('reports.cross.insight.summary') }}
      </div>
      <div class="text-body-2 ai-text-box pa-2 rounded mb-2">{{ insight.summary }}</div>

      <!-- 推奨アクション -->
      <template v-if="insight.recommendation">
        <div class="text-overline text-medium-emphasis">
          {{ $t('reports.cross.insight.recommendation') }}
        </div>
        <div class="text-body-2 ai-text-box pa-2 rounded">{{ insight.recommendation }}</div>
      </template>
    </template>

    <!-- degrade（インサイト未生成）の理由提示。NFR-V046-005 -->
    <v-alert
      v-else-if="degradedReason"
      :type="degradedReason === 'aiUnavailable' ? 'warning' : 'info'"
      variant="tonal"
      density="compact"
      class="mb-0"
    >
      {{ $t(`reports.degraded.${degradedReason}`) }}
    </v-alert>
  </div>
</template>

<script setup lang="ts">
import type { CrossInsight, ReportDegradedReason } from '../../composables/useReports'

interface Props {
  /** AI 生成の構造化インサイト（概況・推奨アクション。未生成・degrade 時は null） */
  insight: CrossInsight | null
  /** インサイト非表示時の degrade 理由（正常時は null） */
  degradedReason: ReportDegradedReason | null
}

defineProps<Props>()
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
