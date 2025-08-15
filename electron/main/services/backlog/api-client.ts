/**
 * Backlog Direct API接続管理サービス
 *
 * Backlog APIとの通信を管理し、型安全な方法でAPIリクエストを実行します。
 * Node.js標準のfetchを使用し、認証、レスポンス処理、エラーハンドリングを提供します。
 * Electron safeStorageを使用したAPIキー暗号化に対応。
 */

import { safeStorage } from 'electron'
import type {
  BacklogSpace,
  BacklogUser,
  BacklogProject,
  BacklogIssue,
  BacklogIssueSearchParams,
  BacklogApiConfig,
  BacklogCategory,
  BacklogVersion,
  BacklogMilestone,
  BacklogIssueType,
  BacklogPriority,
  BacklogStatus,
} from '../../../../shared/types/backlog'
import type { ApiResponse } from '../../../../shared/types/common'

/**
 * Backlog APIエラー情報
 */
export interface BacklogApiError {
  code: string
  message: string
  details?: Record<string, unknown>
  httpStatus?: number
}

/**
 * 入力検証エラー
 */
export class InputValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message)
    this.name = 'InputValidationError'
  }
}

/**
 * APIリクエストオプション
 */
export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  params?: Record<string, string | number | boolean | undefined>
  body?: Record<string, unknown>
  timeout?: number
}

/**
 * リクエスト制限管理用
 */
interface RateLimitInfo {
  remaining: number
  resetTime: number
  limit: number
}

/**
 * 暗号化されたAPIキー設定
 */
export interface SecureBacklogApiConfig {
  spaceId: string
  encryptedApiKey: Buffer
  host?: string
}

/**
 * Backlog APIクライアント
 *
 * Backlog APIとの通信を管理し、型安全なメソッドを提供します。
 * 認証、レート制限、エラーハンドリングを自動で処理します。
 * Electron safeStorageによるAPIキー暗号化をサポート。
 */
export class BacklogApiClient {
  private readonly config: BacklogApiConfig
  private readonly baseUrl: string
  private rateLimitInfo: RateLimitInfo | null = null
  private readonly isSecureMode: boolean

  /**
   * コンストラクター
   *
   * @param config - Backlog API設定（暗号化済みまたは平文）
   */
  constructor(config: BacklogApiConfig | SecureBacklogApiConfig) {
    if (this.isSecureConfig(config)) {
      // 暗号化されたAPIキーをデクリプト
      this.config = this.decryptConfig(config)
      this.isSecureMode = true
    }
    else {
      // 平文設定をそのまま使用（開発時のみ）
      this.config = config
      this.isSecureMode = false
      console.warn('APIキーが平文で設定されています。本番環境では暗号化を使用してください。')
    }

    this.baseUrl = this.buildBaseUrl(this.config)

    console.log('Backlog APIクライアントを初期化しました', {
      spaceId: this.config.spaceId,
      host: this.config.host || 'backlog.jp',
      baseUrl: this.baseUrl,
      secureMode: this.isSecureMode,
    })
  }

  /**
   * ベースURLを構築
   */
  private buildBaseUrl(config: BacklogApiConfig): string {
    const host = config.host || 'backlog.jp'
    return `https://${config.spaceId}.${host}/api/v2`
  }

  /**
   * 暗号化設定かどうかを判定
   */
  private isSecureConfig(config: BacklogApiConfig | SecureBacklogApiConfig): config is SecureBacklogApiConfig {
    return 'encryptedApiKey' in config && Buffer.isBuffer(config.encryptedApiKey)
  }

  /**
   * 暗号化されたAPIキー設定をデクリプト
   */
  private decryptConfig(secureConfig: SecureBacklogApiConfig): BacklogApiConfig {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Electronの暗号化機能が利用できません')
    }

    try {
      const decryptedApiKey = safeStorage.decryptString(secureConfig.encryptedApiKey)
      return {
        spaceId: secureConfig.spaceId,
        apiKey: decryptedApiKey,
        host: secureConfig.host,
      }
    }
    catch (error) {
      throw new Error(`APIキーの復号化に失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 認証ヘッダーを取得
   */
  private getAuthHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
    }
  }

  /**
   * URLパラメータを構築
   */
  private buildParams(params: Record<string, string | number | boolean | undefined>): string {
    const searchParams = new URLSearchParams()

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value))
      }
    })

    return searchParams.toString()
  }

  /**
   * HTTPリクエストを実行
   */
  private async makeRequest<T>(
    endpoint: string,
    options: ApiRequestOptions = {},
  ): Promise<ApiResponse<T>> {
    const {
      method = 'GET',
      params = {},
      body,
      timeout = 30000,
    } = options

    try {
      console.log('Backlog APIリクエストを開始', {
        endpoint,
        method,
        params: Object.keys(params).length > 0 ? params : undefined,
      })

      // URLを構築
      let url = `${this.baseUrl}${endpoint}`
      if (method === 'GET' && Object.keys(params).length > 0) {
        const paramString = this.buildParams(params)
        url += `?${paramString}`
      }

      // リクエストヘッダーを準備
      const headers = this.getAuthHeaders()

      // AbortControllerでタイムアウトを設定
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      // リクエストオプションを構築
      const requestOptions: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      }

      // POST/PUTの場合はボディを追加
      if ((method === 'POST' || method === 'PUT') && body) {
        requestOptions.body = JSON.stringify(body)
      }

      // リクエストを実行
      const startTime = Date.now()
      const response = await fetch(url, requestOptions)
      clearTimeout(timeoutId)

      const responseTime = Date.now() - startTime
      console.log('Backlog APIレスポンスを受信', {
        endpoint,
        status: response.status,
        statusText: response.statusText,
        responseTime,
      })

      // レート制限情報を更新
      this.updateRateLimitInfo(response)

      // レスポンス検証
      if (!response.ok) {
        await this.handleErrorResponse(response, endpoint)
      }

      // JSONレスポンスをパース
      const data: T = await response.json()

      return {
        success: true,
        data,
        timestamp: new Date().toISOString(),
      }
    }
    catch (error) {
      console.error('Backlog APIリクエストでエラーが発生', {
        endpoint,
        method,
        error: error instanceof Error ? error.message : String(error),
      })

      return this.handleRequestError(error, endpoint)
    }
  }

  /**
   * レート制限情報を更新
   */
  private updateRateLimitInfo(response: Response): void {
    const remaining = response.headers.get('X-RateLimit-Remaining')
    const reset = response.headers.get('X-RateLimit-Reset')
    const limit = response.headers.get('X-RateLimit-Limit')

    if (remaining && reset && limit) {
      this.rateLimitInfo = {
        remaining: parseInt(remaining, 10),
        resetTime: parseInt(reset, 10) * 1000, // Unixタイムスタンプをミリ秒に変換
        limit: parseInt(limit, 10),
      }

      console.log('レート制限情報を更新', this.rateLimitInfo)
    }
  }

  /**
   * エラーレスポンスを処理
   */
  private async handleErrorResponse(response: Response, endpoint: string): Promise<never> {
    let errorDetails: Record<string, unknown> = {}

    try {
      errorDetails = await response.json()
    }
    catch {
      // JSONパースに失敗した場合は空のオブジェクトを使用
    }

    const apiError: BacklogApiError = {
      code: `HTTP_${response.status}`,
      message: this.getErrorMessage(response.status, errorDetails),
      details: errorDetails,
      httpStatus: response.status,
    }

    console.error('Backlog APIエラーレスポンス', {
      endpoint,
      status: response.status,
      statusText: response.statusText,
      errorDetails,
    })

    throw new Error(`Backlog API Error [${apiError.code}]: ${apiError.message}`)
  }

  /**
   * エラーメッセージを取得
   */
  private getErrorMessage(status: number, details: Record<string, unknown>): string {
    // Backlog APIのエラー詳細があれば使用
    if (details.message && typeof details.message === 'string') {
      return details.message
    }

    // HTTPステータスコードに基づくデフォルトメッセージ
    switch (status) {
      case 400:
        return 'リクエストパラメータが不正です'
      case 401:
        return 'APIキーが無効または期限切れです'
      case 403:
        return 'このリソースへのアクセス権限がありません'
      case 404:
        return 'リソースが見つかりません'
      case 429:
        return 'APIリクエスト制限に達しました。しばらく待ってから再試行してください'
      case 500:
        return 'Backlogサーバーで内部エラーが発生しました'
      case 503:
        return 'Backlogサービスが一時的に利用できません'
      default:
        return `未知のエラーが発生しました (HTTP ${status})`
    }
  }

  /**
   * リクエストエラーを処理
   */
  private handleRequestError<T>(error: unknown, endpoint: string): ApiResponse<T> {
    let errorMessage: string

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        errorMessage = 'リクエストがタイムアウトしました'
      }
      else if (error.message.includes('fetch')) {
        errorMessage = 'ネットワークエラーが発生しました。インターネット接続を確認してください'
      }
      else {
        errorMessage = error.message
      }
    }
    else {
      errorMessage = '不明なエラーが発生しました'
    }

    console.error('Backlog APIリクエストエラー', {
      endpoint,
      errorMessage,
      errorType: error instanceof Error ? error.constructor.name : typeof error,
    })

    return {
      success: false,
      error: errorMessage,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * スペース情報を取得
   */
  public async getSpace(): Promise<ApiResponse<BacklogSpace>> {
    console.log('スペース情報を取得中...')
    return this.makeRequest<BacklogSpace>('/space')
  }

  /**
   * 現在のユーザー情報を取得
   */
  public async getCurrentUser(): Promise<ApiResponse<BacklogUser>> {
    console.log('現在のユーザー情報を取得中...')
    return this.makeRequest<BacklogUser>('/users/myself')
  }

  /**
   * ユーザー一覧を取得
   */
  public async getUsers(): Promise<ApiResponse<BacklogUser[]>> {
    console.log('ユーザー一覧を取得中...')
    return this.makeRequest<BacklogUser[]>('/users')
  }

  /**
   * 特定のユーザー情報を取得
   */
  public async getUser(userId: number): Promise<ApiResponse<BacklogUser>> {
    this.validateUserId(userId)
    console.log('ユーザー情報を取得中...', { userId })
    return this.makeRequest<BacklogUser>(`/users/${userId}`)
  }

  /**
   * プロジェクト一覧を取得
   */
  public async getProjects(): Promise<ApiResponse<BacklogProject[]>> {
    console.log('プロジェクト一覧を取得中...')
    return this.makeRequest<BacklogProject[]>('/projects')
  }

  /**
   * 特定のプロジェクト情報を取得
   */
  public async getProject(projectIdOrKey: string | number): Promise<ApiResponse<BacklogProject>> {
    this.validateProjectIdOrKey(projectIdOrKey)
    console.log('プロジェクト情報を取得中...', { projectIdOrKey })
    return this.makeRequest<BacklogProject>(`/projects/${projectIdOrKey}`)
  }

  /**
   * プロジェクトのカテゴリ一覧を取得
   */
  public async getProjectCategories(projectIdOrKey: string | number): Promise<ApiResponse<BacklogCategory[]>> {
    this.validateProjectIdOrKey(projectIdOrKey)
    console.log('プロジェクトカテゴリ一覧を取得中...', { projectIdOrKey })
    return this.makeRequest<BacklogCategory[]>(`/projects/${projectIdOrKey}/categories`)
  }

  /**
   * プロジェクトのバージョン一覧を取得
   */
  public async getProjectVersions(projectIdOrKey: string | number): Promise<ApiResponse<BacklogVersion[]>> {
    this.validateProjectIdOrKey(projectIdOrKey)
    console.log('プロジェクトバージョン一覧を取得中...', { projectIdOrKey })
    return this.makeRequest<BacklogVersion[]>(`/projects/${projectIdOrKey}/versions`)
  }

  /**
   * プロジェクトのマイルストーン一覧を取得
   */
  public async getProjectMilestones(projectIdOrKey: string | number): Promise<ApiResponse<BacklogMilestone[]>> {
    this.validateProjectIdOrKey(projectIdOrKey)
    console.log('プロジェクトマイルストーン一覧を取得中...', { projectIdOrKey })
    return this.makeRequest<BacklogMilestone[]>(`/projects/${projectIdOrKey}/versions`)
  }

  /**
   * プロジェクトのイシュータイプ一覧を取得
   */
  public async getProjectIssueTypes(projectIdOrKey: string | number): Promise<ApiResponse<BacklogIssueType[]>> {
    this.validateProjectIdOrKey(projectIdOrKey)
    console.log('プロジェクトイシュータイプ一覧を取得中...', { projectIdOrKey })
    return this.makeRequest<BacklogIssueType[]>(`/projects/${projectIdOrKey}/issueTypes`)
  }

  /**
   * 優先度一覧を取得
   */
  public async getPriorities(): Promise<ApiResponse<BacklogPriority[]>> {
    console.log('優先度一覧を取得中...')
    return this.makeRequest<BacklogPriority[]>('/priorities')
  }

  /**
   * プロジェクトの状態一覧を取得
   */
  public async getProjectStatuses(projectIdOrKey: string | number): Promise<ApiResponse<BacklogStatus[]>> {
    this.validateProjectIdOrKey(projectIdOrKey)
    console.log('プロジェクト状態一覧を取得中...', { projectIdOrKey })
    return this.makeRequest<BacklogStatus[]>(`/projects/${projectIdOrKey}/statuses`)
  }

  /**
   * イシュー一覧を検索・取得
   */
  public async getIssues(params: BacklogIssueSearchParams = {}): Promise<ApiResponse<BacklogIssue[]>> {
    this.validateIssueSearchParams(params)
    console.log('イシュー一覧を検索中...', {
      projectIds: params.projectId?.length,
      keyword: params.keyword,
      statusIds: params.statusId?.length,
    })

    // 配列パラメータを適切に処理
    const searchParams: Record<string, string | number | boolean | undefined> = {}

    Object.entries(params).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        // 配列の場合は複数のパラメータとして展開
        value.forEach((item, index) => {
          searchParams[`${key}[${index}]`] = item
        })
      }
      else {
        searchParams[key] = value
      }
    })

    return this.makeRequest<BacklogIssue[]>('/issues', {
      params: searchParams,
    })
  }

  /**
   * 特定のイシュー情報を取得
   */
  public async getIssue(issueIdOrKey: string | number): Promise<ApiResponse<BacklogIssue>> {
    this.validateIssueIdOrKey(issueIdOrKey)
    console.log('イシュー情報を取得中...', { issueIdOrKey })
    return this.makeRequest<BacklogIssue>(`/issues/${issueIdOrKey}`)
  }

  /**
   * イシューのコメント一覧を取得
   */
  public async getIssueComments(issueIdOrKey: string | number): Promise<ApiResponse<Comment[]>> {
    this.validateIssueIdOrKey(issueIdOrKey)
    console.log('イシューコメント一覧を取得中...', { issueIdOrKey })
    return this.makeRequest<Comment[]>(`/issues/${issueIdOrKey}/comments`)
  }

  /**
   * API接続をテスト
   */
  public async testConnection(): Promise<ApiResponse<{ connected: boolean, user?: BacklogUser, space?: BacklogSpace }>> {
    console.log('Backlog API接続をテスト中...')

    try {
      // スペース情報と現在のユーザー情報を並行取得してテスト
      const [spaceResponse, userResponse] = await Promise.all([
        this.getSpace(),
        this.getCurrentUser(),
      ])

      if (spaceResponse.success && userResponse.success) {
        console.log('Backlog API接続テストが成功しました', {
          space: spaceResponse.data?.name,
          user: userResponse.data?.name,
        })

        return {
          success: true,
          data: {
            connected: true,
            ...(userResponse.data && { user: userResponse.data }),
            ...(spaceResponse.data && { space: spaceResponse.data }),
          },
          timestamp: new Date().toISOString(),
        }
      }
      else {
        const error = spaceResponse.error || userResponse.error || '接続テストに失敗しました'
        console.error('Backlog API接続テストが失敗しました', { error })

        return {
          success: false,
          error,
          timestamp: new Date().toISOString(),
        }
      }
    }
    catch (error) {
      console.error('Backlog API接続テストでエラーが発生', {
        error: error instanceof Error ? error.message : String(error),
      })

      return {
        success: false,
        error: error instanceof Error ? error.message : '接続テストでエラーが発生しました',
        timestamp: new Date().toISOString(),
      }
    }
  }

  /**
   * レート制限情報を取得
   */
  public getRateLimitInfo(): RateLimitInfo | null {
    return this.rateLimitInfo
  }

  /**
   * 設定情報を取得
   */
  public getConfig(): Readonly<BacklogApiConfig> {
    return Object.freeze({ ...this.config })
  }

  /**
   * APIクライアントのヘルス状態をチェック
   */
  public async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy'
    checks: Record<string, boolean>
    rateLimitInfo?: RateLimitInfo
    responseTime?: number
  }> {
    console.log('Backlog APIクライアントのヘルスチェックを実行中...')

    const checks: Record<string, boolean> = {}
    let responseTime: number | undefined

    try {
      const startTime = Date.now()
      const connectionTest = await this.testConnection()
      responseTime = Date.now() - startTime

      checks.connection = connectionTest.success
      checks.authentication = connectionTest.success

      // レート制限チェック（接続が失敗している場合はfalseとする）
      if (!checks.connection) {
        checks.rateLimit = false // 接続できない場合はレート制限チェックも失敗扱い
      }
      else if (this.rateLimitInfo) {
        checks.rateLimit = this.rateLimitInfo.remaining > 0
      }
      else {
        checks.rateLimit = true // 初回は不明なのでtrueとする
      }

      // 総合的な状態判定
      const allChecksPass = Object.values(checks).every(check => check)
      const someChecksPass = Object.values(checks).some(check => check)

      let status: 'healthy' | 'degraded' | 'unhealthy'
      if (allChecksPass) {
        status = 'healthy'
      }
      else if (someChecksPass) {
        status = 'degraded'
      }
      else {
        status = 'unhealthy'
      }

      console.log('Backlog APIクライアントヘルスチェック完了', {
        status,
        checks,
        responseTime,
        rateLimitInfo: this.rateLimitInfo,
      })

      return {
        status,
        checks,
        ...(this.rateLimitInfo && { rateLimitInfo: this.rateLimitInfo }),
        ...(responseTime !== undefined && { responseTime }),
      }
    }
    catch (error) {
      console.error('Backlog APIクライアントヘルスチェックでエラーが発生', {
        error: error instanceof Error ? error.message : String(error),
      })

      return {
        status: 'unhealthy',
        checks: { connection: false, authentication: false, rateLimit: false },
      }
    }
  }

  /**
   * セキュリティ情報を取得
   */
  public getSecurityInfo(): { isSecureMode: boolean, encryptionAvailable: boolean } {
    return {
      isSecureMode: this.isSecureMode,
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
    }
  }

  /**
   * 汎用APIリクエストメソッド（テスト用）
   */
  public async request<T>(
    endpoint: string,
    options?: ApiRequestOptions,
  ): Promise<ApiResponse<T>> {
    return this.makeRequest<T>(endpoint, options)
  }

  /**
   * 入力検証メソッド群
   */
  private validateUserId(userId: number): void {
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new InputValidationError('ユーザーIDは正の整数である必要があります', 'userId')
    }
  }

  private validateProjectIdOrKey(projectIdOrKey: string | number): void {
    if (typeof projectIdOrKey === 'number') {
      if (!Number.isInteger(projectIdOrKey) || projectIdOrKey <= 0) {
        throw new InputValidationError('プロジェクトIDは正の整数である必要があります', 'projectIdOrKey')
      }
    }
    else if (typeof projectIdOrKey === 'string') {
      if (!projectIdOrKey.trim() || !/^[A-Z0-9_-]+$/i.test(projectIdOrKey.trim())) {
        throw new InputValidationError('プロジェクトキーは英数字、アンダースコア、ハイフンのみ使用可能です', 'projectIdOrKey')
      }
    }
    else {
      throw new InputValidationError('プロジェクトIDまたはキーが無効です', 'projectIdOrKey')
    }
  }

  private validateIssueIdOrKey(issueIdOrKey: string | number): void {
    if (typeof issueIdOrKey === 'number') {
      if (!Number.isInteger(issueIdOrKey) || issueIdOrKey <= 0) {
        throw new InputValidationError('イシューIDは正の整数である必要があります', 'issueIdOrKey')
      }
    }
    else if (typeof issueIdOrKey === 'string') {
      if (!issueIdOrKey.trim() || !/^[A-Z0-9_-]+-\d+$/i.test(issueIdOrKey.trim())) {
        throw new InputValidationError('イシューキーの形式が正しくありません（例: PROJECT-123）', 'issueIdOrKey')
      }
    }
    else {
      throw new InputValidationError('イシューIDまたはキーが無効です', 'issueIdOrKey')
    }
  }

  private validateIssueSearchParams(params: BacklogIssueSearchParams): void {
    // 数値配列の検証
    const numericArrayFields = [
      'projectId', 'issueTypeId', 'categoryId', 'versionId', 'milestoneId',
      'statusId', 'priorityId', 'assigneeId', 'createdUserId', 'resolutionId', 'id', 'parentIssueId',
    ] as const

    for (const field of numericArrayFields) {
      const value = params[field]
      if (value !== undefined && value !== null) {
        if (!Array.isArray(value)) {
          throw new InputValidationError(`${field}は配列である必要があります`, field)
        }
        if (value.some(id => !Number.isInteger(id) || id <= 0)) {
          throw new InputValidationError(`${field}の値は正の整数である必要があります`, field)
        }
      }
    }

    // キーワード検証
    if (params.keyword !== undefined) {
      if (typeof params.keyword !== 'string' || params.keyword.length > 500) {
        throw new InputValidationError('キーワードは500文字以下の文字列である必要があります', 'keyword')
      }
    }

    // ページング検証
    if (params.offset !== undefined) {
      if (!Number.isInteger(params.offset) || params.offset < 0) {
        throw new InputValidationError('オフセットは0以上の整数である必要があります', 'offset')
      }
    }

    if (params.count !== undefined) {
      if (!Number.isInteger(params.count) || params.count <= 0 || params.count > 100) {
        throw new InputValidationError('カウントは1-100の整数である必要があります', 'count')
      }
    }

    // ソート順検証
    const validSortFields = [
      'issueType', 'category', 'version', 'milestone', 'summary', 'status', 'priority',
      'attachment', 'sharedFile', 'created', 'createdUser', 'updated', 'updatedUser',
      'assignee', 'startDate', 'dueDate', 'estimatedHours', 'actualHours', 'childIssue',
    ] as const

    if (params.sort !== undefined && !validSortFields.includes(params.sort)) {
      throw new InputValidationError(`無効なソートフィールド: ${params.sort}`, 'sort')
    }

    if (params.order !== undefined && !['asc', 'desc'].includes(params.order)) {
      throw new InputValidationError('ソート順はascまたはdescである必要があります', 'order')
    }
  }

  /**
   * APIクライアントを破棄
   */
  public destroy(): void {
    console.log('Backlog APIクライアントを破棄しました')
    // 現在は特に破棄処理は不要だが、将来的にはコネクションプールなどの後始末をここで行う
  }
}

/**
 * APIキーを暗号化
 *
 * @param apiKey - 平文のAPIキー
 * @returns 暗号化されたAPIキー
 */
export function encryptApiKey(apiKey: string): Buffer {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Electronの暗号化機能が利用できません')
  }

  return safeStorage.encryptString(apiKey)
}

/**
 * セキュアなBacklog API設定を作成
 *
 * @param spaceId - BacklogスペースID
 * @param apiKey - 平文のAPIキー
 * @param host - ホスト（オプション）
 * @returns 暗号化されたAPI設定
 */
export function createSecureBacklogConfig(
  spaceId: string,
  apiKey: string,
  host?: string,
): SecureBacklogApiConfig {
  return {
    spaceId,
    encryptedApiKey: encryptApiKey(apiKey),
    host,
  }
}

/**
 * Backlog APIクライアントファクトリー関数
 *
 * @param config - Backlog API設定（暗号化済みまたは平文）
 * @returns BacklogApiClientインスタンス
 */
export function createBacklogApiClient(config: BacklogApiConfig | SecureBacklogApiConfig): BacklogApiClient {
  return new BacklogApiClient(config)
}

/**
 * デフォルトエクスポート
 */
export default BacklogApiClient
