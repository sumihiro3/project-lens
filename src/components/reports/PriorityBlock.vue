<template>
  <!-- 決定的な優先対応リスト（横断上位フラット + プロジェクト別アコーディオン）。FR-V046-001 -->
  <div class="priority-block">
    <div class="d-flex align-center gap-2 mb-2">
      <v-icon size="18" color="error">mdi-flag-checkered</v-icon>
      <span class="text-subtitle-2 font-weight-bold">{{ $t('reports.priority.title') }}</span>
    </div>

    <!-- 横断上位（projectKey 横断のフラット上位 N。Rust priority_json の cross） -->
    <template v-if="priorityList.cross.length > 0">
      <div class="text-overline text-medium-emphasis mb-1">
        {{ $t('reports.priority.crossTop') }}
      </div>
      <PriorityIssueList
        :items="priorityList.cross"
        :loading="false"
        @open-issue="emit('open-issue', $event)"
        @show-background="emit('show-background', $event)"
      />
    </template>

    <!-- プロジェクト別グループ（Rust priority_json の perProject。各プロジェクト上位 K 件） -->
    <template v-if="priorityList.perProject.length > 0">
      <div class="text-overline text-medium-emphasis mt-3 mb-1">
        {{ $t('reports.priority.byProject') }}
      </div>
      <v-expansion-panels variant="accordion" multiple class="priority-panels">
        <v-expansion-panel v-for="group in priorityList.perProject" :key="group.projectKey">
          <v-expansion-panel-title>
            <v-chip
              :color="getProjectColor(group.projectKey + '-1')"
              size="x-small"
              variant="flat"
              class="project-chip mr-2"
            >
              {{ group.projectKey }}
            </v-chip>
            <span class="text-caption text-medium-emphasis">{{ group.issues.length }}</span>
          </v-expansion-panel-title>
          <v-expansion-panel-text class="px-0">
            <PriorityIssueList
              :items="group.issues"
              :loading="false"
              @open-issue="emit('open-issue', $event)"
              @show-background="emit('show-background', $event)"
            />
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { PriorityList } from '../../composables/useReports'
import { getProjectColor } from '../../utils/issueHelpers'
import PriorityIssueList from './PriorityIssueList.vue'

interface Props {
  /** 優先対応リスト全体（横断 + プロジェクト別。Rust `PriorityList` の camelCase 形） */
  priorityList: PriorityList
}

interface Emits {
  /** 優先行クリック（親が Backlog を開く。FR-V046-001） */
  (e: 'open-issue', issueKey: string): void
  /** 背景要約への導線（将来のボタン2分岐用にバブリング） */
  (e: 'show-background', issueKey: string): void
}

defineProps<Props>()
const emit = defineEmits<Emits>()
</script>

<style scoped>
.project-chip {
  font-weight: 600;
  letter-spacing: 0.5px;
  color: white !important;
}

.priority-panels :deep(.v-expansion-panel-text__wrapper) {
  padding: 0;
}
</style>
