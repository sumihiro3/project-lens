<template>
  <div>
    <div v-for="issue in issues" :key="issue.id">
      <IssueCard :issue="issue" />
    </div>
    
    <v-alert v-if="issues.length === 0 && !loading" type="info" class="mt-4">
      {{ emptyMessage || $t('dashboard.noFilteredIssues') }}
    </v-alert>
  </div>
</template>

<script setup lang="ts">
import type { Issue } from '../composables/useIssues'
import IssueCard from './IssueCard.vue'

interface Props {
  issues: Issue[]
  loading: boolean
  emptyMessage?: string
}

defineProps<Props>()
</script>
