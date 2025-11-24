<template>
  <div>
    <v-row>
      <v-col v-for="issue in issues" :key="issue.id" cols="12">
        <IssueCard :issue="issue" />
      </v-col>
    </v-row>
    
    <v-alert v-if="issues.length === 0 && !loading" type="info" class="mt-4">
      {{ emptyMessage }}
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

withDefaults(defineProps<Props>(), {
  emptyMessage: 'フィルター条件に一致する課題がありません。'
})
</script>
