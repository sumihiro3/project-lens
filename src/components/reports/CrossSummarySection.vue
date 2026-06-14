<template>
  <!-- 複数プロジェクト横断サマリ（統計テーブル + AI narrative）。FR-V045-002 -->
  <v-card variant="outlined">
    <v-card-title class="d-flex align-center justify-space-between pa-4 pb-2 flex-wrap gap-2">
      <div class="d-flex align-center gap-2 overflow-hidden">
        <v-icon size="20" color="primary">mdi-chart-box-outline</v-icon>
        <span class="text-subtitle-1 font-weight-bold text-truncate">
          {{ $t('reports.cross.title') }}
        </span>
      </div>
      <div class="d-flex align-center gap-2">
        <span v-if="generatedAt" class="text-caption text-medium-emphasis">
          {{ $t('reports.lastGenerated', { time: formatDate(generatedAt) }) }}
        </span>
        <v-btn
          size="small"
          variant="tonal"
          color="primary"
          prepend-icon="mdi-refresh"
          :loading="regenerating"
          @click="emit('regenerate')"
        >
          {{ $t('reports.regenerate') }}
        </v-btn>
      </div>
    </v-card-title>

    <v-divider />

    <v-card-text class="pa-4">
      <!-- ロード中スピナー -->
      <div v-if="loading" class="d-flex align-center gap-3 py-4">
        <v-progress-circular indeterminate size="20" color="primary" />
        <span class="text-body-2 text-medium-emphasis">{{ $t('reports.loading') }}</span>
      </div>

      <template v-else>
        <!-- 優先対応リスト（決定的に算出。narrative・統計の上の主役。FR-V046-001） -->
        <PriorityBlock
          v-if="priorityList.cross.length > 0 || priorityList.perProject.length > 0"
          :priority-list="priorityList"
          class="mb-4"
          @open-issue="emit('open-issue', $event)"
          @show-background="emit('show-background', $event)"
        />

        <!-- 統計テーブル（数値は SQL 集計で常に表示。degrade 対象外） -->
        <v-table v-if="stats.length > 0" density="compact" class="cross-table mb-4">
          <thead>
            <tr>
              <th class="text-left">{{ $t('reports.cross.col.project') }}</th>
              <th class="text-right">{{ $t('reports.cross.col.open') }}</th>
              <th class="text-right">{{ $t('reports.cross.col.overdue') }}</th>
              <th class="text-right">{{ $t('reports.cross.col.stale') }}</th>
              <th class="text-right">{{ $t('reports.cross.col.mine') }}</th>
              <th class="text-right">{{ $t('reports.cross.col.risk') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in stats"
              :key="row.projectKey"
              class="cross-row"
              @click="emit('select-project', row.projectKey)"
            >
              <td>
                <v-chip
                  :color="getProjectColor(row.projectKey + '-1')"
                  size="x-small"
                  variant="flat"
                  class="project-chip"
                >
                  {{ row.projectKey }}
                </v-chip>
              </td>
              <td class="text-right">{{ row.openCount }}</td>
              <td
                class="text-right"
                :class="{ 'text-error font-weight-bold': row.overdueCount > 0 }"
              >
                {{ row.overdueCount }}
              </td>
              <td class="text-right">{{ row.staleCount }}</td>
              <td class="text-right">{{ row.myActionableCount }}</td>
              <td class="text-right">
                <span class="risk-dist text-caption">
                  <span class="text-error">{{ row.riskHigh }}</span>
                  /
                  <span class="text-warning">{{ row.riskMedium }}</span>
                  /
                  <span class="text-success">{{ row.riskLow }}</span>
                </span>
              </td>
            </tr>
          </tbody>
        </v-table>

        <!-- 統計データなし（未生成） -->
        <v-alert v-else type="info" variant="tonal" density="compact" class="mb-4">
          {{ $t('reports.noStats') }}
        </v-alert>

        <!-- AI 構造化インサイト（概況 + 推奨アクション。生 AI テキストは出さずカード整形） -->
        <CrossInsightCard :insight="insight" :degraded-reason="degradedReason" />
      </template>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import type {
  CrossInsight,
  CrossSummaryStat,
  PriorityList,
  ReportDegradedReason,
} from '../../composables/useReports'
import { getProjectColor, formatDate } from '../../utils/issueHelpers'
import CrossInsightCard from './CrossInsightCard.vue'
import PriorityBlock from './PriorityBlock.vue'

interface Props {
  /** プロジェクト別の横断統計（SQL 集計済み。未生成時は空配列） */
  stats: CrossSummaryStat[]
  /** 優先対応リスト（横断 + プロジェクト別。FR-V046-001） */
  priorityList: PriorityList
  /** AI 生成の構造化インサイト（概況・推奨アクション。未生成・degrade 時は null。FR-V046-004） */
  insight: CrossInsight | null
  /** 最終生成日時（ISO8601 文字列。未生成時は null） */
  generatedAt: string | null
  /** 初期ロード中フラグ */
  loading: boolean
  /** 再生成中フラグ（再生成ボタンのスピナー用） */
  regenerating: boolean
  /** narrative 非表示の degrade 理由（正常時は null） */
  degradedReason: ReportDegradedReason | null
}

interface Emits {
  /** 再生成ボタン押下（親が generate_reports を呼ぶ） */
  (e: 'regenerate'): void
  /** プロジェクト行クリック（課題一覧の絞り込み導線。FR-V045-002） */
  (e: 'select-project', projectKey: string): void
  /** 優先対応リストの行クリック（親が Backlog を開く。FR-V046-001） */
  (e: 'open-issue', issueKey: string): void
  /** 優先対応リストの背景要約導線（将来のボタン2分岐用にバブリング） */
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

.cross-row {
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.cross-row:hover {
  background-color: rgba(var(--v-theme-primary), 0.08);
}

.risk-dist {
  white-space: nowrap;
}
</style>
