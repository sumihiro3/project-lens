<template>
  <v-card class="h-100">
    <v-card-title class="text-subtitle-1 font-weight-bold">
      {{ $t('dashboard.priorityDistribution') }}
    </v-card-title>
    <v-card-subtitle class="text-caption text-medium-emphasis pb-0" style="white-space: normal;">
      {{ $t('dashboard.priorityDistributionDescription') }}
    </v-card-subtitle>
    <v-card-text class="d-flex align-center justify-center" style="height: 300px; position: relative;">
      <Doughnut v-if="hasData" :data="chartData" :options="chartOptions" />
      <div v-else class="text-center text-medium-emphasis">
        {{ $t('dashboard.noData') }}
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Chart as ChartJS, ArcElement, Tooltip, Legend, type ChartData, type ChartOptions } from 'chart.js'
import { Doughnut } from 'vue-chartjs'
import { useTheme } from 'vuetify'

// Chart.js のコンポーネントを登録
ChartJS.register(ArcElement, Tooltip, Legend)

const props = defineProps<{
  priorityCounts: Record<string, number>
}>()

const emit = defineEmits<{
  (e: 'click-segment', priorityName: string): void
}>()

const theme = useTheme()

const hasData = computed(() => {
  return Object.keys(props.priorityCounts).length > 0 && Object.values(props.priorityCounts).some(v => v > 0)
})

// 優先度ごとの色定義（優しいパステルカラー）
const getPriorityColor = (priority: string) => {
  const p = priority.toLowerCase()
  if (p.includes('高') || p.includes('high') || p.includes('highest')) return '#E57373' // soft red
  if (p.includes('中') || p.includes('normal') || p.includes('medium')) return '#FFB74D' // soft orange
  if (p.includes('低') || p.includes('low') || p.includes('lowest')) return '#64B5F6' // soft blue
  return '#BDBDBD' // soft grey
}

const chartData = computed<ChartData<'doughnut'>>(() => {
  const labels = Object.keys(props.priorityCounts)
  const data = Object.values(props.priorityCounts)
  const backgroundColor = labels.map(getPriorityColor)

  return {
    labels,
    datasets: [
      {
        data,
        backgroundColor,
        borderWidth: 2,
        borderColor: theme.global.current.value.dark ? '#1E1E1E' : '#FFFFFF'
      }
    ]
  }
})

const chartOptions = computed<ChartOptions<'doughnut'>>(() => {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right',
        labels: {
          color: theme.global.current.value.dark ? '#FFFFFF' : '#000000',
          font: {
            family: 'Inter, sans-serif'
          }
        }
      }
    },
    onHover: (event, elements) => {
      const target = event.native?.target as HTMLElement
      if (target) {
        target.style.cursor = elements.length > 0 ? 'pointer' : 'default'
      }
    },
    onClick: (event, elements, chart) => {
      if (elements.length > 0 && chart.data.labels) {
        const element = elements[0]
        if (element) {
          const index = element.index
          const label = chart.data.labels[index]
          if (label && typeof label === 'string') {
            emit('click-segment', label)
          }
        }
      }
    }
  }
})
</script>
