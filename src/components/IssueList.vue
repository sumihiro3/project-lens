<template>
  <div>
    <div v-for="issue in issues" :key="issue.id">
      <IssueCard :issue="issue" @open-detail="openDetail" />
    </div>

    <v-alert v-if="issues.length === 0 && !loading" type="info" class="mt-4">
      {{ emptyMessage || $t('dashboard.noFilteredIssues') }}
    </v-alert>

    <!-- 課題詳細ダイアログ -->
    <IssueDetailDialog v-if="selectedIssue" v-model="dialogOpen" :issue="selectedIssue" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { Issue } from '../composables/useIssues'
import IssueCard from './IssueCard.vue'
import IssueDetailDialog from './IssueDetailDialog.vue'

interface Props {
  issues: Issue[]
  loading: boolean
  emptyMessage?: string
}

defineProps<Props>()

const dialogOpen = ref(false)
const selectedIssue = ref<Issue | null>(null)

/**
 * 詳細ダイアログを開く
 */
function openDetail(issue: Issue) {
  selectedIssue.value = issue
  dialogOpen.value = true
}
</script>
