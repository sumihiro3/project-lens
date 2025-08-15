/**
 * ログ関連型定義
 * アプリケーションのログ機能に必要な型を定義
 */

/**
 * ログレベル型定義
 * ログメッセージの重要度を表すレベル（詳細から重要な順）
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

/**
 * エラーカテゴリー型定義
 * エラーログの重要度分類
 */
export type ErrorCategory = 'Critical' | 'Warning' | 'Info'

/**
 * プロセス種別
 * どのプロセスから出力されたログかを識別
 */
export type ProcessType = 'main' | 'renderer' | 'worker' | 'preload'

/**
 * 環境種別
 * アプリケーションの実行環境
 */
export type Environment = 'development' | 'production' | 'test' | 'staging'

/**
 * ログコンテキスト情報
 * ログに付加される追加情報
 */
export interface LogContext {
  /** プロセス種別 */
  process: ProcessType
  /** プロセスID */
  pid: number
  /** ログ出力時のタイムスタンプ（ISO文字列） */
  timestamp: string
  /** セッションID（オプション） */
  sessionId?: string
  /** ユーザーID（オプション） */
  userId?: number
  /** リクエストID（API呼び出し時など、オプション） */
  requestId?: string
  /** ファイル名とライン番号（オプション） */
  source?: {
    file: string
    line?: number
    function?: string
  }
  /** 追加のメタデータ（オプション） */
  metadata?: Record<string, string | number | boolean | null>
}

/**
 * ログエントリ型定義
 * 個々のログメッセージの構造
 */
export interface LogEntry {
  /** ログの一意識別子 */
  id: string
  /** ログレベル */
  level: LogLevel
  /** ログメッセージ */
  message: string
  /** エラーカテゴリー（エラーレベルの場合） */
  category?: ErrorCategory
  /** エラーオブジェクト（エラーレベルの場合） */
  error?: {
    name: string
    message: string
    stack?: string
    code?: string | number
  }
  /** ログコンテキスト情報 */
  context: LogContext
  /** ログ出力時の追加データ（オプション） */
  data?: Record<string, unknown>
}

/**
 * ログファイル設定
 * ログファイルの出力設定
 */
export interface LogFileConfig {
  /** ログファイルの出力パス */
  filePath: string
  /** ローテーション設定 */
  rotation: {
    /** 最大ファイルサイズ（MB） */
    maxSize: number
    /** 保持するファイル数 */
    maxFiles: number
    /** ローテーション頻度 */
    frequency: 'daily' | 'weekly' | 'monthly' | 'size-based'
  }
  /** 圧縮設定 */
  compression: {
    /** 圧縮を有効にするか */
    enabled: boolean
    /** 圧縮方式 */
    method: 'gzip' | 'zip'
  }
}

/**
 * コンソール出力設定
 * コンソールへのログ出力設定
 */
export interface ConsoleLogConfig {
  /** 出力を有効にするか */
  enabled: boolean
  /** カラー出力を使用するか */
  colorize: boolean
  /** タイムスタンプの表示形式 */
  timestampFormat: 'iso' | 'local' | 'relative' | 'none'
  /** 出力フォーマット */
  format: 'json' | 'text' | 'compact'
}

/**
 * リモートログ設定
 * 外部ログサービスへの送信設定
 */
export interface RemoteLogConfig {
  /** リモート送信を有効にするか */
  enabled: boolean
  /** 送信先エンドポイント */
  endpoint: string
  /** 認証情報 */
  authentication?: {
    type: 'bearer' | 'api-key' | 'basic'
    credentials: string
  }
  /** 送信間隔（秒） */
  batchInterval: number
  /** バッチサイズ */
  batchSize: number
  /** 再試行設定 */
  retry: {
    attempts: number
    delay: number
    backoff: 'fixed' | 'exponential'
  }
}

/**
 * 環境別ログ設定
 * 実行環境ごとのログ出力設定
 */
export interface EnvironmentLogConfig {
  /** 環境名 */
  environment: Environment
  /** 最小ログレベル */
  minLevel: LogLevel
  /** コンソール出力設定 */
  console: ConsoleLogConfig
  /** ファイル出力設定 */
  file?: LogFileConfig
  /** リモート送信設定 */
  remote?: RemoteLogConfig
  /** デバッグモード */
  debug: boolean
}

/**
 * メインログ設定
 * アプリケーション全体のログ設定
 */
export interface LoggingConfig {
  /** 現在の環境 */
  currentEnvironment: Environment
  /** 環境別設定 */
  environments: Record<Environment, EnvironmentLogConfig>
  /** グローバル設定 */
  global: {
    /** アプリケーション名（ログに含める） */
    appName: string
    /** アプリケーションバージョン（ログに含める） */
    appVersion: string
    /** ログの最大保持期間（日） */
    maxRetentionDays: number
    /** 機密情報のマスク設定 */
    sensitiveDataMask: {
      enabled: boolean
      patterns: string[] // 正規表現パターン
      replacement: string
    }
    /** パフォーマンス計測 */
    performance: {
      enabled: boolean
      slowOperationThreshold: number // ミリ秒
    }
  }
}

/**
 * ログフィルター設定
 * ログの出力制御のためのフィルター
 */
export interface LogFilter {
  /** フィルター名 */
  name: string
  /** 有効状態 */
  enabled: boolean
  /** フィルター条件 */
  conditions: {
    /** ログレベルの範囲 */
    levels?: LogLevel[]
    /** プロセス種別 */
    processes?: ProcessType[]
    /** メッセージパターン（正規表現） */
    messagePattern?: string
    /** 特定のソースファイル */
    sources?: string[]
    /** 時間範囲 */
    timeRange?: {
      start: string
      end: string
    }
  }
  /** フィルターアクション */
  action: 'include' | 'exclude' | 'highlight'
}

/**
 * ログ統計情報
 * ログ出力の統計データ
 */
export interface LogStatistics {
  /** 統計対象期間 */
  period: {
    start: string
    end: string
  }
  /** レベル別カウント */
  levelCounts: Record<LogLevel, number>
  /** プロセス別カウント */
  processCounts: Record<ProcessType, number>
  /** エラーカテゴリー別カウント */
  errorCategoryCounts: Record<ErrorCategory, number>
  /** 総ログ数 */
  totalLogs: number
  /** ユニークエラー数 */
  uniqueErrors: number
  /** 最頻出エラー */
  topErrors: Array<{
    message: string
    count: number
    lastOccurrence: string
  }>
}

/**
 * デフォルトログ設定
 */
export const defaultLoggingConfig: LoggingConfig = {
  currentEnvironment: 'development',
  environments: {
    development: {
      environment: 'development',
      minLevel: 'debug',
      console: {
        enabled: true,
        colorize: true,
        timestampFormat: 'local',
        format: 'text',
      },
      file: {
        filePath: './logs/app.log',
        rotation: {
          maxSize: 10,
          maxFiles: 5,
          frequency: 'daily',
        },
        compression: {
          enabled: false,
          method: 'gzip',
        },
      },
      debug: true,
    },
    production: {
      environment: 'production',
      minLevel: 'info',
      console: {
        enabled: false,
        colorize: false,
        timestampFormat: 'iso',
        format: 'json',
      },
      file: {
        filePath: './logs/app.log',
        rotation: {
          maxSize: 50,
          maxFiles: 30,
          frequency: 'daily',
        },
        compression: {
          enabled: true,
          method: 'gzip',
        },
      },
      debug: false,
    },
    test: {
      environment: 'test',
      minLevel: 'warn',
      console: {
        enabled: true,
        colorize: false,
        timestampFormat: 'none',
        format: 'compact',
      },
      debug: false,
    },
    staging: {
      environment: 'staging',
      minLevel: 'debug',
      console: {
        enabled: true,
        colorize: true,
        timestampFormat: 'iso',
        format: 'json',
      },
      file: {
        filePath: './logs/app.log',
        rotation: {
          maxSize: 25,
          maxFiles: 10,
          frequency: 'daily',
        },
        compression: {
          enabled: true,
          method: 'gzip',
        },
      },
      debug: true,
    },
  },
  global: {
    appName: 'ProjectLens',
    appVersion: '1.0.0',
    maxRetentionDays: 90,
    sensitiveDataMask: {
      enabled: true,
      patterns: [
        'password\\s*[=:]\\s*[^\\s]+',
        'token\\s*[=:]\\s*[^\\s]+',
        'key\\s*[=:]\\s*[^\\s]+',
        'secret\\s*[=:]\\s*[^\\s]+',
      ],
      replacement: '[REDACTED]',
    },
    performance: {
      enabled: true,
      slowOperationThreshold: 1000,
    },
  },
}
