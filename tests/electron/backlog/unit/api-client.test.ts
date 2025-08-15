/**
 * Backlog API Client Unit Tests
 * 
 * テスト範囲:
 * - HTTP通信とフェッチAPI
 * - 認証ヘッダー処理
 * - エラーハンドリング
 * - レスポンス処理
 * - レート制限ヘッダー解析
 * - 各種APIエンドポイント
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BacklogApiClient } from '../../../../electron/main/services/backlog/api-client'
import type { BacklogApiConfig } from '../../../../shared/types/backlog'

// Fetch APIモック
const mockFetch = vi.fn()
global.fetch = mockFetch

// AbortControllerモック
class MockAbortController {
  signal = { aborted: false }
  abort = vi.fn(() => {
    this.signal.aborted = true
  })
}
global.AbortController = MockAbortController as any

// Responseモック作成ヘルパー
function createMockResponse(data: any, options: {
  status?: number
  statusText?: string
  headers?: Record<string, string>
  ok?: boolean
} = {}) {
  const {
    status = 200,
    statusText = 'OK',
    headers = {},
    ok = status >= 200 && status < 300
  } = options

  return {
    ok,
    status,
    statusText,
    headers: new Map(Object.entries(headers)),
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data))
  }
}

describe('BacklogApiClient', () => {
  let client: BacklogApiClient
  let config: BacklogApiConfig

  beforeEach(() => {
    config = {
      spaceId: 'test-space',
      apiKey: 'test-api-key',
      host: 'backlog.jp'
    }
    client = new BacklogApiClient(config)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.restoreAllMocks()
  })

  describe('初期化', () => {
    it('正しい設定でクライアントを初期化できる', () => {
      expect(client).toBeDefined()
      expect(client.getConfig()).toEqual(config)
    })

    it('デフォルトホストを使用する', () => {
      const configWithoutHost = {
        spaceId: 'test-space',
        apiKey: 'test-api-key'
      }
      const clientWithoutHost = new BacklogApiClient(configWithoutHost)
      expect(clientWithoutHost.getConfig().host).toBeUndefined()
    })
  })

  describe('認証ヘッダー', () => {
    it('Bearer認証ヘッダーを設定する', async () => {
      const mockResponse = createMockResponse({ id: 1, name: 'Test Space' })
      mockFetch.mockResolvedValueOnce(mockResponse)

      await client.getSpace()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://test-space.backlog.jp/api/v2/space'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json'
          })
        })
      )
    })
  })

  describe('URLパラメータ構築', () => {
    it('GETリクエストでパラメータをクエリ文字列に変換する', async () => {
      const mockResponse = createMockResponse([{ id: 1, summary: 'Test Issue' }])
      mockFetch.mockResolvedValueOnce(mockResponse)

      await client.getIssues({ projectId: [1, 2], keyword: 'test' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/\?.*projectId%5B0%5D=1.*projectId%5B1%5D=2.*keyword=test/),
        expect.any(Object)
      )
    })

    it('undefinedとnullのパラメータを除外する', async () => {
      const mockResponse = createMockResponse([{ id: 1 }])
      mockFetch.mockResolvedValueOnce(mockResponse)

      await client.getIssues({ 
        projectId: [1], 
        keyword: undefined, 
        statusId: null as any 
      })

      const fetchCall = mockFetch.mock.calls[0][0] as string
      expect(fetchCall).not.toContain('keyword')
      expect(fetchCall).not.toContain('statusId')
    })
  })

  describe('HTTPリクエスト処理', () => {
    it('成功レスポンスを正しく処理する', async () => {
      const responseData = { id: 1, name: 'Test Space' }
      const mockResponse = createMockResponse(responseData)
      mockFetch.mockResolvedValueOnce(mockResponse)

      const result = await client.getSpace()

      expect(result.success).toBe(true)
      expect(result.data).toEqual(responseData)
      expect(result.timestamp).toBeDefined()
    })

    it('POSTリクエストでbodyを送信する', async () => {
      const mockResponse = createMockResponse({ id: 1 })
      mockFetch.mockResolvedValueOnce(mockResponse)

      // テスト用のカスタムリクエスト
      const testData = { summary: 'Test Issue', description: 'Test Description' }
      await client['makeRequest']('/issues', {
        method: 'POST',
        body: testData
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(testData)
        })
      )
    })

    it('タイムアウトを正しく設定する', async () => {
      const mockResponse = createMockResponse({ id: 1 })
      mockFetch.mockResolvedValueOnce(mockResponse)

      await client['makeRequest']('/space', { timeout: 5000 })

      // AbortControllerが作成されたことを確認
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(Object)
        })
      )
    })
  })

  describe('レート制限ヘッダー処理', () => {
    it('レート制限ヘッダーを解析して保存する', async () => {
      const mockResponse = createMockResponse(
        { id: 1 },
        {
          headers: {
            'X-RateLimit-Remaining': '100',
            'X-RateLimit-Reset': '1640995200',
            'X-RateLimit-Limit': '150'
          }
        }
      )
      mockFetch.mockResolvedValueOnce(mockResponse)

      await client.getSpace()

      const rateLimitInfo = client.getRateLimitInfo()
      expect(rateLimitInfo).toEqual({
        remaining: 100,
        resetTime: 1640995200000,
        limit: 150
      })
    })

    it('レート制限ヘッダーが不完全な場合nullを返す', async () => {
      const mockResponse = createMockResponse(
        { id: 1 },
        { headers: { 'X-RateLimit-Remaining': '100' } }
      )
      mockFetch.mockResolvedValueOnce(mockResponse)

      await client.getSpace()

      const rateLimitInfo = client.getRateLimitInfo()
      expect(rateLimitInfo).toBeNull()
    })
  })

  describe('エラーハンドリング', () => {
    it('HTTPエラーステータスを適切に処理する', async () => {
      // message フィールドを持たないレスポンスでHTTPステータスコードベースのメッセージをテスト
      const mockResponse = createMockResponse(
        { errors: [{ code: 'invalid_api_key' }] },
        { status: 401, statusText: 'Unauthorized', ok: false }
      )
      mockFetch.mockResolvedValueOnce(mockResponse)

      const result = await client.getSpace()

      expect(result.success).toBe(false)
      expect(result.error).toContain('APIキーが無効または期限切れです')
    })

    it('ネットワークエラーを適切に処理する', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fetch failed'))

      const result = await client.getSpace()

      expect(result.success).toBe(false)
      expect(result.error).toContain('ネットワークエラーが発生しました')
    })

    it('タイムアウトエラーを適切に処理する', async () => {
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      mockFetch.mockRejectedValueOnce(abortError)

      const result = await client.getSpace()

      expect(result.success).toBe(false)
      expect(result.error).toContain('リクエストがタイムアウトしました')
    })

    it('JSONパースエラーを処理する', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map(),
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON'))
      }
      mockFetch.mockResolvedValueOnce(mockResponse)

      const result = await client.getSpace()

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('APIエンドポイント', () => {
    beforeEach(() => {
      const mockResponse = createMockResponse({ id: 1 })
      mockFetch.mockResolvedValue(mockResponse)
    })

    it('スペース情報を取得できる', async () => {
      await client.getSpace()
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test-space.backlog.jp/api/v2/space',
        expect.any(Object)
      )
    })

    it('現在のユーザー情報を取得できる', async () => {
      await client.getCurrentUser()
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test-space.backlog.jp/api/v2/users/myself',
        expect.any(Object)
      )
    })

    it('プロジェクト一覧を取得できる', async () => {
      await client.getProjects()
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test-space.backlog.jp/api/v2/projects',
        expect.any(Object)
      )
    })

    it('特定のプロジェクト情報を取得できる', async () => {
      await client.getProject(123)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test-space.backlog.jp/api/v2/projects/123',
        expect.any(Object)
      )
    })

    it('イシュー一覧を取得できる', async () => {
      await client.getIssues({ projectId: [1], count: 20 })
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://test-space.backlog.jp/api/v2/issues'),
        expect.any(Object)
      )
    })

    it('特定のイシュー情報を取得できる', async () => {
      await client.getIssue('TEST-123')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test-space.backlog.jp/api/v2/issues/TEST-123',
        expect.any(Object)
      )
    })
  })

  describe('接続テスト', () => {
    it('正常な接続テストが成功する', async () => {
      const spaceData = { id: 1, name: 'Test Space' }
      const userData = { id: 1, name: 'Test User' }
      
      mockFetch
        .mockResolvedValueOnce(createMockResponse(spaceData))
        .mockResolvedValueOnce(createMockResponse(userData))

      const result = await client.testConnection()

      expect(result.success).toBe(true)
      expect(result.data?.connected).toBe(true)
      expect(result.data?.space).toEqual(spaceData)
      expect(result.data?.user).toEqual(userData)
    })

    it('スペース取得失敗時は接続テストが失敗する', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(
          { message: 'Unauthorized' },
          { status: 401, ok: false }
        ))

      const result = await client.testConnection()

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('ヘルスチェック', () => {
    it('正常なヘルスチェックを実行する', async () => {
      const spaceData = { id: 1, name: 'Test Space' }
      const userData = { id: 1, name: 'Test User' }
      
      // レスポンス時間測定のためにreal timersを一時的に使用
      vi.useRealTimers()
      
      mockFetch
        .mockResolvedValueOnce(createMockResponse(spaceData))
        .mockResolvedValueOnce(createMockResponse(userData))

      const result = await client.healthCheck()

      expect(result.status).toBe('healthy')
      expect(result.checks.connection).toBe(true)
      expect(result.checks.authentication).toBe(true)
      expect(result.responseTime).toBeGreaterThanOrEqual(0)
      
      // fake timersに戻す
      vi.useFakeTimers()
    })

    it('接続エラー時はunhealthyを返す', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      const result = await client.healthCheck()

      expect(result.status).toBe('unhealthy')
      expect(result.checks.connection).toBe(false)
      expect(result.checks.authentication).toBe(false)
    })

    it('レート制限を考慮したヘルスチェック', async () => {
      // レート制限情報を設定
      const mockResponse = createMockResponse(
        { id: 1 },
        {
          headers: {
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': '1640995200',
            'X-RateLimit-Limit': '150'
          }
        }
      )
      mockFetch.mockResolvedValueOnce(mockResponse)

      // まずリクエストを実行してレート制限情報を設定
      await client.getSpace()

      // ヘルスチェック実行
      const spaceData = { id: 1, name: 'Test Space' }
      const userData = { id: 1, name: 'Test User' }
      mockFetch
        .mockResolvedValueOnce(createMockResponse(spaceData))
        .mockResolvedValueOnce(createMockResponse(userData))

      const result = await client.healthCheck()

      expect(result.checks.rateLimit).toBe(false)
    })
  })

  describe('設定取得', () => {
    it('設定を読み取り専用で取得できる', () => {
      const config = client.getConfig()
      expect(config).toEqual({
        spaceId: 'test-space',
        apiKey: 'test-api-key',
        host: 'backlog.jp'
      })

      // 設定の変更を試みる（読み取り専用なので失敗するはず）
      expect(() => {
        (config as any).apiKey = 'modified'
      }).toThrow()
    })
  })

  describe('エラーメッセージ国際化', () => {
    const errorCases = [
      { status: 400, expected: 'リクエストパラメータが不正です' },
      { status: 401, expected: 'APIキーが無効または期限切れです' },
      { status: 403, expected: 'このリソースへのアクセス権限がありません' },
      { status: 404, expected: 'リソースが見つかりません' },
      { status: 429, expected: 'APIリクエスト制限に達しました' },
      { status: 500, expected: 'Backlogサーバーで内部エラーが発生しました' },
      { status: 503, expected: 'Backlogサービスが一時的に利用できません' },
      { status: 999, expected: '未知のエラーが発生しました' }
    ]

    errorCases.forEach(({ status, expected }) => {
      it(`HTTPステータス${status}に対して適切な日本語エラーメッセージを返す`, async () => {
        const mockResponse = createMockResponse(
          {},
          { status, statusText: 'Error', ok: false }
        )
        mockFetch.mockResolvedValueOnce(mockResponse)

        const result = await client.getSpace()

        expect(result.success).toBe(false)
        expect(result.error).toContain(expected)
      })
    })
  })
})
