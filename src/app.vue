<template>
  <v-app>
    <v-app-bar :title="$t('app.title')" color="primary">
      <template v-slot:append>
        <span v-if="lastSyncTime" class="text-caption mr-4">{{ $t('app.lastSynced', { time: lastSyncTime }) }}</span>
        <v-btn icon="mdi-cog" to="/settings"></v-btn>
      </template>
    </v-app-bar>

    <v-navigation-drawer expand-on-hover rail>
      <v-list>
        <v-list-item prepend-icon="mdi-view-dashboard" :title="$t('app.dashboard')" to="/"></v-list-item>
        <v-list-item prepend-icon="mdi-cog" :title="$t('app.settings')" to="/settings"></v-list-item>
      </v-list>
    </v-navigation-drawer>

    <v-main>
      <NuxtPage />
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { listen } from '@tauri-apps/api/event'

const lastSyncTime = ref('')
let unlisten: (() => void) | null = null

onMounted(async () => {
  unlisten = await listen<string>('refresh-issues', (event) => {
    lastSyncTime.value = event.payload
  })
})

onUnmounted(() => {
  if (unlisten) {
    unlisten()
  }
})
</script>
