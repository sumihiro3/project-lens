/**
 * Backlog増分同期管理サービス
 *
 * Backlog APIからの増分データ同期を管理し、効率的な差分更新を実現します。
 * 前回同期時刻の管理、差分データの計算、同期履歴の管理を提供します。
 *
 * Features:
 * - 前回同期時刻によるupdatedSinceパラメーター自動生成
 * - 差分データの効率的な検出と更新
 * - 同期履歴の管理とクリーンアップ
 * - プロジェクト、イシュー、ユーザー別の同期状態管理
 * - ISO 8601形式の日時処理
 * - 統計収集とメトリクス
 */

import { eq, and, desc, lt, isNull } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/better-sqlite3'
import {
  syncLogs,
  projects,
  type SelectSyncLog,
  type InsertSyncLog,
  type UpdateSyncLog,
} from '../../database/schema'
// 将来の実装のためコメントアウト
// import {
//   issues,
//   users,
//   type SelectProject,
//   type SelectIssue,
//   type SelectUser,
// } from '../../database/schema'
import type {
  BacklogProject,
  BacklogIssue,
  BacklogUser,
  BacklogIssueSearchParams,
} from '../../../../shared/types/backlog'

/**
 * 差分同期パラメータ
 */
export interface IncrementalSyncParams {
  /** 対象スペースID */
  spaceId: string
  /** 対象プロジェクトID（省略時は全プロジェクト） */
  projectId?: number | undefined
  /** 同期タイプ */
  syncType: 'incremental' | 'full'
  /** 強制同期（前回同期時刻を無視） */
  forceSync?: boolean
  /** カスタム開始時刻（ISO 8601形式） */
  customSince?: string
}

/**
 * 差分データ計算結果
 */
export interface DeltaChanges<T> {
  /** 新規作成されたアイテム */
  created: T[]
  /** 更新されたアイテム */
  updated: T[]
  /** 削除されたアイテム（IDのみ） */
  deleted: number[]
  /** 変更なしのアイテム数 */
  unchanged: number
  /** 処理統計 */
  stats: {
    totalProcessed: number
    createdCount: number
    updatedCount: number
    deletedCount: number
    unchangedCount: number
    processingTime: number
  }
}

/**
 * 同期統計情報
 */
export interface SyncStatistics {
  /** 同期セッションID */
  sessionId: string
  /** 開始時刻 */
  startedAt: Date
  /** 完了時刻 */
  completedAt?: Date
  /** 処理時間（ミリ秒） */
  processingTime?: number
  /** 同期されたデータ統計 */
  dataStats: {
    projects: DeltaChanges<BacklogProject>['stats']
    issues: DeltaChanges<BacklogIssue>['stats']
    users: DeltaChanges<BacklogUser>['stats']
  }
  /** エラー情報 */
  errors?: Array<{
    type: string
    message: string
    timestamp: Date
    details?: Record<string, unknown>
  }>
}

/**
 * 同期履歴管理オプション
 */
export interface SyncHistoryOptions {
  /** 保持する履歴数（デフォルト: 100） */
  maxHistoryCount?: number
  /** 履歴保持期間（日数、デフォルト: 30） */
  retentionDays?: number
  /** 自動クリーンアップ有効化（デフォルト: true） */
  enableAutoCleanup?: boolean
}

/**
 * Backlog増分同期管理サービス
 *
 * 効率的な差分同期とデータ整合性管理を提供します。
 */
export class IncrementalSyncManager {
  private readonly db: ReturnType<typeof drizzle>
  private readonly options: Required<SyncHistoryOptions>
  private currentSessionId: string | null = null

  /**
   * コンストラクター
   *
   * @param database - Drizzle ORMデータベースインスタンス
   * @param options - 同期履歴管理オプション
   */
  constructor(
    database: ReturnType<typeof drizzle>,
    options: SyncHistoryOptions = {},
  ) {
    this.db = database
    this.options = {
      maxHistoryCount: options.maxHistoryCount ?? 100,
      retentionDays: options.retentionDays ?? 30,
      enableAutoCleanup: options.enableAutoCleanup ?? true,
    }

    console.log('増分同期管理サービスを初期化しました', {
      options: this.options,
      timestamp: new Date().toISOString(),
    })
  }

  /**
   * updatedSinceパラメーターを取得
   *
   * 前回同期時刻を基に、APIリクエスト用のupdatedSinceパラメーターを生成します。
   *
   * @param params - 同期パラメータ
   * @returns updatedSinceパラメーター（ISO 8601形式）
   */
  async getUpdatedSinceParam(params: IncrementalSyncParams): Promise<string | undefined> {
    try {
      console.log('updatedSinceパラメーターの取得を開始します', {
        spaceId: params.spaceId,
        projectId: params.projectId,
        syncType: params.syncType,
        forceSync: params.forceSync,
      })

      // フル同期または強制同期の場合は時刻指定なし
      if (params.syncType === 'full' || params.forceSync) {
        console.log('フル同期または強制同期のため、updatedSinceは設定しません')
        return undefined
      }

      // カスタム開始時刻が指定されている場合
      if (params.customSince) {
        const customDate = new Date(params.customSince)
        if (isNaN(customDate.getTime())) {
          throw new Error(`無効なカスタム開始時刻です: ${params.customSince}`)
        }
        console.log('カスタム開始時刻を使用します', { customSince: params.customSince })
        return params.customSince
      }

      // 前回同期時刻を取得
      const lastSyncTime = await this.getLastSyncTimestamp(params.spaceId, params.projectId)

      if (!lastSyncTime) {
        console.log('前回同期時刻が見つかりません。初回同期として実行します')
        return undefined
      }

      const updatedSince = lastSyncTime.toISOString()
      console.log('前回同期時刻を基にupdatedSinceパラメーターを生成しました', {
        lastSyncTime: lastSyncTime.toISOString(),
        updatedSince,
      })

      return updatedSince
    }
    catch (error) {
      console.error('updatedSinceパラメーターの取得中にエラーが発生しました', {
        params,
        error: error instanceof Error ? error.message : String(error),
      })
      throw new Error(`updatedSinceパラメーターの取得に失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 同期成功時のタイムスタンプを更新
   *
   * 同期完了後に呼び出し、次回の増分同期のベースとなる時刻を記録します。
   *
   * @param params - 同期パラメータ
   * @param timestamp - 同期完了時刻（省略時は現在時刻）
   */
  async updateSyncTimestamp(
    params: IncrementalSyncParams,
    timestamp: Date = new Date(),
  ): Promise<void> {
    try {
      console.log('同期タイムスタンプの更新を開始します', {
        spaceId: params.spaceId,
        projectId: params.projectId,
        timestamp: timestamp.toISOString(),
      })

      // プロジェクト別の同期時刻を更新
      if (params.projectId) {
        await this.db
          .update(projects)
          .set({
            lastSyncAt: timestamp.toISOString(),
            updatedAt: timestamp.toISOString(),
          })
          .where(eq(projects.backlogProjectId, params.projectId))
      }

      // 同期ログに記録
      await this.recordSyncCompletion(params, timestamp)

      console.log('同期タイムスタンプを更新しました', {
        spaceId: params.spaceId,
        projectId: params.projectId,
        timestamp: timestamp.toISOString(),
      })
    }
    catch (error) {
      console.error('同期タイムスタンプの更新中にエラーが発生しました', {
        params,
        timestamp: timestamp.toISOString(),
        error: error instanceof Error ? error.message : String(error),
      })
      throw new Error(`同期タイムスタンプの更新に失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 差分データの計算と識別
   *
   * 取得したデータと既存データを比較し、作成・更新・削除されたアイテムを特定します。
   *
   * @param fetchedData - APIから取得したデータ
   * @param existingData - 既存のデータベースデータ
   * @param compareKey - 比較に使用するキー（デフォルト: 'id'）
   * @param updatedKey - 更新日時のキー（デフォルト: 'updated'）
   * @returns 差分計算結果
   */
  async calculateDeltaChanges<T extends Record<string, unknown>>(
    fetchedData: T[],
    existingData: T[],
    compareKey: keyof T = 'id',
    updatedKey: keyof T = 'updated',
  ): Promise<DeltaChanges<T>> {
    const startTime = Date.now()

    try {
      console.log('差分データの計算を開始します', {
        fetchedCount: fetchedData.length,
        existingCount: existingData.length,
        compareKey: String(compareKey),
        updatedKey: String(updatedKey),
      })

      // 既存データをMapに変換（高速検索用）
      const existingMap = new Map<T[keyof T], T>()
      for (const item of existingData) {
        existingMap.set(item[compareKey], item)
      }

      // 取得データをMapに変換
      const fetchedMap = new Map<T[keyof T], T>()
      for (const item of fetchedData) {
        fetchedMap.set(item[compareKey], item)
      }

      const created: T[] = []
      const updated: T[] = []
      let unchanged = 0

      // 新規作成・更新を判定
      for (const [key, fetchedItem] of Array.from(fetchedMap.entries())) {
        const existingItem = existingMap.get(key)

        if (!existingItem) {
          // 新規作成
          created.push(fetchedItem)
        }
        else {
          // 更新日時を比較して更新を判定
          const fetchedUpdated = this.parseDate(fetchedItem[updatedKey])
          const existingUpdated = this.parseDate(existingItem[updatedKey])

          if (fetchedUpdated && existingUpdated && fetchedUpdated > existingUpdated) {
            updated.push(fetchedItem)
          }
          else {
            unchanged++
          }
        }
      }

      // 削除を判定（取得データに存在しない既存データ）
      const deleted: number[] = []
      for (const key of Array.from(existingMap.keys())) {
        if (!fetchedMap.has(key)) {
          deleted.push(key as number)
        }
      }

      const processingTime = Date.now() - startTime
      const stats = {
        totalProcessed: fetchedData.length,
        createdCount: created.length,
        updatedCount: updated.length,
        deletedCount: deleted.length,
        unchangedCount: unchanged,
        processingTime,
      }

      console.log('差分データの計算が完了しました', stats)

      return {
        created,
        updated,
        deleted,
        unchanged,
        stats,
      }
    }
    catch (error) {
      const processingTime = Date.now() - startTime
      console.error('差分データの計算中にエラーが発生しました', {
        fetchedCount: fetchedData.length,
        existingCount: existingData.length,
        processingTime,
        error: error instanceof Error ? error.message : String(error),
      })
      throw new Error(`差分データの計算に失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 同期履歴の管理とクリーンアップ
   *
   * 古い同期履歴を削除し、ストレージ使用量を最適化します。
   *
   * @param spaceId - 対象スペースID
   * @param options - クリーンアップオプション
   */
  async manageSyncHistory(
    spaceId: string,
    options: Partial<SyncHistoryOptions> = {},
  ): Promise<void> {
    try {
      const cleanupOptions = { ...this.options, ...options }

      console.log('同期履歴の管理を開始します', {
        spaceId,
        maxHistoryCount: cleanupOptions.maxHistoryCount,
        retentionDays: cleanupOptions.retentionDays,
        enableAutoCleanup: cleanupOptions.enableAutoCleanup,
      })

      if (!cleanupOptions.enableAutoCleanup) {
        console.log('自動クリーンアップが無効のため、同期履歴管理をスキップします')
        return
      }

      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - cleanupOptions.retentionDays)

      // 保持期間を超えた古い履歴を削除
      await this.db
        .delete(syncLogs)
        .where(
          and(
            eq(syncLogs.connectionId, spaceId),
            lt(syncLogs.startedAt, cutoffDate.toISOString()),
          ),
        )

      // 保持数を超えた履歴を削除（最新のもの以外）
      const allLogs = await this.db
        .select({ id: syncLogs.id })
        .from(syncLogs)
        .where(eq(syncLogs.connectionId, spaceId))
        .orderBy(desc(syncLogs.startedAt))

      if (allLogs.length > cleanupOptions.maxHistoryCount) {
        const idsToDelete = allLogs
          .slice(cleanupOptions.maxHistoryCount)
          .map(log => log.id)

        if (idsToDelete.length > 0) {
          await this.db
            .delete(syncLogs)
            .where(
              and(
                eq(syncLogs.connectionId, spaceId),
                // SQLiteではIN句でサブクエリを使用
                ...idsToDelete.map(id => eq(syncLogs.id, id)),
              ),
            )
        }
      }

      console.log('同期履歴の管理が完了しました', {
        spaceId,
        retentionDays: cleanupOptions.retentionDays,
        maxHistoryCount: cleanupOptions.maxHistoryCount,
        cutoffDate: cutoffDate.toISOString(),
      })
    }
    catch (error) {
      console.error('同期履歴の管理中にエラーが発生しました', {
        spaceId,
        options,
        error: error instanceof Error ? error.message : String(error),
      })
      throw new Error(`同期履歴の管理に失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 同期セッションを開始
   *
   * @param params - 同期パラメータ
   * @returns セッションID
   */
  async startSyncSession(params: IncrementalSyncParams): Promise<string> {
    try {
      this.currentSessionId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

      const syncLogEntry: InsertSyncLog = {
        connectionId: params.spaceId,
        projectId: params.projectId ? await this.getLocalProjectId(params.projectId) : null,
        syncType: params.syncType,
        status: 'running',
        startedAt: new Date().toISOString(),
        itemsProcessed: 0,
        itemsUpdated: 0,
        itemsCreated: 0,
        itemsDeleted: 0,
      }

      await this.db.insert(syncLogs).values(syncLogEntry)

      console.log('同期セッションを開始しました', {
        sessionId: this.currentSessionId,
        spaceId: params.spaceId,
        projectId: params.projectId,
        syncType: params.syncType,
      })

      return this.currentSessionId
    }
    catch (error) {
      console.error('同期セッション開始中にエラーが発生しました', {
        params,
        error: error instanceof Error ? error.message : String(error),
      })
      throw new Error(`同期セッションの開始に失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 同期セッションを完了
   *
   * @param sessionId - セッションID
   * @param stats - 同期統計
   * @param error - エラー情報（オプション）
   */
  async completeSyncSession(
    sessionId: string,
    stats: SyncStatistics,
    error?: Error,
  ): Promise<void> {
    try {
      const updateData: UpdateSyncLog = {
        status: error ? 'failed' : 'completed',
        completedAt: new Date().toISOString(),
        itemsProcessed: stats.dataStats.issues.totalProcessed + stats.dataStats.projects.totalProcessed + stats.dataStats.users.totalProcessed,
        itemsCreated: stats.dataStats.issues.createdCount + stats.dataStats.projects.createdCount + stats.dataStats.users.createdCount,
        itemsUpdated: stats.dataStats.issues.updatedCount + stats.dataStats.projects.updatedCount + stats.dataStats.users.updatedCount,
        itemsDeleted: stats.dataStats.issues.deletedCount + stats.dataStats.projects.deletedCount + stats.dataStats.users.deletedCount,
      }

      if (error) {
        updateData.errorMessage = error.message
        updateData.errorDetails = JSON.stringify({
          name: error.name,
          stack: error.stack,
          timestamp: new Date().toISOString(),
        })
      }

      await this.db
        .update(syncLogs)
        .set(updateData)
        .where(eq(syncLogs.connectionId, sessionId))

      if (sessionId === this.currentSessionId) {
        this.currentSessionId = null
      }

      console.log('同期セッションを完了しました', {
        sessionId,
        status: updateData.status,
        itemsProcessed: updateData.itemsProcessed,
        itemsCreated: updateData.itemsCreated,
        itemsUpdated: updateData.itemsUpdated,
        itemsDeleted: updateData.itemsDeleted,
      })
    }
    catch (err) {
      console.error('同期セッション完了中にエラーが発生しました', {
        sessionId,
        originalError: error?.message,
        completionError: err instanceof Error ? err.message : String(err),
      })
      throw new Error(`同期セッションの完了に失敗しました: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * 同期統計を取得
   *
   * @param spaceId - スペースID
   * @param limit - 取得する履歴数（デフォルト: 10）
   * @returns 同期統計の配列
   */
  async getSyncStatistics(spaceId: string, limit: number = 10): Promise<SelectSyncLog[]> {
    try {
      const logs = await this.db
        .select()
        .from(syncLogs)
        .where(eq(syncLogs.connectionId, spaceId))
        .orderBy(desc(syncLogs.startedAt))
        .limit(limit)

      console.log('同期統計を取得しました', {
        spaceId,
        count: logs.length,
        limit,
      })

      return logs
    }
    catch (error) {
      console.error('同期統計の取得中にエラーが発生しました', {
        spaceId,
        limit,
        error: error instanceof Error ? error.message : String(error),
      })
      throw new Error(`同期統計の取得に失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * プロジェクト用増分同期パラメーターを生成
   *
   * @param spaceId - スペースID
   * @param projectId - プロジェクトID（オプション）
   * @returns Backlog API検索パラメータ
   */
  async generateProjectSearchParams(
    spaceId: string,
    projectId?: number,
  ): Promise<Partial<BacklogIssueSearchParams>> {
    const params: IncrementalSyncParams = {
      spaceId,
      ...(projectId && { projectId }),
      syncType: 'incremental',
    }

    const updatedSince = await this.getUpdatedSinceParam(params)

    const searchParams: Partial<BacklogIssueSearchParams> = {}

    if (projectId) {
      searchParams.projectId = [projectId]
    }

    if (updatedSince) {
      searchParams.updatedSince = updatedSince
    }

    // APIリクエスト最適化のための設定
    searchParams.sort = 'updated'
    searchParams.order = 'desc'
    searchParams.count = 100 // バッチサイズ

    console.log('プロジェクト用検索パラメータを生成しました', {
      spaceId,
      projectId,
      updatedSince,
      searchParams,
    })

    return searchParams
  }

  // ===================
  // プライベートメソッド
  // ===================

  /**
   * 前回同期時刻を取得
   */
  private async getLastSyncTimestamp(spaceId: string, projectId?: number): Promise<Date | null> {
    try {
      if (projectId) {
        // プロジェクト別の同期時刻を取得
        const projectData = await this.db
          .select({ lastSyncAt: projects.lastSyncAt })
          .from(projects)
          .where(eq(projects.backlogProjectId, projectId))
          .limit(1)

        if (projectData.length > 0 && projectData[0]?.lastSyncAt) {
          return new Date(projectData[0].lastSyncAt)
        }
      }

      // 全体の最新同期時刻を取得
      const lastSyncLog = await this.db
        .select({ completedAt: syncLogs.completedAt })
        .from(syncLogs)
        .where(
          and(
            eq(syncLogs.connectionId, spaceId),
            eq(syncLogs.status, 'completed'),
            projectId ? eq(syncLogs.projectId, projectId) : isNull(syncLogs.projectId),
          ),
        )
        .orderBy(desc(syncLogs.completedAt))
        .limit(1)

      if (lastSyncLog.length > 0 && lastSyncLog[0]?.completedAt) {
        return new Date(lastSyncLog[0].completedAt)
      }

      return null
    }
    catch (error) {
      console.error('前回同期時刻の取得中にエラーが発生しました', {
        spaceId,
        projectId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /**
   * 同期完了を記録
   */
  private async recordSyncCompletion(
    params: IncrementalSyncParams,
    timestamp: Date,
  ): Promise<void> {
    if (!this.currentSessionId) {
      // セッションが開始されていない場合は新しく作成
      await this.startSyncSession(params)
    }

    // 統計情報はダミーデータ（実際の同期処理で更新される）
    const dummyStats: SyncStatistics = {
      sessionId: this.currentSessionId || '',
      startedAt: new Date(),
      completedAt: timestamp,
      dataStats: {
        projects: { totalProcessed: 0, createdCount: 0, updatedCount: 0, deletedCount: 0, unchangedCount: 0, processingTime: 0 },
        issues: { totalProcessed: 0, createdCount: 0, updatedCount: 0, deletedCount: 0, unchangedCount: 0, processingTime: 0 },
        users: { totalProcessed: 0, createdCount: 0, updatedCount: 0, deletedCount: 0, unchangedCount: 0, processingTime: 0 },
      },
    }

    if (this.currentSessionId) {
      await this.completeSyncSession(this.currentSessionId, dummyStats)
    }
  }

  /**
   * ローカルプロジェクトIDを取得
   */
  private async getLocalProjectId(backlogProjectId: number): Promise<number | null> {
    try {
      const project = await this.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.backlogProjectId, backlogProjectId))
        .limit(1)

      return project.length > 0 ? project[0]?.id || null : null
    }
    catch (error) {
      console.warn('ローカルプロジェクトIDの取得に失敗しました', {
        backlogProjectId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /**
   * 日時文字列をDateオブジェクトに変換
   */
  private parseDate(dateValue: unknown): Date | null {
    if (!dateValue) return null

    try {
      const date = new Date(dateValue as string | number | Date)
      return isNaN(date.getTime()) ? null : date
    }
    catch {
      return null
    }
  }
}

/**
 * 増分同期管理サービスファクトリー関数
 *
 * @param database - Drizzle ORMデータベースインスタンス
 * @param options - 同期履歴管理オプション
 * @returns IncrementalSyncManagerインスタンス
 */
export function createIncrementalSyncManager(
  database: ReturnType<typeof drizzle>,
  options?: SyncHistoryOptions,
): IncrementalSyncManager {
  return new IncrementalSyncManager(database, options)
}

/**
 * 差分統計のサマリー生成
 *
 * @param deltaChanges - 差分計算結果
 * @returns 統計サマリー文字列
 */
export function formatDeltaChangesSummary<T>(deltaChanges: DeltaChanges<T>): string {
  const { stats } = deltaChanges
  return `処理済み: ${stats.totalProcessed}, `
    + `新規: ${stats.createdCount}, `
    + `更新: ${stats.updatedCount}, `
    + `削除: ${stats.deletedCount}, `
    + `変更なし: ${stats.unchangedCount}, `
    + `処理時間: ${stats.processingTime}ms`
}

/**
 * 同期パフォーマンスメトリクスの計算
 *
 * @param stats - 同期統計
 * @returns パフォーマンスメトリクス
 */
export function calculateSyncPerformanceMetrics(stats: SyncStatistics): {
  throughput: number // items/sec
  averageProcessingTime: number // ms per item
  dataEfficiency: number // percentage of actual changes
} {
  const totalItems = stats.dataStats.projects.totalProcessed
    + stats.dataStats.issues.totalProcessed
    + stats.dataStats.users.totalProcessed

  const totalChanges = stats.dataStats.projects.createdCount
    + stats.dataStats.projects.updatedCount
    + stats.dataStats.issues.createdCount
    + stats.dataStats.issues.updatedCount
    + stats.dataStats.users.createdCount
    + stats.dataStats.users.updatedCount

  const processingTime = stats.processingTime || 1
  const throughput = totalItems / (processingTime / 1000)
  const averageProcessingTime = totalItems > 0 ? processingTime / totalItems : 0
  const dataEfficiency = totalItems > 0 ? (totalChanges / totalItems) * 100 : 0

  return {
    throughput,
    averageProcessingTime,
    dataEfficiency,
  }
}

/**
 * デフォルトエクスポート
 */
export default IncrementalSyncManager
