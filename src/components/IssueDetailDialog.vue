<template>
  <v-dialog
    :model-value="modelValue"
    max-width="640"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <!-- タイトルバー -->
      <v-card-title class="d-flex align-center justify-space-between pa-4 pb-2">
        <div class="d-flex align-center gap-2 overflow-hidden">
          <v-chip
            :color="projectColor"
            size="small"
            variant="flat"
            class="project-chip flex-shrink-0"
          >
            {{ projectKey }}
          </v-chip>
          <span class="text-subtitle-1 font-weight-bold text-truncate">
            {{ issue.issueKey }} {{ issue.summary }}
          </span>
        </div>
        <v-btn
          icon="mdi-close"
          size="small"
          variant="text"
          class="flex-shrink-0 ml-2"
          :aria-label="$t('common.close')"
          @click="emit('update:modelValue', false)"
        />
      </v-card-title>

      <v-divider />

      <v-card-text class="pa-4">
        <!-- メタデータ行 -->
        <div class="d-flex gap-2 mb-4 flex-wrap align-center">
          <v-chip v-if="issue.issueType" size="small" color="indigo" prepend-icon="mdi-tag">
            {{ issue.issueType.name }}
          </v-chip>
          <v-chip
            v-if="issue.priority"
            size="small"
            :color="getPriorityColor(issue.priority.name)"
            :style="{ color: getChipTextColor(getPriorityColor(issue.priority.name)) }"
            prepend-icon="mdi-flag"
          >
            {{ issue.priority.name }}
          </v-chip>
          <v-chip
            v-if="issue.status"
            size="small"
            :color="getStatusColor(issue.status.name)"
            :style="{ color: getChipTextColor(getStatusColor(issue.status.name)) }"
            prepend-icon="mdi-progress-check"
          >
            {{ issue.status.name }}
          </v-chip>
          <v-chip v-if="issue.assignee" size="small" prepend-icon="mdi-account">
            {{ issue.assignee.name }}
          </v-chip>
          <v-chip
            v-if="issue.dueDate"
            size="small"
            :color="getDueDateColor(issue.dueDate)"
            :style="{ color: getChipTextColor(getDueDateColor(issue.dueDate)) }"
            prepend-icon="mdi-calendar-clock"
          >
            {{ $t('issue.due', { date: formatDate(issue.dueDate) }) }}
          </v-chip>
        </div>

        <!-- AI 分析結果セクション -->
        <IssueAiAnalysis :issue="issue" />

        <!-- 背景・経緯の要約セクション（表示は子コンポーネントへ分離。FR-V045-004） -->
        <IssueBackgroundSummary :open="modelValue" />
      </v-card-text>

      <v-divider />

      <!-- アクションボタン -->
      <v-card-actions class="pa-3 justify-space-between">
        <v-btn
          size="small"
          variant="text"
          prepend-icon="mdi-refresh"
          color="grey-darken-1"
          :disabled="reanalyzing"
          :loading="reanalyzing"
          @click="handleReanalyze"
        >
          {{ $t('ai.issueDetail.reanalyze') }}
        </v-btn>
        <div class="d-flex gap-2">
          <v-btn
            size="small"
            variant="tonal"
            color="purple-darken-1"
            prepend-icon="mdi-text-box-search"
            :loading="backgroundSummaryLoading"
            @click="handleSummarizeBackground"
          >
            {{ $t('ai.issueDetail.summarizeBackground') }}
          </v-btn>
          <v-btn
            size="small"
            variant="tonal"
            color="purple-darken-1"
            prepend-icon="mdi-magnify-scan"
            @click="handleSearchSimilar"
          >
            {{ $t('similar.searchButton') }}
          </v-btn>
          <v-btn size="small" variant="tonal" prepend-icon="mdi-open-in-new" @click="openInBrowser">
            {{ $t('issue.openInBrowser') }}
          </v-btn>
          <v-btn size="small" variant="text" @click="emit('update:modelValue', false)">
            {{ $t('common.close') }}
          </v-btn>
        </div>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-shell'
import { useI18n } from 'vue-i18n'
import type { Issue } from '../composables/useIssues'
import { useAiSettings } from '../composables/useAiSettings'
import { useSimilarSearch } from '../composables/useSimilarSearch'
import { useReports } from '../composables/useReports'
import IssueAiAnalysis from './IssueAiAnalysis.vue'
import IssueBackgroundSummary from './IssueBackgroundSummary.vue'
import {
  getPriorityColor,
  getStatusColor,
  getDueDateColor,
  formatDate,
  getProjectColor,
  extractProjectKey,
  getChipTextColor,
} from '../utils/issueHelpers'

interface Props {
  issue: Issue
  modelValue: boolean
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const { locale } = useI18n()
const { reanalyze } = useAiSettings()
const { openSimilar } = useSimilarSearch()
// 背景要約の生成トリガー（ボタン）用。表示・リセットは IssueBackgroundSummary が担う。
const { backgroundSummaryLoading, generateBackgroundSummary } = useReports()
const reanalyzing = ref(false)

const projectColor = computed(() => getProjectColor(props.issue.issueKey))
const projectKey = computed(() => extractProjectKey(props.issue.issueKey))

/**
 * ブラウザでチケットを開く（IssueCard の openInBrowser と同じロジック）
 */
async function openInBrowser() {
  try {
    if (!props.issue.workspace_id) return
    const workspace = await invoke<{ id: number; domain: string } | null>('get_workspace_by_id', {
      workspaceId: props.issue.workspace_id,
    })
    if (!workspace?.domain) return
    await open(`https://${workspace.domain}/view/${props.issue.issueKey}`)
  } catch (e) {
    console.error('Failed to open in browser:', e)
  }
}

/**
 * 類似検索ダイアログを開く
 *
 * 詳細ダイアログを閉じてから類似ダイアログを開き、2 つのダイアログが重ならないようにする。
 */
function handleSearchSimilar() {
  emit('update:modelValue', false)
  openSimilar(props.issue)
}

/**
 * 課題を再分析キューに投入する
 */
async function handleReanalyze() {
  reanalyzing.value = true
  try {
    await reanalyze(props.issue.workspace_id, props.issue.id)
  } catch (e) {
    console.error('Failed to reanalyze:', e)
  } finally {
    reanalyzing.value = false
  }
}

/**
 * コメントから課題の背景・経緯を要約する（FR-V045-004）
 *
 * 結果は useReports 側の per-issue 背景要約 state に保持される。2 回目以降は Rust 側の
 * source_hash + lang キャッシュにより即返しになる。空文字（コメントなし・degrade）時は
 * テンプレート側で「コメントなし（要約対象なし）」を表示する。
 */
async function handleSummarizeBackground() {
  await generateBackgroundSummary(props.issue.workspace_id, props.issue.id, locale.value)
}
</script>

<style scoped>
.project-chip {
  font-weight: 600;
  letter-spacing: 0.5px;
  color: white !important;
}
</style>
