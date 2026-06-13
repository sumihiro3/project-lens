<template>
  <v-container>
    <!-- Empty State: ワークスペース未設定 -->
    <v-row v-if="issues.length === 0" class="mt-8">
      <v-col cols="12" class="text-center">
        <v-card class="mx-auto pa-8" max-width="600" elevation="0" variant="outlined">
          <v-icon icon="mdi-cog-outline" size="80" color="primary" class="mb-4" />
          <h2 class="text-h5 font-weight-bold mb-4">{{ $t('dashboard.welcomeTitle') }}</h2>
          <p class="text-body-1 text-medium-emphasis mb-6">{{ $t('dashboard.welcomeMessage') }}</p>
          <v-btn color="primary" size="x-large" prepend-icon="mdi-cog" to="/settings">
            {{ $t('dashboard.goToSettings') }}
          </v-btn>
        </v-card>
      </v-col>
    </v-row>

    <template v-else>
      <!-- ページタイトル -->
      <v-row class="mb-2">
        <v-col cols="12">
          <h1 class="text-h4 font-weight-bold mb-2">{{ $t('dashboard.title') }}</h1>
          <p class="text-body-1 text-medium-emphasis">
            {{
              showOnlyMyIssues ? $t('dashboard.descriptionMyIssues') : $t('dashboard.description')
            }}
          </p>
        </v-col>
      </v-row>

      <!-- AI バナー（可用性あり・未有効・スキップ未実施） -->
      <v-row v-if="showAiBanner" class="mb-2">
        <v-col cols="12">
          <v-alert
            color="purple-lighten-5"
            border="start"
            border-color="purple-darken-1"
            density="compact"
            closable
            @click:close="skipBanner"
          >
            <template #prepend>
              <v-icon color="purple-darken-1">mdi-creation</v-icon>
            </template>
            <div class="d-flex align-center justify-space-between flex-wrap gap-2">
              <div>
                <div class="font-weight-bold text-body-2">{{ $t('ai.banner.title') }}</div>
                <div class="text-caption text-medium-emphasis">
                  {{ $t('ai.banner.description') }}
                </div>
              </div>
              <div class="d-flex gap-2">
                <v-btn size="small" color="purple-darken-1" variant="flat" @click="handleEnableAi">
                  {{ $t('ai.banner.enable') }}
                </v-btn>
                <v-btn size="small" variant="text" color="grey-darken-1" @click="dismissBanner">
                  {{ $t('ai.banner.dismiss') }}
                </v-btn>
              </div>
            </div>
          </v-alert>
        </v-col>
      </v-row>

      <!-- KPI Cards -->
      <v-row>
        <v-col cols="12" md="4">
          <KpiCard
            :title="$t('dashboard.overdue')"
            :count="overdueCount"
            :tooltip="$t('dashboard.overdueTooltip')"
            icon="mdi-alert-circle"
            color="error"
            @click="navigateToOverdue"
          />
        </v-col>
        <v-col cols="12" md="4">
          <KpiCard
            :title="$t('dashboard.dueSoon')"
            :count="dueSoonCount"
            :tooltip="$t('dashboard.dueSoonTooltip')"
            icon="mdi-clock-alert"
            color="warning"
            @click="navigateToDueSoon"
          />
        </v-col>
        <v-col cols="12" md="4">
          <KpiCard
            :title="$t('dashboard.stagnant')"
            :count="stagnantCount"
            :tooltip="$t('dashboard.stagnantTooltip')"
            icon="mdi-sleep"
            color="info"
            @click="navigateToStagnant"
          />
        </v-col>
      </v-row>

      <!-- 遅延リスクセクション（AI 結果があるときのみ表示） -->
      <v-row v-if="hasDelayRiskIssues">
        <v-col cols="12">
          <DelayRiskSection :issues="baseIssues" @open-detail="openDetail" />
        </v-col>
      </v-row>

      <!-- チャート -->
      <v-row>
        <v-col cols="12" md="6">
          <StatusChart :status-counts="statusCounts" @click-segment="navigateToStatus" />
        </v-col>
        <v-col cols="12" md="6">
          <PriorityChart :priority-counts="priorityCounts" @click-segment="navigateToPriority" />
        </v-col>
      </v-row>

      <!-- 最近の更新 -->
      <v-row>
        <v-col cols="12">
          <RecentUpdates :issues="baseIssues" />
        </v-col>
      </v-row>
    </template>

    <!-- 課題詳細ダイアログ -->
    <IssueDetailDialog v-if="detailIssue" v-model="detailDialogOpen" :issue="detailIssue" />

    <!-- 類似検索ダイアログ（グローバルステート参照・ページに1回だけマウント） -->
    <IssueSimilarDialog />
  </v-container>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useDashboard } from '../composables/useDashboard'
import KpiCard from '../components/dashboard/KpiCard.vue'
import StatusChart from '../components/dashboard/StatusChart.vue'
import PriorityChart from '../components/dashboard/PriorityChart.vue'
import RecentUpdates from '../components/dashboard/RecentUpdates.vue'
import DelayRiskSection from '../components/dashboard/DelayRiskSection.vue'
import IssueDetailDialog from '../components/IssueDetailDialog.vue'
import IssueSimilarDialog from '../components/IssueSimilarDialog.vue'

const {
  issues,
  baseIssues,
  showOnlyMyIssues,
  overdueCount,
  dueSoonCount,
  stagnantCount,
  statusCounts,
  priorityCounts,
  navigateToOverdue,
  navigateToDueSoon,
  navigateToStagnant,
  navigateToStatus,
  navigateToPriority,
  detailIssue,
  detailDialogOpen,
  openDetail,
  showAiBanner,
  skipBanner,
  dismissBanner,
  handleEnableAi,
} = useDashboard()

/** ai_risk_level を持つ課題が1件以上あるか（DelayRiskSection の表示制御） */
const hasDelayRiskIssues = computed(() => baseIssues.value.some(i => !!i.ai_risk_level))
</script>
