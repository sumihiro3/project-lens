<template>
  <!-- レポートの AI narrative ブロック（生成ラベル + 見出し + 本文 + degrade）。横断/週次・月次で共用 -->
  <div class="ai-section">
    <!-- AI 生成ラベル -->
    <div class="d-flex align-center gap-1 mb-2">
      <v-icon size="16" color="purple-darken-1">mdi-creation</v-icon>
      <span class="text-caption text-medium-emphasis">{{ $t('reports.aiGeneratedLabel') }}</span>
      <span class="text-caption text-medium-emphasis">— {{ title }}</span>
    </div>

    <!-- 見出し（1行ハイライト。横断サマリのみ） -->
    <div v-if="headline" class="text-subtitle-2 font-weight-bold mb-2">{{ headline }}</div>

    <!-- narrative 本文 -->
    <div v-if="narrative" class="text-body-2 ai-text-box pa-2 rounded">{{ narrative }}</div>

    <!-- degrade（narrative 提供不可）の理由提示。NFR-V045-003 -->
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
import type { ReportDegradedReason } from '../../composables/useReports'

interface Props {
  /** 生成ラベルに続けて表示するセクション見出し（例: 「注目点」「期間ハイライト」） */
  title: string
  /** AI 生成の1行見出し（横断サマリのみ。無ければ null） */
  headline?: string | null
  /** AI 生成 narrative 本文（未生成・degrade 時は null） */
  narrative: string | null
  /** narrative 非表示時の degrade 理由（正常時は null） */
  degradedReason: ReportDegradedReason | null
}

withDefaults(defineProps<Props>(), { headline: null })
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
