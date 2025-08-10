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

<script setup>
import { useTheme } from 'vuetify'

const theme = useTheme()
const isDark = computed(() => theme.global.current.value.dark)

const toggleTheme = () => {
  theme.global.name.value = theme.global.current.value.dark ? 'light' : 'dark'
}
</script>
