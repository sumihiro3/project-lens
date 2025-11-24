<template>
  <v-card :title="issue.issueKey + ' ' + issue.summary" :subtitle="issue.status?.name">
    <v-card-text>
      <div class="d-flex gap-2 mb-2 align-center flex-wrap">
        <v-chip color="purple" size="small" variant="flat">
          Score: {{ issue.relevance_score }}
        </v-chip>
        <v-chip size="small" :color="getPriorityColor(issue.priority?.name)">
          {{ issue.priority?.name }}
        </v-chip>
        <v-chip size="small" v-if="issue.assignee">
          {{ issue.assignee.name }}
        </v-chip>
        <v-chip size="small" v-if="issue.dueDate" :color="getDueDateColor(issue.dueDate)">
          Due: {{ formatDate(issue.dueDate) }}
        </v-chip>
        <v-chip size="small" :color="getStatusColor(issue.status?.name)">
          {{ issue.status?.name }}
        </v-chip>
      </div>
      <div class="text-truncate">{{ issue.description }}</div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import type { Issue } from '../composables/useIssues'
import { getPriorityColor, getStatusColor, getDueDateColor, formatDate } from '../utils/issueHelpers'

interface Props {
  issue: Issue
}

defineProps<Props>()
</script>
