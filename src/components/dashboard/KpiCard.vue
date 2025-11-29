<template>
  <v-tooltip :text="tooltip" location="bottom">
    <template v-slot:activator="{ props: tooltipProps }">
      <v-card
        v-bind="tooltipProps"
        :color="color"
        variant="tonal"
        class="kpi-card h-100 cursor-pointer transition-swing"
        @click="$emit('click')"
      >
        <v-card-text class="d-flex flex-column align-center justify-center py-4">
          <v-icon :icon="icon" size="32" class="mb-2" :color="iconColor"></v-icon>
          <div class="text-h3 font-weight-bold mb-1">{{ count }}</div>
          <div class="text-subtitle-2 text-medium-emphasis">{{ title }}</div>
        </v-card-text>
      </v-card>
    </template>
  </v-tooltip>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  title: string
  count: number
  icon: string
  tooltip: string
  color?: string
}>()

defineEmits<{
  (e: 'click'): void
}>()

const iconColor = computed(() => {
  // 背景色が指定されている場合は、アイコンの色を調整
  return props.color ? undefined : props.color
})
</script>

<style scoped>
.kpi-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}
</style>
