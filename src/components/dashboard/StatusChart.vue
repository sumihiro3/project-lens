<template>
  <v-card class="h-100">
    <v-card-title class="text-subtitle-1 font-weight-bold">
      {{ $t('dashboard.statusDistribution') }}
    </v-card-title>
    <v-card-subtitle class="text-caption text-medium-emphasis pb-0" style="white-space: normal;">
      {{ $t('dashboard.statusDistributionDescription') }}
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
  statusCounts: Record<string, number>
}>()

const emit = defineEmits<{
  (e: 'click-segment', statusName: string): void
}>()

const theme = useTheme()

const hasData = computed(() => {
  return Object.keys(props.statusCounts).length > 0 && Object.values(props.statusCounts).some(v => v > 0)
})

// ステータスごとの色定義（優しいパステルカラー）
const getStatusColor = (status: string) => {
  const s = status.toLowerCase()
  if (s.includes('完了') || s.includes('closed') || s.includes('done')) return '#81C784' // soft green
  if (s.includes('処理済み') || s.includes('resolved')) return '#AED581' // light lime
  if (s.includes('処理中') || s.includes('in progress') || s.includes('working')) return '#64B5F6' // soft blue
  if (s.includes('レビュー') || s.includes('review')) return '#FFB74D' // soft orange
  if (s.includes('未対応') || s.includes('open') || s.includes('new')) return '#E57373' // soft red
  return '#BDBDBD' // soft grey
}

const chartData = computed<ChartData<'doughnut'>>(() => {
  const labels = Object.keys(props.statusCounts)
  const data = Object.values(props.statusCounts)
  const backgroundColor = labels.map(getStatusColor)

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
