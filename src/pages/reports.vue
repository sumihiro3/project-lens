<template>
  <v-container>
    <!-- ページタイトル -->
    <v-row class="mb-2">
      <v-col cols="12" class="d-flex align-center justify-space-between flex-wrap gap-2">
        <div>
          <h1 class="text-h4 font-weight-bold mb-1">{{ $t('reports.title') }}</h1>
          <p class="text-body-2 text-medium-emphasis mb-0">{{ $t('reports.description') }}</p>
        </div>
        <!-- ワークスペース選択（有効ワークスペースが複数あるときのみ） -->
        <v-select
          v-if="workspaceItems.length > 1"
          v-model="selectedWorkspaceId"
          :items="workspaceItems"
          item-title="title"
          item-value="value"
          :label="$t('reports.workspaceLabel')"
          density="compact"
          variant="outlined"
          hide-details
          class="workspace-select"
        />
      </v-col>
    </v-row>

    <!-- 有効ワークスペースなし -->
    <v-alert v-if="workspaceItems.length === 0" type="info" variant="tonal" class="mt-4">
      {{ $t('reports.noWorkspace') }}
    </v-alert>

    <template v-else>
      <!-- 横断サマリ -->
      <v-row class="mb-2">
        <v-col cols="12">
          <CrossSummarySection
            :stats="crossSummary.stats"
            :headline="crossSummary.headline"
            :narrative="crossSummary.narrative"
            :generated-at="crossSummary.generatedAt"
            :loading="loadingCross"
            :regenerating="regenerating.cross_summary"
            :degraded-reason="degradedReason.cross_summary"
            @regenerate="onRegenerate('cross_summary')"
            @select-project="goToIssues"
          />
        </v-col>
      </v-row>

      <!-- 週次/月次レポート -->
      <v-row>
        <v-col cols="12">
          <WeeklyMonthlySection
            v-model:report-type="periodType"
            :selected-period="periodState.selectedPeriod"
            :periods="periodState.periods"
            :stats="periodState.stats"
            :narrative="periodState.narrative"
            :generated-at="periodState.generatedAt"
            :loading="periodType === 'weekly' ? loadingWeekly : loadingMonthly"
            :regenerating="regenerating[periodType]"
            :degraded-reason="degradedReason[periodType]"
            @select-period="onSelectPeriod"
            @regenerate="onRegenerate"
          />
        </v-col>
      </v-row>
    </template>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { invoke } from '@tauri-apps/api/core'
import { useReports, type PeriodReportType, type ReportType } from '../composables/useReports'
import { useIssueFilters } from '../composables/useIssueFilters'
import { useIssues } from '../composables/useIssues'
import CrossSummarySection from '../components/reports/CrossSummarySection.vue'
import WeeklyMonthlySection from '../components/reports/WeeklyMonthlySection.vue'

interface WorkspaceOption {
  id: number
  domain: string
  enabled: boolean
}

const router = useRouter()
const { issues } = useIssues()
const { filters } = useIssueFilters(issues)
const {
  crossSummary,
  weekly,
  monthly,
  loadingCross,
  loadingWeekly,
  loadingMonthly,
  regenerating,
  degradedReason,
  loadReports,
  selectPeriod,
  regenerate,
} = useReports()

const selectedWorkspaceId = ref<number | null>(null)
const workspaceItems = ref<{ title: string; value: number }[]>([])
const periodType = ref<PeriodReportType>('weekly')

/** 種別切替に追従して表示する週次/月次の state バンドル */
const periodState = computed(() => (periodType.value === 'weekly' ? weekly.value : monthly.value))

/** 選択ワークスペースのレポートをまとめて読み込む */
async function reload() {
  if (selectedWorkspaceId.value !== null) await loadReports(selectedWorkspaceId.value)
}

function onRegenerate(reportType: ReportType) {
  if (selectedWorkspaceId.value !== null) regenerate(selectedWorkspaceId.value, reportType)
}

function onSelectPeriod(reportType: PeriodReportType, periodKey: string) {
  if (selectedWorkspaceId.value !== null)
    selectPeriod(selectedWorkspaceId.value, reportType, periodKey)
}

/** 横断統計テーブルのプロジェクト行クリックで課題一覧へ絞り込み遷移する */
function goToIssues(projectKey: string) {
  // 課題フィルタは global state のため、選択プロジェクトをセットしてから遷移する（dashboard と同方式）
  filters.value.selectedProjects = [projectKey]
  router.push('/issues')
}

watch(selectedWorkspaceId, reload)

onMounted(async () => {
  const workspaces = await invoke<WorkspaceOption[]>('get_workspaces')
  const enabled = workspaces.filter(w => w.enabled)
  workspaceItems.value = enabled.map(w => ({ title: extractDomainLabel(w.domain), value: w.id }))
  if (enabled.length > 0) selectedWorkspaceId.value = enabled[0].id
})

/** Backlog ドメインから表示用の短いラベルを作る（サブドメイン部分） */
function extractDomainLabel(domain: string): string {
  return domain.split('.')[0] || domain
}
</script>

<style scoped>
.workspace-select {
  min-width: 200px;
  max-width: 280px;
}
</style>
