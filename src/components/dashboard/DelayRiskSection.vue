<template>
  <v-card class="h-100">
    <v-card-title class="d-flex align-center gap-2 text-subtitle-1 font-weight-bold">
      <v-icon size="18" color="purple-darken-1">mdi-creation</v-icon>
      {{ $t('dashboard.delayRisk') }}
      <v-tooltip :text="$t('ai.tooltip.generated')" location="top">
        <template #activator="{ props: tooltipProps }">
          <v-chip
            v-bind="tooltipProps"
            size="x-small"
            color="purple-lighten-4"
            variant="flat"
            class="ml-1"
          >
            {{ $t('ai.settings.generated') }}
          </v-chip>
        </template>
      </v-tooltip>
    </v-card-title>
    <v-card-subtitle class="text-caption text-medium-emphasis pb-0" style="white-space: normal">
      {{ $t('dashboard.delayRiskDescription') }}
    </v-card-subtitle>
    <v-card-text class="pa-0">
      <v-list v-if="riskIssues.length > 0" density="compact">
        <template v-for="(issue, index) in riskIssues" :key="issue.id">
          <v-list-item class="cursor-pointer" @click="emit('open-detail', issue)">
            <template #prepend>
              <v-chip
                :color="getRiskColor(issue.ai_risk_level).color"
                size="x-small"
                class="mr-2"
                :style="{ color: getChipTextColor(getRiskColor(issue.ai_risk_level).hex) }"
              >
                {{ $t(`ai.riskBadge.${issue.ai_risk_level}`) }}
              </v-chip>
            </template>
            <v-list-item-title class="text-body-2">
              <span class="font-weight-bold">{{ issue.issueKey }}</span>
              {{ issue.summary }}
            </v-list-item-title>
            <v-list-item-subtitle
              v-if="issue.ai_suggestion"
              class="text-caption text-medium-emphasis mt-1 suggestion-text"
            >
              {{ issue.ai_suggestion }}
            </v-list-item-subtitle>
            <template #append>
              <v-icon size="16" color="grey-lighten-1">mdi-chevron-right</v-icon>
            </template>
          </v-list-item>
          <v-divider v-if="index < riskIssues.length - 1" />
        </template>
      </v-list>
      <div v-else class="pa-4 text-center text-medium-emphasis">
        {{ $t('dashboard.noDelayRisk') }}
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Issue } from '../../composables/useIssues'
import { getRiskColor, getChipTextColor } from '../../utils/issueHelpers'

interface Props {
  /** 全課題リスト。ai_risk_level が存在するものをフィルタして表示する */
  issues: Issue[]
}

interface Emits {
  /** リスト行クリック時、詳細ダイアログ表示を親へ要求する */
  (e: 'open-detail', issue: Issue): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

/** リスクレベルのソート優先度（high=0 が最優先） */
const riskOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }

/**
 * ai_risk_level が存在する課題をリスク順（high→medium→low）にソートして返す
 */
const riskIssues = computed(() => {
  return props.issues
    .filter(issue => !!issue.ai_risk_level)
    .sort((a, b) => {
      const orderA = riskOrder[a.ai_risk_level ?? ''] ?? 99
      const orderB = riskOrder[b.ai_risk_level ?? ''] ?? 99
      return orderA - orderB
    })
})
</script>

<style scoped>
.cursor-pointer {
  cursor: pointer;
}

.cursor-pointer:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.05);
}

.suggestion-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 360px;
}
</style>
