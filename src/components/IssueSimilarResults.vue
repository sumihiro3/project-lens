<template>
  <!-- 類似検索結果パネル（v-dialog でラップして利用する。FR-V04-005） -->
  <v-card>
    <!-- タイトルバー -->
    <v-card-title class="d-flex align-center justify-space-between pa-4 pb-2">
      <div class="d-flex align-center gap-2 overflow-hidden">
        <v-icon size="20" color="purple-darken-1">mdi-magnify-scan</v-icon>
        <span class="text-subtitle-1 font-weight-bold text-truncate">
          {{ $t('similar.title') }}
        </span>
      </div>
      <v-btn
        icon="mdi-close"
        size="small"
        variant="text"
        class="flex-shrink-0 ml-2"
        :aria-label="$t('common.close')"
        @click="emit('close')"
      />
    </v-card-title>

    <!-- クエリ課題の見出し -->
    <div v-if="queryIssue" class="px-4 pb-2 text-caption text-medium-emphasis text-truncate">
      {{ $t('similar.queryLabel', { key: queryIssue.issueKey, summary: queryIssue.summary }) }}
    </div>

    <v-divider />

    <v-card-text class="pa-4">
      <!-- degrade（機能無効化）理由の提示。NFR-V04-005 -->
      <v-alert
        v-if="degradedReason"
        :type="degradedReason === 'embeddingNotReady' ? 'info' : 'warning'"
        variant="tonal"
        density="compact"
        class="mb-0"
      >
        {{ $t(`similar.degraded.${degradedReason}`) }}
      </v-alert>

      <!-- 検索中スピナー -->
      <div v-else-if="loading" class="d-flex align-center gap-3 py-4">
        <v-progress-circular indeterminate size="20" color="primary" />
        <span class="text-body-2 text-medium-emphasis">{{ $t('similar.searching') }}</span>
      </div>

      <!-- 結果なし -->
      <div
        v-else-if="results.length === 0"
        class="d-flex align-center gap-2 text-medium-emphasis py-4"
      >
        <v-icon size="18" color="grey">mdi-magnify-close</v-icon>
        <span class="text-body-2">{{ $t('similar.noResults') }}</span>
      </div>

      <!-- 類似上位 N 件の一覧 -->
      <template v-else>
        <div class="text-caption text-medium-emphasis mb-2">
          {{ $t('similar.resultsCount', { count: results.length }) }}
        </div>
        <v-list class="py-0" density="compact">
          <v-list-item
            v-for="item in results"
            :key="`${item.workspaceId}-${item.issueId}`"
            class="similar-row px-2 mb-1 rounded"
            @click="emit('open-in-browser', item)"
          >
            <div class="d-flex align-center gap-2 flex-wrap">
              <!-- プロジェクトキーチップ -->
              <v-chip
                v-if="item.projectKey"
                :color="getProjectColor(item.issueKey)"
                size="x-small"
                variant="flat"
                class="project-chip flex-shrink-0"
              >
                {{ item.projectKey }}
              </v-chip>

              <!-- 課題キー -->
              <span class="text-body-2 font-weight-bold flex-shrink-0">{{ item.issueKey }}</span>

              <!-- 完了バッジ（コーパス専用課題） -->
              <v-chip
                v-if="item.isCorpusOnly"
                size="x-small"
                color="green"
                variant="flat"
                prepend-icon="mdi-check-circle-outline"
                class="flex-shrink-0"
              >
                {{ $t('similar.completedBadge') }}
              </v-chip>

              <!-- 類似度 -->
              <v-chip
                size="x-small"
                color="purple"
                variant="tonal"
                prepend-icon="mdi-approximately-equal"
                class="flex-shrink-0"
              >
                {{ $t('similar.similarityValue', { percent: similarityPercent(item.similarity) }) }}
              </v-chip>
            </div>

            <!-- サマリ -->
            <div class="text-body-2 text-truncate mt-1">{{ item.summary }}</div>

            <!-- ステータス・担当者 -->
            <div class="d-flex align-center gap-2 mt-1 flex-wrap">
              <v-chip
                v-if="item.status"
                size="x-small"
                :color="getStatusColor(item.status)"
                :style="{ color: getChipTextColor(statusHex(item.status)) }"
                variant="flat"
                prepend-icon="mdi-progress-check"
              >
                {{ item.status }}
              </v-chip>
              <v-chip v-if="item.assignee" size="x-small" prepend-icon="mdi-account" variant="text">
                {{ item.assignee }}
              </v-chip>
            </div>
          </v-list-item>
        </v-list>

        <!-- FoundationModels 解決策要約セクション -->
        <div class="ai-section mt-4">
          <!-- AI 生成ラベル -->
          <div class="d-flex align-center gap-1 mb-2">
            <v-icon size="16" color="purple-darken-1">mdi-creation</v-icon>
            <span class="text-caption text-medium-emphasis">{{ $t('ai.settings.generated') }}</span>
            <span class="text-caption text-medium-emphasis"
              >— {{ $t('similar.solutionTitle') }}</span
            >
          </div>

          <!-- 要約生成中 -->
          <div v-if="summaryLoading" class="d-flex align-center gap-3 py-2">
            <v-progress-circular indeterminate size="18" color="purple-darken-1" />
            <span class="text-body-2 text-medium-emphasis">{{ $t('similar.summarizing') }}</span>
          </div>

          <!-- 要約本文 -->
          <div v-else-if="summary" class="text-body-2 ai-text-box pa-2 rounded">{{ summary }}</div>

          <!-- 要約なし（AI 非対応や生成失敗で degrade した場合） -->
          <div v-else class="text-body-2 text-medium-emphasis">{{ $t('similar.noSummary') }}</div>
        </div>
      </template>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import type { Issue } from '../composables/useIssues'
import type { SimilarIssue, SimilarDegradedReason } from '../composables/useSimilarSearch'
import { getProjectColor, getStatusColor, getChipTextColor } from '../utils/issueHelpers'

interface Props {
  /** 検索の起点となったクエリ課題（見出し表示用） */
  queryIssue: Issue | null
  /** 横断類似検索の結果（類似度降順） */
  results: SimilarIssue[]
  /** 検索の実行中フラグ */
  loading: boolean
  /** 解決策要約のテキスト（未生成時は null） */
  summary: string | null
  /** 解決策要約の生成中フラグ */
  summaryLoading: boolean
  /** degrade（機能無効化）の理由（正常時は null） */
  degradedReason: SimilarDegradedReason | null
}

interface Emits {
  /** パネルを閉じる */
  (e: 'close'): void
  /** 候補課題をブラウザで開く */
  (e: 'open-in-browser', issue: SimilarIssue): void
}

defineProps<Props>()
const emit = defineEmits<Emits>()

/**
 * コサイン類似度（0.0〜1.0）を整数パーセントへ変換する
 *
 * @param similarity - 類似度（0.0〜1.0）
 * @returns 0〜100 の整数
 */
function similarityPercent(similarity: number): number {
  return Math.round(similarity * 100)
}

/**
 * ステータス名から getChipTextColor 用の 16進カラーを導出する
 *
 * `getStatusColor` は Vuetify カラー名（green/orange/grey）を返すため、
 * コントラスト計算用に対応する代表 16進値へ写像する。
 *
 * @param status - ステータス名
 * @returns 16進カラー文字列
 */
function statusHex(status: string): string {
  const color = getStatusColor(status)
  // getStatusColor が返す Vuetify カラー名の代表値（コントラスト判定用）
  const map: Record<string, string> = {
    green: '#4CAF50',
    orange: '#FF9800',
    grey: '#9E9E9E',
  }
  return map[color] ?? '#9E9E9E'
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

.project-chip {
  font-weight: 600;
  letter-spacing: 0.5px;
  color: white !important;
}

.similar-row {
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.similar-row:hover {
  background-color: rgba(var(--v-theme-primary), 0.08);
}
</style>
