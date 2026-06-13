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
  loadEnabled,
  loadAvailability,
  loadQueueStatus,
  enableAi,
  disableAi,
} = useAiSettings()

onMounted(async () => {
  // AI 設定・可用性・キュー状況を並行ロード（可用性は取得済みならスキップされる）
  await Promise.all([loadEnabled(), loadAvailability(), loadQueueStatus()])
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
</script>
