<template>
  <v-app>
    <v-app-bar color="primary">
      <template v-slot:prepend>
        <v-tooltip v-if="!mdAndUp" :text="$t('app.toggleMenu')" location="bottom">
          <template v-slot:activator="{ props }">
            <v-app-bar-nav-icon v-bind="props" @click="drawer = !drawer" class="mr-2"></v-app-bar-nav-icon>
          </template>
        </v-tooltip>
        <img :src="logoUrl" alt="ProjectLens" width="48" height="48" class="ml-2 mr-0" />
      </template>
      <v-app-bar-title class="font-weight-black ml-1">{{ $t('app.title') }}</v-app-bar-title>
      <template v-slot:append>
        <span v-if="lastSyncTime" class="text-caption mr-4">{{ $t('app.lastSynced', { time: lastSyncTime }) }}</span>
      </template>
    </v-app-bar>

    <v-navigation-drawer 
      v-model="drawer"
      :permanent="mdAndUp"
      :rail="mdAndUp"
      :expand-on-hover="mdAndUp"
    >
      <v-list>
        <v-tooltip :text="$t('app.goToDashboard')" location="right">
          <template v-slot:activator="{ props }">
            <v-list-item 
              v-bind="props"
              prepend-icon="mdi-view-dashboard" 
              :title="$t('app.dashboard')" 
              to="/"
              @click="onNavigate"
            ></v-list-item>
          </template>
        </v-tooltip>
        <v-tooltip :text="$t('app.goToIssueList')" location="right">
          <template v-slot:activator="{ props }">
            <v-list-item 
              v-bind="props"
              prepend-icon="mdi-format-list-bulleted" 
              :title="$t('app.issueList')" 
              to="/issues"
              @click="onNavigate"
            ></v-list-item>
          </template>
        </v-tooltip>
        <v-tooltip :text="$t('app.goToSettings')" location="right">
          <template v-slot:activator="{ props }">
            <v-list-item 
              v-bind="props"
              prepend-icon="mdi-cog" 
              :title="$t('app.settings')" 
              to="/settings"
              @click="onNavigate"
            ></v-list-item>
          </template>
        </v-tooltip>
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
import { useDisplay } from 'vuetify'
import logoImage from '~/public/logo.png'

const { mdAndUp } = useDisplay()

const logoUrl = logoImage
const lastSyncTime = ref('')
const drawer = ref(true)
let unlisten: (() => void) | null = null

// モバイル画面でナビゲーション後にドロワーを閉じる
const onNavigate = () => {
  if (!mdAndUp.value) {
    drawer.value = false
  }
}

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
