<template>
  <v-container class="fill-height d-flex flex-column align-center justify-center text-center" style="user-select: none;">
    <v-img
      :src="logoUrl"
      width="128"
      height="128"
      class="mb-4"
    ></v-img>
    
    <h1 class="text-h4 font-weight-bold mb-2">ProjectLens</h1>
    <p class="text-subtitle-1 text-medium-emphasis mb-6">Version {{ version }}</p>
    
    <v-btn
      color="primary"
      prepend-icon="mdi-web"
      @click="openWebsite"
      class="mb-8"
    >
      Website
    </v-btn>
    
    <div class="text-caption text-disabled">
      <p>© 2025 TEP Lab. All rights reserved.</p>
    </div>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getVersion } from '@tauri-apps/api/app'
import { open } from '@tauri-apps/plugin-shell'
import { invoke } from '@tauri-apps/api/core'
import { useI18n } from 'vue-i18n'
import logoImage from '~/public/logo.png'

const { locale } = useI18n()
const version = ref('')
const logoUrl = logoImage

const openWebsite = async () => {
  try {
    await open('https://project-lens.netlify.app')
  } catch (e) {
    console.error('Failed to open website:', e)
  }
}

onMounted(async () => {
  try {
    version.value = await getVersion()
    
    // 設定から言語を取得して適用
    try {
      const storedLang = await invoke<string | null>('get_settings', { key: 'language' })
      if (storedLang && (storedLang === 'en' || storedLang === 'ja')) {
        locale.value = storedLang
      }
    } catch (e) {
      console.error('Failed to load language setting:', e)
    }
  } catch (e) {
    console.error('Failed to get version', e)
    version.value = '0.2.2' // Fallback
  }
})

// ページメタデータ設定
definePageMeta({
  layout: 'blank' 
})
</script>
