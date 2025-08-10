<template lang="pug">
.pa-4
  .d-flex.justify-space-between.align-center.mb-4
    h1.text-h3 ProjectLens
    v-btn-toggle(v-model="locale" mandatory variant="outlined")
      v-btn(value="ja" size="small") 日本語
      v-btn(value="en" size="small") English

  v-card.pa-4
    v-card-title {{ $t('welcome.title') }}
    v-card-subtitle.mb-2 {{ $t('welcome.subtitle') }}
    v-card-text
      p.mb-4 {{ $t('welcome.info') }}

      //- Features Section
      v-row.mb-4
        v-col(cols="12" md="4")
          v-card(variant="outlined" class="h-100")
            v-card-title.text-h6 {{ $t('features.tickets.title') }}
            v-card-text {{ $t('features.tickets.description') }}
        v-col(cols="12" md="4")
          v-card(variant="outlined" class="h-100")
            v-card-title.text-h6 {{ $t('features.analytics.title') }}
            v-card-text {{ $t('features.analytics.description') }}
        v-col(cols="12" md="4")
          v-card(variant="outlined" class="h-100")
            v-card-title.text-h6 {{ $t('features.tracking.title') }}
            v-card-text {{ $t('features.tracking.description') }}

      //- System Info Section
      v-expansion-panels
        v-expansion-panel
          v-expansion-panel-title {{ $t('system.title') }}
          v-expansion-panel-text
            v-row
              v-col(cols="12" sm="6")
                v-chip(color="success" variant="flat" class="mr-2 mb-2")
                  | Platform: {{ platformInfo }}
              v-col(cols="12" sm="6")
                v-chip(color="info" variant="flat" class="mr-2 mb-2")
                  | Electron: {{ electronVersion }}

    v-card-actions
      v-btn(color="primary" variant="elevated" disabled)
        | {{ $t('actions.getStarted') }}
</template>

<script setup>
const { locale } = useI18n()
const platformInfo = ref('Unknown')
const electronVersion = ref('N/A')

onMounted(() => {
  if (typeof window !== 'undefined' && window.api) {
    platformInfo.value = window.api.platform || 'Unknown'
    electronVersion.value = window.api.versions?.electron || 'N/A'
  }
})
</script>
