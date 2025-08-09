<template>
  <v-app>
    <v-app-bar app color="primary" dark>
      <v-app-bar-title>
        <v-icon class="mr-2">mdi-view-dashboard</v-icon>
        ProjectLens
      </v-app-bar-title>
      <v-spacer />
      <v-btn icon @click="toggleTheme">
        <v-icon>{{ isDark ? 'mdi-weather-sunny' : 'mdi-weather-night' }}</v-icon>
      </v-btn>
    </v-app-bar>

    <v-main>
      <v-container fluid>
        <slot />
      </v-container>
    </v-main>
  </v-app>
</template>

<script setup>
const theme = useTheme()
const isDark = computed(() => theme.global.current.value.dark)

const toggleTheme = () => {
  theme.global.name.value = theme.global.current.value.dark ? 'light' : 'dark'
}
</script>