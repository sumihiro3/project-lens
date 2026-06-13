import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-shell'
import { useAiSettings } from './useAiSettings'
import type { Issue } from './useIssues'

/**
 * search_similar_issues コマンドの戻り値 1 件（Rust 側 SimilarIssue の camelCase シリアライズに対応）
 *
 * 横断類似検索でヒットした課題 1 件を表す。完了課題（コーパス専用）も含まれ得る。
 */
export interface SimilarIssue {
  /** 課題の DB 内部 ID（Rust `SimilarIssue.issue_id` → `issueId`） */
  issueId: number
  /** 課題キー（例: PROJ-123） */
  issueKey: string
  /** 課題タイトル（1 行要約として表示） */
  summary: string
  /** 課題ステータス名 */
  status?: string
  /** 担当者名 */
  assignee?: string
  /** プロジェクトキー */
  projectKey?: string
  /** クエリ課題とのコサイン類似度（0.0〜1.0） */
  similarity: number
  /**
   * コーパス専用課題（完了課題）かどうか
   * - true の場合、ダッシュボード・一覧・スコア表示には現れない完了課題（FR-V04-003）
   */
  isCorpusOnly: boolean
  /** 所属ワークスペース ID */
  workspaceId: number
}

/**
 * 類似検索を degrade（機能無効化）した理由
 *
 * AI 非対応環境・埋め込み未構築などで検索を提供できない場合に、
 * UI へ理由を提示するための識別子（NFR-V04-005）。
 */
export type SimilarDegradedReason =
  /** AI（FoundationModels）が利用不可 */
  | 'aiUnavailable'
  /** クエリ課題の埋め込みがまだ生成されていない（構築待ち） */
  | 'embeddingNotReady'
  /** 検索コマンド自体が失敗した */
  | 'searchFailed'

// -----------------------------------------------------------------------
// グローバルステート（useAiSettings の module スコープ流儀に倣う）
// ダイアログは同時に 1 つしか開かないため、状態をモジュール単一インスタンスで共有する。
// -----------------------------------------------------------------------

/** 類似検索ダイアログの開閉状態 */
const dialogOpen = ref(false)
/** 検索の起点となったクエリ課題 */
const queryIssue = ref<Issue | null>(null)
/** 横断類似検索の結果（類似度降順） */
const results = ref<SimilarIssue[]>([])
/** 類似検索の実行中フラグ */
const loading = ref(false)
/** 解決策要約のテキスト（未生成時は null） */
const summary = ref<string | null>(null)
/** 解決策要約の生成中フラグ */
const summaryLoading = ref(false)
/** エラー／degrade の理由（正常時は null） */
const degradedReason = ref<SimilarDegradedReason | null>(null)

/**
 * 課題起点の類似検索と解決策要約を管理する Composable
 *
 * - グローバルステートパターンを採用し、カード／詳細ダイアログなど複数の呼び出し元で
 *   同一のダイアログ状態を共有する
 * - AI 非対応・埋め込み未構築時は例外を投げずに静かに degrade し、`degradedReason` に
 *   理由を記録する（NFR-V04-005: 検索機能のみ無効化、既存機能は継続）
 * - 解決策要約の出力言語は UI 言語（vue-i18n の locale = 永続化済み language 設定）に追従する
 */
export function useSimilarSearch() {
  const { locale } = useI18n()
  const { isAiReady } = useAiSettings()

  /**
   * 類似検索ダイアログを開き、横断類似検索→解決策要約を順に実行する
   *
   * 1. クエリ課題の埋め込みが未構築（`embedding_ready === false`）なら degrade して終了
   * 2. `search_similar_issues` を invoke して上位群を取得
   * 3. 結果があり AI 利用可能なら、上位群を `summarize_solutions` へ渡して要約を取得
   *
   * いずれの段階の失敗も例外を投げず `degradedReason` に集約する。
   *
   * @param issue - 検索の起点となる課題
   */
  async function openSimilar(issue: Issue) {
    // ダイアログ状態を初期化してから開く（前回結果の残存を防ぐ）
    queryIssue.value = issue
    results.value = []
    summary.value = null
    degradedReason.value = null
    summaryLoading.value = false
    dialogOpen.value = true

    // 埋め込み未構築なら検索不能。静かに degrade（構築待ち表示は UI 側で行う）
    if (issue.embedding_ready === false) {
      degradedReason.value = 'embeddingNotReady'
      return
    }

    loading.value = true
    try {
      results.value = await invoke<SimilarIssue[]>('search_similar_issues', {
        workspaceId: issue.workspace_id,
        issueId: issue.id,
      })
    } catch (e) {
      console.error('Failed to search similar issues:', e)
      degradedReason.value = 'searchFailed'
      return
    } finally {
      loading.value = false
    }

    // 結果が空、または AI 非対応なら要約はスキップ（検索結果一覧のみ提供）
    if (results.value.length === 0 || !isAiReady.value) {
      if (!isAiReady.value) degradedReason.value = 'aiUnavailable'
      return
    }

    await summarizeResults()
  }

  /**
   * 取得済みの上位類似課題から「過去の対応・解決策」要約を生成する
   *
   * FoundationModels 再利用コマンド `summarize_solutions` を呼ぶ。出力言語は UI 言語に追従。
   * 失敗しても検索結果一覧は維持し、要約のみ degrade する。
   */
  async function summarizeResults() {
    summaryLoading.value = true
    try {
      summary.value = await invoke<string>('summarize_solutions', {
        // 類似検索は単一ワークスペース内で完結するため、クエリ課題の workspace_id を渡す。
        workspaceId: queryIssue.value?.workspace_id,
        // 要約対象は類似課題の DB ID 群。本文・コメントの取得は Rust 側で行う。
        issueIds: results.value.map(r => r.issueId),
        // vue-i18n の locale は永続化済み language 設定を反映する（ja / en）
        lang: locale.value,
      })
    } catch (e) {
      console.error('Failed to summarize solutions:', e)
      // 要約失敗は検索全体の degrade とはしない。要約欄のみ空のままにする。
      summary.value = null
    } finally {
      summaryLoading.value = false
    }
  }

  /**
   * 類似検索ダイアログを閉じる
   *
   * グローバルステートのため、結果・要約は次回 `openSimilar` で初期化される。
   */
  function close() {
    dialogOpen.value = false
  }

  /**
   * 類似候補の課題を既定ブラウザで開く
   *
   * IssueCard / IssueDetailDialog の `openInBrowser` と同じく、ワークスペースのドメインを
   * 引いて Backlog のチケット URL を構築する。失敗しても例外を投げず無視する（導線のみ degrade）。
   *
   * @param item - 開く対象の類似候補（`workspaceId` と `issueKey` を持つ）
   */
  async function openInBrowser(item: SimilarIssue) {
    try {
      const workspace = await invoke<{ id: number; domain: string } | null>('get_workspace_by_id', {
        workspaceId: item.workspaceId,
      })
      if (!workspace?.domain) return
      await open(`https://${workspace.domain}/view/${item.issueKey}`)
    } catch (e) {
      console.error('Failed to open similar issue in browser:', e)
    }
  }

  return {
    // state
    dialogOpen,
    queryIssue,
    results,
    loading,
    summary,
    summaryLoading,
    degradedReason,
    // actions
    openSimilar,
    close,
    openInBrowser,
  }
}
