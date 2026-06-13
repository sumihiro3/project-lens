<template>
  <!-- AI 機能セクション（settings.vue から分離） -->
  <h3 class="text-h6 mb-2 d-flex align-center ga-2">
    <v-icon>mdi-creation</v-icon>
    {{ $t('ai.settings.title') }}
  </h3>
  <v-card variant="outlined" class="mb-4">
    <v-card-text>
      <!-- ON/OFF トグル -->
      <v-switch
        :model-value="aiEnabled"
        :label="$t('ai.settings.enable')"
        color="primary"
        hide-details
        class="mb-4"
        :disabled="!availability?.available || loadingAvailability"
        @update:model-value="onAiToggle"
      ></v-switch>

      <!-- 可用性ステータス表示 -->
      <div class="mb-3">
        <div class="text-caption text-grey mb-1">{{ $t('ai.settings.status') }}</div>
        <div v-if="loadingAvailability" class="d-flex align-center ga-2">
          <v-progress-circular size="16" width="2" indeterminate color="primary" />
          <span class="text-body-2">{{ $t('ai.availability.available') }}</span>
        </div>
        <template v-else-if="availability">
          <v-chip
            :color="availability.available ? 'success' : 'warning'"
            size="small"
            class="mb-2"
            variant="tonal"
          >
            {{ $t(availabilityReasonToMessageKey(availability.reason)) }}
          </v-chip>
          <!-- AI 非対応時: Apple Intelligence 設定への導線 -->
          <div
            v-if="!availability.available && availability.reason === 'appleIntelligenceDisabled'"
            class="mt-2"
          >
            <v-btn
              size="small"
              variant="tonal"
              color="primary"
              prepend-icon="mdi-open-in-new"
              @click="openAppleIntelligenceSettings"
            >
              {{ $t('ai.availability.openAppleIntelligenceSettings') }}
            </v-btn>
          </div>
          <!-- 別バックエンド案内（otherBackendAvailable = true のとき表示） -->
          <div v-if="availability.otherBackendAvailable" class="mt-2 text-body-2 text-grey">
            {{ $t('ai.availability.alternativeBackend') }}
          </div>
        </template>
        <div v-else class="text-body-2 text-grey">
          {{ $t('ai.availability.unavailable') }}
        </div>
      </div>

      <!-- キュー処理状況 -->
      <v-divider class="mb-3" />
      <div class="text-caption text-grey mb-1">{{ $t('ai.settings.queueTitle') }}</div>
      <div v-if="loadingQueue" class="d-flex align-center ga-2">
        <v-progress-circular size="16" width="2" indeterminate color="primary" />
        <span class="text-body-2">...</span>
      </div>
      <template v-else>
        <div
          v-if="queueStatus[1] > 0"
          class="d-flex align-center ga-2 text-body-2 text-primary mb-1"
        >
          <v-progress-circular size="14" width="2" indeterminate color="primary" />
          {{ $t('ai.settings.queueProcessing', { count: queueStatus[1] }) }}
        </div>
        <div v-if="queueStatus[0] > 0" class="text-body-2 mb-1">
          {{ $t('ai.settings.queuePending', { count: queueStatus[0] }) }}
        </div>
        <div v-if="totalQueueCount === 0" class="text-body-2 text-grey">
          {{ $t('ai.settings.queueEmpty') }}
        </div>
      </template>

      <!-- コーパス設定 -->
      <v-divider class="mb-3 mt-2" />
      <div class="text-caption text-grey mb-2">{{ $t('ai.corpus.title') }}</div>

      <!-- 取り込み期間スライダー -->
      <div class="mb-1">
        <div class="d-flex align-center justify-space-between mb-1">
          <span class="text-body-2">{{ $t('ai.corpus.monthsLabel') }}</span>
          <span class="text-body-2 font-weight-medium">
            {{ $t('ai.corpus.monthsValue', { months: corpusMonths }) }}
          </span>
        </div>
        <v-slider
          :model-value="corpusMonths"
          :min="1"
          :max="24"
          :step="1"
          color="primary"
          hide-details
          thumb-label
          class="mt-1"
          @update:model-value="onCorpusMonthsChange"
        />
        <div class="text-caption text-grey mt-1">
          {{ $t('ai.corpus.monthsHint') }}
        </div>
      </div>

      <!-- コーパス件数 -->
      <div class="d-flex align-center ga-2 mt-2">
        <span class="text-body-2 text-grey">{{ $t('ai.corpus.corpusCount') }}</span>
        <span v-if="loadingCorpus" class="text-body-2">
          <v-progress-circular size="12" width="2" indeterminate color="primary" />
        </span>
        <span v-else class="text-body-2 font-weight-medium">
          {{
            corpusCount !== null ? $t('ai.corpus.corpusCountValue', { count: corpusCount }) : '—'
          }}
        </span>
      </div>

      <!-- 埋め込み構築進捗 -->
      <div class="mt-2">
        <div class="d-flex align-center justify-space-between mb-1">
          <span class="text-body-2 text-grey">{{ $t('ai.corpus.embeddingProgress') }}</span>
          <span v-if="loadingEmbedding" class="text-body-2">
            <v-progress-circular size="12" width="2" indeterminate color="primary" />
          </span>
          <span v-else-if="embeddingStatus" class="text-body-2">
            {{
              $t('ai.corpus.embeddingProgressValue', {
                built: embeddingStatus.built,
                target: embeddingStatus.target,
              })
            }}
          </span>
          <span v-else class="text-body-2 text-grey">—</span>
        </div>
        <v-progress-linear
          v-if="embeddingStatus && embeddingStatus.target > 0"
          :model-value="embeddingProgressPercent"
          color="primary"
          height="6"
          rounded
          bg-color="surface-variant"
        />
        <div
          v-if="embeddingStatus && embeddingStatus.built < embeddingStatus.target"
          class="text-caption text-grey mt-1"
        >
          {{ $t('ai.corpus.embeddingHint') }}
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { open } from '@tauri-apps/plugin-shell'
import { useAiSettings, availabilityReasonToMessageKey } from '../composables/useAiSettings'

interface Emits {
  /** AI 操作の失敗を親へ通知する（親がメッセージ表示する） */
  (e: 'error', message: string): void
}

const emit = defineEmits<Emits>()

const {
  aiEnabled,
  availability,
  queueStatus,
  loadingAvailability,
  loadingQueue,
  totalQueueCount,
  corpusMonths,
  corpusCount,
  embeddingStatus,
  loadingCorpus,
  loadingEmbedding,
  embeddingProgressPercent,
  loadEnabled,
  loadAvailability,
  loadQueueStatus,
  enableAi,
  disableAi,
  loadCorpusMonths,
  saveCorpusMonths,
  loadCorpusCount,
  loadEmbeddingStatus,
} = useAiSettings()

onMounted(async () => {
  // AI 設定・可用性・キュー状況・コーパス設定を並行ロード（可用性は取得済みならスキップされる）
  await Promise.all([
    loadEnabled(),
    loadAvailability(),
    loadQueueStatus(),
    loadCorpusMonths(),
    loadCorpusCount(),
    loadEmbeddingStatus(),
  ])
})

/**
 * AI ON/OFF トグルのハンドラ。可用性がない場合は操作を受け付けない
 */
async function onAiToggle(value: boolean | null) {
  try {
    if (value) {
      await enableAi()
    } else {
      await disableAi()
    }
  } catch (e) {
    console.error('Failed to toggle AI setting:', e)
    emit('error', String(e))
  }
}

/**
 * Apple Intelligence 設定画面を開く（macOS システム環境設定）
 */
async function openAppleIntelligenceSettings() {
  try {
    // macOS の Apple Intelligence 設定ページへの URL スキーム
    await open('x-apple.systempreferences:com.apple.preference.security?Privacy_AppleIntelligence')
  } catch (e) {
    console.error('Failed to open Apple Intelligence settings:', e)
    emit('error', String(e))
  }
}

/**
 * コーパス取り込み期間スライダーの変更ハンドラ
 *
 * v-slider の update:model-value は number | undefined を渡すことがあるため型ガードを行う。
 */
async function onCorpusMonthsChange(value: number | undefined) {
  if (value === undefined) return
  try {
    await saveCorpusMonths(value)
    // 件数・進捗を更新して反映を確認できるようにする
    await Promise.all([loadCorpusCount(), loadEmbeddingStatus()])
  } catch (e) {
    console.error('Failed to save corpus months:', e)
    emit('error', String(e))
  }
}
</script>
