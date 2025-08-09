<template>
  <div class="pa-4">
    <h1 class="text-h3 mb-4">ProjectLens</h1>
    <v-card class="pa-4">
      <v-card-title>Welcome to ProjectLens</v-card-title>
      <v-card-text>
        <p>Backlog ticket management desktop application</p>
        <v-divider class="my-4" />
        <v-row>
          <v-col cols="6">
            <v-chip color="success" variant="flat">
              Platform: {{ platformInfo }}
            </v-chip>
          </v-col>
          <v-col cols="6">
            <v-chip color="info" variant="flat">
              Electron: {{ electronVersion }}
            </v-chip>
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-btn color="primary" variant="elevated" disabled>
          Get Started
        </v-btn>
      </v-card-actions>
    </v-card>
  </div>
</template>

<script setup>
const platformInfo = ref('Unknown')
const electronVersion = ref('N/A')

onMounted(() => {
  if (typeof window !== 'undefined' && window.api) {
    platformInfo.value = window.api.platform || 'Unknown'
    electronVersion.value = window.api.versions?.electron || 'N/A'
  }
})
</script>