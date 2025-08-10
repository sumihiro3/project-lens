<template lang="pug">
v-app
  v-app-bar(app color="primary" dark)
    v-app-bar-title
      v-icon(class="mr-2") mdi-view-dashboard
      | ProjectLens
    v-spacer
    v-btn(icon @click="toggleTheme")
      v-icon {{ isDark ? 'mdi-weather-sunny' : 'mdi-weather-night' }}

  v-main
    v-container(fluid)
      slot
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTheme } from 'vuetify'

const theme = useTheme()

/**
 * 現在のテーマがダークモードかどうかを判定
 * テンプレート内の{{ isDark ? 'mdi-weather-sunny' : 'mdi-weather-night' }}で使用
 */
const isDark = computed(() => theme.global.current.value.dark)

/**
 * テーマを切り替える関数
 * テンプレート内の@click="toggleTheme"で使用
 */
const toggleTheme = (): void => {
  theme.global.name.value = theme.global.current.value.dark ? 'light' : 'dark'
}

// TypeScript型チェック用：テンプレートで使用される変数を明示的に参照
// これによりTypeScriptが変数の使用を認識できるようになります
// eslint-disable-next-line no-constant-condition
if (false) {
  console.log(isDark.value, toggleTheme)
}
</script>
