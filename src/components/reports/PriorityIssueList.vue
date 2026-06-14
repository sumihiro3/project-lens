<template>
  <!-- 決定的な優先対応リスト（優先理由チップ + 担当 + Backlog 導線）。FR-V046-001 / FR-V046-002 -->
  <div v-if="loading" class="d-flex align-center gap-3 py-4">
    <v-progress-circular indeterminate size="20" color="primary" />
    <span class="text-body-2 text-medium-emphasis">{{ $t('reports.loading') }}</span>
  </div>

  <!-- データ無し時は何も描画しない（degrade 文言は親が出す） -->
  <v-list v-else-if="items.length > 0" density="comfortable" class="priority-list pa-0">
    <v-list-item
      v-for="item in items"
      :key="item.issueKey"
      class="priority-row px-3 py-2"
      @click="emit('open-issue', item.issueKey)"
    >
      <!-- 1段目: プロジェクトキー chip + 課題キー + タイトル -->
      <div class="d-flex align-center gap-2 mb-1">
        <v-chip
          :color="getProjectColor(item.issueKey)"
          size="x-small"
          variant="flat"
          class="project-chip flex-shrink-0"
        >
          {{ item.projectKey }}
        </v-chip>
        <span class="text-caption font-weight-bold text-medium-emphasis flex-shrink-0">
          {{ item.issueKey }}
        </span>
        <span class="text-body-2 text-truncate">{{ item.title }}</span>
      </div>

      <!-- 2段目: 優先理由チップ群 + 担当（連絡先表示） -->
      <div class="d-flex align-center flex-wrap gap-1">
        <v-chip
          v-for="(reason, idx) in item.reasons"
          :key="idx"
          :color="reasonStyle(reason).color"
          size="x-small"
          variant="tonal"
          label
        >
          {{ reasonStyle(reason).label }}
        </v-chip>
        <v-spacer />
        <span class="text-caption flex-shrink-0" :class="assigneeClass(item.assignee)">
          <v-icon size="12" class="mr-1">{{
            item.assignee ? 'mdi-account-check-outline' : 'mdi-account-alert-outline'
          }}</v-icon>
          {{ assigneeLabel(item.assignee) }}
        </span>
      </div>
    </v-list-item>
  </v-list>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { PriorityIssue, PriorityReason } from '../../composables/useReports'
import { getProjectColor } from '../../utils/issueHelpers'

interface Props {
  /** 優先対応リスト（横断上位 + プロジェクト別の1ブロック分。空配列なら何も描画しない） */
  items: PriorityIssue[]
  /** ロード中フラグ（スピナー表示用） */
  loading: boolean
}

interface Emits {
  /** 行クリック（親が Backlog https://{domain}/view/{issueKey} を open で開く。IssueDetailDialog と同方式） */
  (e: 'open-issue', issueKey: string): void
  /** 背景要約への導線（当面 open-issue のみ配線でも可。将来ボタン2分岐用に用意） */
  (e: 'show-background', issueKey: string): void
}

defineProps<Props>()
const emit = defineEmits<Emits>()
const { t } = useI18n()

/**
 * 優先理由を i18n ラベルと Vuetify カラーへマップする（FR-V046-002）
 *
 * 色分け方針: 期限超過・リスク高 = error(赤)、リスク中・停滞 = warning(橙)、
 * 未割当 = info、担当者あり = grey(無彩色)。判別フィールドは Rust serde tag の `type`。
 *
 * @param reason - 優先理由（判別共用体）
 * @returns ラベル文字列と Vuetify カラー名のペア
 */
function reasonStyle(reason: PriorityReason): { label: string; color: string } {
  switch (reason.type) {
    case 'overdue':
      return { label: t('reports.priority.reason.overdue', { days: reason.days }), color: 'error' }
    case 'risk':
      switch (reason.level) {
        case 'high':
          return { label: t('reports.priority.reason.riskHigh'), color: 'error' }
        case 'medium':
          return { label: t('reports.priority.reason.riskMedium'), color: 'warning' }
        default:
          return { label: t('reports.priority.reason.riskLow'), color: 'success' }
      }
    case 'stale':
      return { label: t('reports.priority.reason.stale'), color: 'warning' }
    case 'unassigned':
      return { label: t('reports.priority.reason.unassigned'), color: 'info' }
    case 'assignee':
      return { label: reason.name, color: 'grey' }
    default:
      // 将来 Rust 側に理由種別が増えても描画を落とさない（未知種別は無彩色チップ）
      return { label: '', color: 'grey' }
  }
}

/**
 * 担当状況のラベル（あり=「{name} に確認」 / なし=「要アサイン」）
 */
function assigneeLabel(assignee: string | null): string {
  return assignee
    ? t('reports.priority.assignee.confirm', { name: assignee })
    : t('reports.priority.assignee.unassigned')
}

/**
 * 担当状況に応じた文字色クラス（未割当は注意を促す info 色）
 */
function assigneeClass(assignee: string | null): string {
  return assignee ? 'text-medium-emphasis' : 'text-info font-weight-medium'
}
</script>

<style scoped>
.project-chip {
  font-weight: 600;
  letter-spacing: 0.5px;
  color: white !important;
}

.priority-row {
  cursor: pointer;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  transition: background-color 0.2s ease;
}

.priority-row:hover {
  background-color: rgba(var(--v-theme-primary), 0.08);
}

.priority-row:last-child {
  border-bottom: none;
}
</style>
