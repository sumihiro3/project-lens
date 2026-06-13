<template>
  <!-- 週次/月次アクティビティレポート（種別切替・期間セレクタ + 統計 + narrative）。FR-V045-003 -->
  <v-card variant="outlined">
    <v-card-title class="d-flex align-center justify-space-between pa-4 pb-2 flex-wrap gap-2">
      <div class="d-flex align-center gap-2 overflow-hidden">
        <v-icon size="20" color="primary">mdi-calendar-clock</v-icon>
        <span class="text-subtitle-1 font-weight-bold text-truncate">
          {{ $t('reports.period.title') }}
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
          @click="emit('regenerate', reportType)"
        >
          {{ $t('reports.regenerate') }}
        </v-btn>
      </div>
    </v-card-title>

    <v-divider />

    <v-card-text class="pa-4">
      <!-- 種別切替（週次/月次）と期間セレクタ -->
      <div class="d-flex align-center gap-3 mb-4 flex-wrap">
        <v-btn-toggle
          :model-value="reportType"
          density="compact"
          variant="outlined"
          color="primary"
          mandatory
          @update:model-value="emit('update:reportType', $event)"
        >
          <v-btn value="weekly" size="small">{{ $t('reports.period.weekly') }}</v-btn>
          <v-btn value="monthly" size="small">{{ $t('reports.period.monthly') }}</v-btn>
        </v-btn-toggle>

        <v-select
          v-if="periods.length > 0"
          :model-value="selectedPeriod"
          :items="periods"
          :label="$t('reports.period.selectLabel')"
          density="compact"
          variant="outlined"
          hide-details
          class="period-select"
          @update:model-value="emit('select-period', reportType, $event)"
        />
      </div>

      <!-- ロード中スピナー -->
      <div v-if="loading" class="d-flex align-center gap-3 py-4">
        <v-progress-circular indeterminate size="20" color="primary" />
        <span class="text-body-2 text-medium-emphasis">{{ $t('reports.loading') }}</span>
      </div>

      <template v-else>
        <!-- 統計テーブル（数値は SQL 集計で常に表示） -->
        <v-table v-if="stats.length > 0" density="compact" class="period-table mb-4">
          <thead>
            <tr>
              <th class="text-left">{{ $t('reports.period.col.project') }}</th>
              <th class="text-right">{{ $t('reports.period.col.created') }}</th>
              <th class="text-right">{{ $t('reports.period.col.updated') }}</th>
              <th class="text-right">{{ $t('reports.period.col.completed') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in stats" :key="row.projectKey">
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
              <td class="text-right">{{ row.createdCount }}</td>
              <td class="text-right">{{ row.updatedCount }}</td>
              <td
                class="text-right"
                :class="{ 'text-success font-weight-bold': row.completedCount > 0 }"
              >
                {{ row.completedCount }}
              </td>
            </tr>
          </tbody>
        </v-table>

        <!-- 完了件数はコーパス取り込み期間内の完了課題に限る旨の補足（FR-V045-003） -->
        <p v-if="stats.length > 0" class="text-caption text-medium-emphasis mb-4">
          {{ $t('reports.period.completedCaveat') }}
        </p>

        <!-- 統計データなし（未生成） -->
        <v-alert v-else type="info" variant="tonal" density="compact" class="mb-4">
          {{ $t('reports.noStats') }}
        </v-alert>

        <!-- AI narrative セクション（生成ラベル + 本文 + degrade。共有コンポーネント） -->
        <ReportNarrative
          :title="$t('reports.period.narrativeTitle')"
          :narrative="narrative"
          :degraded-reason="degradedReason"
        />
      </template>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import type {
  PeriodActivityStat,
  PeriodReportType,
  ReportDegradedReason,
} from '../../composables/useReports'
import { getProjectColor, formatDate } from '../../utils/issueHelpers'
import ReportNarrative from './ReportNarrative.vue'

interface Props {
  /** 現在選択中のレポート種別（週次/月次） */
  reportType: PeriodReportType
  /** 選択中の期間キー（未選択・未生成時は null） */
  selectedPeriod: string | null
  /** 保存済み期間キー一覧（生成日時降順。期間セレクタ用） */
  periods: string[]
  /** 選択期間のプロジェクト別統計（SQL 集計済み。未生成時は空配列） */
  stats: PeriodActivityStat[]
  /** 選択期間の AI narrative テキスト（未生成・degrade 時は null） */
  narrative: string | null
  /** 選択期間の生成日時（ISO8601 文字列。未生成時は null） */
  generatedAt: string | null
  /** ロード中フラグ（期間切替含む） */
  loading: boolean
  /** 再生成中フラグ（再生成ボタンのスピナー用） */
  regenerating: boolean
  /** narrative 非表示の degrade 理由（正常時は null） */
  degradedReason: ReportDegradedReason | null
}

interface Emits {
  /** レポート種別切替（週次⇔月次） */
  (e: 'update:reportType', reportType: PeriodReportType): void
  /** 期間セレクタの選択変更 */
  (e: 'select-period', reportType: PeriodReportType, periodKey: string): void
  /** 再生成ボタン押下（親が generate_reports を呼ぶ） */
  (e: 'regenerate', reportType: PeriodReportType): void
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

.period-select {
  min-width: 180px;
  max-width: 260px;
}
</style>
