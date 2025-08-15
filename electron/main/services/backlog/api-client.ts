/**
 * Backlog Direct API接続管理サービス
 * 
 * Backlog APIとの通信を管理し、型安全な方法でAPIリクエストを実行します。
 * Node.js標準のfetchを使用し、認証、レスポンス処理、エラーハンドリングを提供します。
 */

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
 * Backlog APIクライアント
 * 
 * Backlog APIとの通信を管理し、型安全なメソッドを提供します。
 * 認証、レート制限、エラーハンドリングを自動で処理します。
 */
export class BacklogApiClient {
  private readonly config: BacklogApiConfig
  private readonly baseUrl: string
  private rateLimitInfo: RateLimitInfo | null = null

  /**
   * コンストラクター
   * 
   * @param config - Backlog API設定
   */
  constructor(config: BacklogApiConfig) {
    this.config = config
    this.baseUrl = this.buildBaseUrl(config)
    
    console.log('Backlog APIクライアントを初期化しました', {
      spaceId: config.spaceId,
      host: config.host || 'backlog.jp',
      baseUrl: this.baseUrl,
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
    options: ApiRequestOptions = {}
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
    } catch (error) {
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
    } catch {
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
      } else if (error.message.includes('fetch')) {
        errorMessage = 'ネットワークエラーが発生しました。インターネット接続を確認してください'
      } else {
        errorMessage = error.message
      }
    } else {
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
    console.log('プロジェクト情報を取得中...', { projectIdOrKey })
    return this.makeRequest<BacklogProject>(`/projects/${projectIdOrKey}`)
  }

  /**
   * プロジェクトのカテゴリ一覧を取得
   */
  public async getProjectCategories(projectIdOrKey: string | number): Promise<ApiResponse<BacklogCategory[]>> {
    console.log('プロジェクトカテゴリ一覧を取得中...', { projectIdOrKey })
    return this.makeRequest<BacklogCategory[]>(`/projects/${projectIdOrKey}/categories`)
  }

  /**
   * プロジェクトのバージョン一覧を取得
   */
  public async getProjectVersions(projectIdOrKey: string | number): Promise<ApiResponse<BacklogVersion[]>> {
    console.log('プロジェクトバージョン一覧を取得中...', { projectIdOrKey })
    return this.makeRequest<BacklogVersion[]>(`/projects/${projectIdOrKey}/versions`)
  }

  /**
   * プロジェクトのマイルストーン一覧を取得
   */
  public async getProjectMilestones(projectIdOrKey: string | number): Promise<ApiResponse<BacklogMilestone[]>> {
    console.log('プロジェクトマイルストーン一覧を取得中...', { projectIdOrKey })
    return this.makeRequest<BacklogMilestone[]>(`/projects/${projectIdOrKey}/versions`)
  }

  /**
   * プロジェクトのイシュータイプ一覧を取得
   */
  public async getProjectIssueTypes(projectIdOrKey: string | number): Promise<ApiResponse<BacklogIssueType[]>> {
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
    console.log('プロジェクト状態一覧を取得中...', { projectIdOrKey })
    return this.makeRequest<BacklogStatus[]>(`/projects/${projectIdOrKey}/statuses`)
  }

  /**
   * イシュー一覧を検索・取得
   */
  public async getIssues(params: BacklogIssueSearchParams = {}): Promise<ApiResponse<BacklogIssue[]>> {
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
      } else {
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
    console.log('イシュー情報を取得中...', { issueIdOrKey })
    return this.makeRequest<BacklogIssue>(`/issues/${issueIdOrKey}`)
  }

  /**
   * イシューのコメント一覧を取得
   */
  public async getIssueComments(issueIdOrKey: string | number): Promise<ApiResponse<Comment[]>> {
    console.log('イシューコメント一覧を取得中...', { issueIdOrKey })
    return this.makeRequest<Comment[]>(`/issues/${issueIdOrKey}/comments`)
  }

  /**
   * API接続をテスト
   */
  public async testConnection(): Promise<ApiResponse<{ connected: boolean; user?: BacklogUser; space?: BacklogSpace }>> {
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
      } else {
        const error = spaceResponse.error || userResponse.error || '接続テストに失敗しました'
        console.error('Backlog API接続テストが失敗しました', { error })

        return {
          success: false,
          error,
          timestamp: new Date().toISOString(),
        }
      }
    } catch (error) {
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
      } else if (this.rateLimitInfo) {
        checks.rateLimit = this.rateLimitInfo.remaining > 0
      } else {
        checks.rateLimit = true // 初回は不明なのでtrueとする
      }
      
      // 総合的な状態判定
      const allChecksPass = Object.values(checks).every(check => check)
      const someChecksPass = Object.values(checks).some(check => check)
      
      let status: 'healthy' | 'degraded' | 'unhealthy'
      if (allChecksPass) {
        status = 'healthy'
      } else if (someChecksPass) {
        status = 'degraded'
      } else {
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
    } catch (error) {
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
   * 汎用APIリクエストメソッド（テスト用）
   */
  public async request<T>(
    endpoint: string,
    options?: ApiRequestOptions
  ): Promise<ApiResponse<T>> {
    return this.makeRequest<T>(endpoint, options)
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
 * Backlog APIクライアントファクトリー関数
 * 
 * @param config - Backlog API設定
 * @returns BacklogApiClientインスタンス
 */
export function createBacklogApiClient(config: BacklogApiConfig): BacklogApiClient {
  return new BacklogApiClient(config)
}

/**
 * デフォルトエクスポート
 */
export default BacklogApiClient