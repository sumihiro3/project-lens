<template>
  <div class="pa-4">
    <div class="d-flex justify-space-between align-center mb-4">
      <h1 class="text-h3">ProjectLens</h1>
      <v-btn-toggle v-model="locale" mandatory variant="outlined">
        <v-btn value="ja" size="small">日本語</v-btn>
        <v-btn value="en" size="small">English</v-btn>
      </v-btn-toggle>
    </div>

    <v-card class="pa-4">
      <v-card-title>{{ $t('welcome.title') }}</v-card-title>
      <v-card-subtitle class="mb-2">{{ $t('welcome.subtitle') }}</v-card-subtitle>
      <v-card-text>
        <p class="mb-4">{{ $t('welcome.info') }}</p>

        <!-- Features Section -->
        <v-row class="mb-4">
          <v-col cols="12" md="4">
            <v-card variant="outlined" class="h-100">
              <v-card-title class="text-h6">{{ $t('features.tickets.title') }}</v-card-title>
              <v-card-text>{{ $t('features.tickets.description') }}</v-card-text>
            </v-card>
          </v-col>
          <v-col cols="12" md="4">
            <v-card variant="outlined" class="h-100">
              <v-card-title class="text-h6">{{ $t('features.analytics.title') }}</v-card-title>
              <v-card-text>{{ $t('features.analytics.description') }}</v-card-text>
            </v-card>
          </v-col>
          <v-col cols="12" md="4">
            <v-card variant="outlined" class="h-100">
              <v-card-title class="text-h6">{{ $t('features.tracking.title') }}</v-card-title>
              <v-card-text>{{ $t('features.tracking.description') }}</v-card-text>
            </v-card>
          </v-col>
        </v-row>

        <!-- System Info Section -->
        <v-expansion-panels>
          <v-expansion-panel>
            <v-expansion-panel-title>{{ $t('system.title') }}</v-expansion-panel-title>
            <v-expansion-panel-text>
              <v-row>
                <v-col cols="12" sm="6">
                  <v-chip color="success" variant="flat" class="mr-2 mb-2">
                    Platform: {{ platformInfo }}
                  </v-chip>
                </v-col>
                <v-col cols="12" sm="6">
                  <v-chip color="info" variant="flat" class="mr-2 mb-2">
                    Electron: {{ electronVersion }}
                  </v-chip>
                </v-col>
              </v-row>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-card-text>

      <v-card-actions>
        <v-btn color="primary" variant="elevated" disabled>
          {{ $t('actions.getStarted') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

// 言語切り替えコンポーネントで使用
// テンプレート内のv-model="locale"で参照
const { locale } = useI18n()
const platformInfo = ref<string>('Unknown')
const electronVersion = ref<string>('N/A')

/**
 * コンポーネントマウント時にプラットフォーム情報を取得
 */
onMounted(() => {
  if (typeof window !== 'undefined' && window.api) {
    platformInfo.value = window.api.platform || 'Unknown'
    electronVersion.value = window.api.versions?.electron || 'N/A'
  }
})

// テンプレートでの使用を確認：localeはテンプレートで正しく使用されています
// - locale: テンプレート内のv-model="locale"で使用され、言語切り替えコンポーネントで参照

// TypeScript用のダミー参照（テンプレートでの使用を認識させる）

if (process.env.NODE_ENV === 'development') {
  // テンプレートで使用されている変数を参照
  void locale.value
}
</script>
