/**
 * Mastra AI関連型
 */

import type { BacklogIssue, BacklogProject, BacklogComment } from './backlog'

// AIプロバイダー設定
export interface AIProvider {
  id: string
  name: string
  type: 'openai' | 'anthropic' | 'google' | 'azure' | 'local'
  apiKey?: string
  endpoint?: string
  model: string
  maxTokens: number
  temperature: number
  isEnabled: boolean
  rateLimits?: {
    requestsPerMinute: number
    tokensPerMinute: number
  }
  capabilities: AICapability[]
}

export type AICapability
  = | 'text-generation'
    | 'text-analysis'
    | 'summarization'
    | 'translation'
    | 'classification'
    | 'sentiment-analysis'
    | 'code-generation'
    | 'task-planning'

// Mastra設定
export interface MastraConfig {
  providers: AIProvider[]
  defaultProvider: string
  workflows: AIWorkflow[]
  automations: AIAutomation[]
  settings: {
    enableAutoAnalysis: boolean
    analysisThreshold: number
    batchSize: number
    retryAttempts: number
    timeout: number // seconds
    debugMode: boolean
    logLevel: 'error' | 'warn' | 'info' | 'debug'
  }
}

// AIワークフロー
export interface AIWorkflow {
  id: string
  name: string
  description: string
  trigger: AITrigger
  steps: AIWorkflowStep[]
  isEnabled: boolean
  createdAt: string
  updatedAt: string
}

export interface AITrigger {
  type: 'manual' | 'scheduled' | 'event' | 'webhook'
  config: {
    schedule?: string // cron expression
    events?: string[] // イベント名
    conditions?: Record<string, unknown>
  }
}

export interface AIWorkflowStep {
  id: string
  name: string
  type: 'analysis' | 'generation' | 'classification' | 'transformation' | 'action'
  config: AIWorkflowStepConfig
  nextSteps?: string[] // 次のステップID
  onError?: 'stop' | 'continue' | 'retry'
}

// AI自動化
export interface AIAutomation {
  id: string
  name: string
  description: string
  type: AutomationType
  config: AutomationConfig
  schedule?: string // cron expression
  isEnabled: boolean
  lastRun?: string
  nextRun?: string
  statistics: {
    totalRuns: number
    successfulRuns: number
    failedRuns: number
    averageExecutionTime: number
  }
}

export type AutomationType
  = | 'issue-analysis'
    | 'priority-suggestion'
    | 'time-estimation'
    | 'label-suggestion'
    | 'duplicate-detection'
    | 'summary-generation'
    | 'progress-tracking'
    | 'risk-assessment'

export interface AutomationConfig {
  targetProjects?: number[]
  filters?: {
    issueTypes?: string[]
    statuses?: string[]
    priorities?: string[]
    assignees?: number[]
  }
  thresholds?: {
    confidence: number
    similarity: number
  }
  actions?: {
    updateIssue: boolean
    addComment: boolean
    sendNotification: boolean
    createSubtask: boolean
  }
}

// AI分析結果
export interface AIAnalysisResult {
  id: string
  type: AnalysisType
  targetId: number // Issue ID, Project ID, etc.
  targetType: 'issue' | 'project' | 'comment' | 'user'
  result: AnalysisResultData
  confidence: number
  providerId: string
  model: string
  tokensUsed: number
  executionTime: number // milliseconds
  createdAt: string
  metadata?: Record<string, unknown>
}

export type AnalysisType
  = | 'sentiment'
    | 'priority'
    | 'complexity'
    | 'time-estimate'
    | 'category'
    | 'duplicate'
    | 'summary'
    | 'risk'
    | 'impact'

export interface AnalysisResultData {
  sentiment?: SentimentAnalysis
  priority?: PriorityAnalysis
  complexity?: ComplexityAnalysis
  timeEstimate?: TimeEstimateAnalysis
  category?: CategoryAnalysis
  duplicates?: DuplicateAnalysis
  summary?: SummaryAnalysis
  risk?: RiskAnalysis
  impact?: ImpactAnalysis
}

// 各種分析結果の詳細型
export interface SentimentAnalysis {
  overall: 'positive' | 'neutral' | 'negative'
  score: number // -1 to 1
  emotions: {
    joy: number
    anger: number
    fear: number
    sadness: number
    surprise: number
    disgust: number
  }
  keywords: string[]
}

export interface PriorityAnalysis {
  suggested: 'urgent' | 'high' | 'medium' | 'low'
  confidence: number
  factors: {
    userImpact: number
    businessValue: number
    technicalComplexity: number
    dependencies: number
  }
  reasoning: string
}

export interface ComplexityAnalysis {
  level: 'very-low' | 'low' | 'medium' | 'high' | 'very-high'
  score: number // 1-10
  factors: {
    technicalComplexity: number
    businessLogic: number
    dependencies: number
    testingEffort: number
  }
  breakdown: string[]
}

export interface TimeEstimateAnalysis {
  estimatedHours: number
  range: {
    min: number
    max: number
  }
  confidence: number
  factors: {
    scope: number
    complexity: number
    dependencies: number
    teamExperience: number
  }
  breakdown: {
    development: number
    testing: number
    review: number
    documentation: number
  }
}

export interface CategoryAnalysis {
  suggested: string[]
  confidence: number
  keywords: string[]
  reasoning: string
}

export interface DuplicateAnalysis {
  duplicates: {
    issueId: number
    issueKey: string
    similarity: number
    reasons: string[]
  }[]
  confidence: number
}

export interface SummaryAnalysis {
  summary: string
  keyPoints: string[]
  actionItems: string[]
  tags: string[]
  wordCount: number
}

export interface RiskAnalysis {
  level: 'very-low' | 'low' | 'medium' | 'high' | 'very-high'
  score: number // 1-10
  factors: {
    technical: number
    schedule: number
    resources: number
    dependencies: number
  }
  risks: {
    description: string
    probability: number
    impact: number
    mitigation: string
  }[]
}

export interface ImpactAnalysis {
  level: 'very-low' | 'low' | 'medium' | 'high' | 'very-high'
  score: number // 1-10
  areas: {
    users: number
    business: number
    technical: number
    security: number
  }
  affected: {
    users: number
    systems: string[]
    processes: string[]
  }
}

// AIアシスタント関連
export interface AIAssistant {
  id: string
  name: string
  description: string
  avatar?: string
  capabilities: AICapability[]
  context: {
    projects: number[]
    recentInteractions: AIInteraction[]
    preferences: AIAssistantPreferences
  }
  isActive: boolean
}

export interface AIInteraction {
  id: string
  assistantId: string
  userId: number
  type: 'question' | 'command' | 'analysis-request'
  input: string
  output: string
  context?: {
    issueId?: number
    projectId?: number
    attachments?: string[]
  }
  feedback?: {
    rating: number // 1-5
    comment?: string
  }
  tokensUsed: number
  executionTime: number
  createdAt: string
}

// AI推奨関連
export interface AIRecommendation {
  id: string
  type: 'issue-optimization' | 'workflow-improvement' | 'resource-allocation' | 'process-enhancement'
  target: {
    type: 'issue' | 'project' | 'user' | 'team'
    id: number
  }
  title: string
  description: string
  impact: 'low' | 'medium' | 'high'
  effort: 'low' | 'medium' | 'high'
  confidence: number
  data: {
    currentState: Record<string, unknown>
    suggestedChanges: Record<string, unknown>
    expectedOutcome: Record<string, unknown>
  }
  actions: {
    label: string
    action: string
    parameters: Record<string, unknown>
  }[]
  status: 'pending' | 'accepted' | 'rejected' | 'applied'
  createdAt: string
  expiresAt?: string
}

// AIメトリクス
export interface AIMetrics {
  period: {
    start: string
    end: string
  }
  usage: {
    totalRequests: number
    totalTokens: number
    totalCost: number
    averageResponseTime: number
  }
  accuracy: {
    overallAccuracy: number
    byType: Record<AnalysisType, number>
    userFeedback: {
      positive: number
      neutral: number
      negative: number
    }
  }
  performance: {
    successRate: number
    errorRate: number
    timeoutRate: number
    retryRate: number
  }
  providers: Record<string, {
    requests: number
    tokens: number
    cost: number
    errorRate: number
  }>
}

// AIトレーニングデータ
export interface AITrainingData {
  id: string
  type: 'issue-classification' | 'priority-prediction' | 'time-estimation' | 'duplicate-detection'
  input: {
    issue?: BacklogIssue
    project?: BacklogProject
    comments?: BacklogComment[]
    context?: AITrainingContext
  }
  expectedOutput: AITrainingExpectedOutput
  actualOutput?: AITrainingActualOutput
  feedback?: {
    correct: boolean
    userCorrection?: unknown
    confidence: number
  }
  createdAt: string
  updatedAt: string
}

// AIモデル情報
export interface AIModel {
  id: string
  name: string
  version: string
  provider: string
  type: 'text' | 'embedding' | 'classification' | 'generation'
  capabilities: AICapability[]
  parameters: {
    maxTokens: number
    temperature: number
    topP?: number
    frequencyPenalty?: number
    presencePenalty?: number
  }
  pricing: {
    inputTokenCost: number // per 1000 tokens
    outputTokenCost: number // per 1000 tokens
  }
  limits: {
    requestsPerMinute: number
    tokensPerMinute: number
    maxContextLength: number
  }
  isAvailable: boolean
  lastChecked: string
}

// AI関連の追加型定義

/**
 * AIワークフローステップの設定オプション
 */
export interface AIWorkflowStepConfig {
  /** プロンプトテンプレート */
  prompt?: string
  /** 対象フィールド */
  targetFields?: string[]
  /** しきい値設定 */
  thresholds?: {
    confidence?: number
    similarity?: number
    score?: number
  }
  /** 出力形式 */
  outputFormat?: 'text' | 'json' | 'structured'
  /** その他の設定 */
  [key: string]: unknown
}

/**
 * AIアシスタントの設定オプション
 */
export interface AIAssistantPreferences {
  /** 言語設定 */
  language?: 'ja' | 'en'
  /** 応答スタイル */
  responseStyle?: 'concise' | 'detailed' | 'technical'
  /** 専門分野 */
  specialization?: string[]
  /** 通知設定 */
  notifications?: {
    analysisComplete?: boolean
    recommendationsAvailable?: boolean
    errorOccurred?: boolean
  }
  /** その他の設定 */
  [key: string]: unknown
}

/**
 * AIトレーニングデータのコンテキスト
 */
export interface AITrainingContext {
  /** プロジェクト情報 */
  project?: {
    id: number
    name: string
    type: string
  }
  /** ユーザー情報 */
  user?: {
    id: number
    experience: 'beginner' | 'intermediate' | 'expert'
    role: string
  }
  /** 環境情報 */
  environment?: {
    timestamp: string
    version: string
    locale: string
  }
  /** その他のコンテキスト */
  [key: string]: unknown
}

/**
 * AIトレーニングの期待される出力
 */
export type AITrainingExpectedOutput
  = | string
    | number
    | boolean
    | {
      priority?: 'urgent' | 'high' | 'medium' | 'low'
      category?: string[]
      timeEstimate?: number
      similarity?: number
      classification?: string
      confidence?: number
    }
    | unknown[]

/**
 * AIトレーニングの実際の出力
 */
export type AITrainingActualOutput = AITrainingExpectedOutput
