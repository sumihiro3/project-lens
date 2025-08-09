# フォールバック戦略実装例

## 健全性監視サービス実装

```typescript
// types/fallback.ts
export interface ServiceHealth {
  service: 'mcp' | 'mastra' | 'backlog' | 'llm';
  status: 'healthy' | 'degraded' | 'critical' | 'offline';
  lastCheck: Date;
  responseTime: number;
  errorCount: number;
  uptime: number;
  lastError?: string;
}

export interface FallbackStrategy {
  name: string;
  priority: number;
  canHandle: (error: Error) => boolean;
  execute: () => Promise<void>;
  rollback: () => Promise<void>;
}

// services/healthMonitor.ts
export class HealthMonitor {
  private services = new Map<string, ServiceHealth>();
  private listeners: Array<(health: ServiceHealth) => void> = [];
  private checkInterval = 30000; // 30秒

  constructor(
    private mcpManager: MCPManager,
    private mastraService: MastraAIService,
    private logger: Logger
  ) {}

  async startMonitoring(): Promise<void> {
    await this.runHealthChecks();
    
    setInterval(async () => {
      await this.runHealthChecks();
    }, this.checkInterval);
  }

  private async runHealthChecks(): Promise<void> {
    const checks = [
      this.checkMCPHealth(),
      this.checkMastraHealth(),
    ];

    await Promise.allSettled(checks);
    this.notifyListeners();
  }

  private async checkMCPHealth(): Promise<void> {
    const startTime = Date.now();
    const serviceName = 'mcp';
    
    try {
      await this.mcpManager.healthCheck();
      const responseTime = Date.now() - startTime;
      
      this.services.set(serviceName, {
        service: serviceName,
        status: this.classifyStatus(responseTime, 0),
        lastCheck: new Date(),
        responseTime,
        errorCount: 0,
        uptime: this.calculateUptime(serviceName),
      });
      
    } catch (error) {
      const currentHealth = this.services.get(serviceName);
      const errorCount = (currentHealth?.errorCount || 0) + 1;
      
      this.services.set(serviceName, {
        service: serviceName,
        status: 'offline',
        lastCheck: new Date(),
        responseTime: Date.now() - startTime,
        errorCount,
        uptime: this.calculateUptime(serviceName),
        lastError: error.message,
      });
    }
  }

  public getFailedServices(): string[] {
    return Array.from(this.services.entries())
      .filter(([_, health]) => health.status === 'offline' || health.status === 'critical')
      .map(([service]) => service);
  }

  public onHealthChange(callback: (health: ServiceHealth) => void): void {
    this.listeners.push(callback);
  }

  private classifyStatus(responseTime: number, errorCount: number): ServiceHealth['status'] {
    if (errorCount > 5) return 'offline';
    if (responseTime > 5000) return 'critical';
    if (responseTime > 1000) return 'degraded';
    return 'healthy';
  }

  private calculateUptime(serviceName: string): number {
    const health = this.services.get(serviceName);
    if (!health) return 100;
    
    const totalChecks = Math.max(health.errorCount + 1, 1);
    const successfulChecks = totalChecks - health.errorCount;
    return (successfulChecks / totalChecks) * 100;
  }

  private notifyListeners(): void {
    for (const [_, health] of this.services) {
      this.listeners.forEach(callback => callback(health));
    }
  }
}
```

## 直接APIクライアント実装

```typescript
// services/backlogDirectClient.ts
export class BacklogDirectClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly rateLimiter: RateLimiter;

  constructor(config: DirectAPIConfig) {
    this.baseUrl = `https://${config.spaceKey}.backlog.jp/api/v2`;
    this.apiKey = config.apiKey;
    this.rateLimiter = new RateLimiter({ rpm: config.rateLimitRpm || 150 });
  }

  async validate(): Promise<void> {
    try {
      await this.rateLimiter.execute(() => 
        fetch(`${this.baseUrl}/users/myself?apiKey=${this.apiKey}`)
      );
    } catch (error) {
      throw new DirectAPIError(`Validation failed: ${error.message}`);
    }
  }

  async getIssues(projectId: string, options?: GetIssuesOptions): Promise<Issue[]> {
    const params = new URLSearchParams({
      apiKey: this.apiKey,
      'projectId[]': projectId,
      ...this.buildQueryParams(options),
    });

    const response = await this.rateLimiter.execute(() => 
      fetch(`${this.baseUrl}/issues?${params}`)
    );

    if (!response.ok) {
      throw new DirectAPIError(`Failed to fetch issues: ${response.statusText}`);
    }

    const data = await response.json();
    return data.map(this.mapBacklogIssueToInternal);
  }

  async getComments(issueId: string): Promise<Comment[]> {
    const response = await this.rateLimiter.execute(() => 
      fetch(`${this.baseUrl}/issues/${issueId}/comments?apiKey=${this.apiKey}`)
    );

    if (!response.ok) {
      throw new DirectAPIError(`Failed to fetch comments: ${response.statusText}`);
    }

    const data = await response.json();
    return data.map(this.mapBacklogCommentToInternal);
  }

  private mapBacklogIssueToInternal(backlogIssue: any): Issue {
    return {
      id: `backlog-${backlogIssue.id}`,
      spaceId: backlogIssue.projectId.toString(),
      projectId: backlogIssue.projectId,
      backlogIssueId: backlogIssue.id,
      key: backlogIssue.issueKey,
      summary: backlogIssue.summary,
      description: backlogIssue.description,
      statusId: backlogIssue.status.id,
      priorityId: backlogIssue.priority.id,
      assigneeId: backlogIssue.assignee?.id,
      dueDate: backlogIssue.dueDate ? new Date(backlogIssue.dueDate) : undefined,
      created: new Date(backlogIssue.created),
      updated: new Date(backlogIssue.updated),
    };
  }

  private buildQueryParams(options?: GetIssuesOptions): Record<string, string> {
    const params: Record<string, string> = {};
    
    if (options?.assigneeId) {
      params['assigneeId[]'] = options.assigneeId.toString();
    }
    if (options?.statusId) {
      params['statusId[]'] = options.statusId.toString();
    }
    if (options?.since) {
      params.since = options.since.toISOString();
    }
    
    return params;
  }
}

// レートリミッター実装
class RateLimiter {
  private requests: number[] = [];
  private readonly maxRequests: number;
  private readonly timeWindow: number;

  constructor(config: { rpm: number }) {
    this.maxRequests = config.rpm;
    this.timeWindow = 60000; // 1分
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.waitIfNeeded();
    
    try {
      const result = await fn();
      this.recordRequest();
      return result;
    } catch (error) {
      this.recordRequest(); // 失敗したリクエストもカウント
      throw error;
    }
  }

  private async waitIfNeeded(): Promise<void> {
    this.cleanOldRequests();
    
    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = this.timeWindow - (Date.now() - oldestRequest);
      
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  private recordRequest(): void {
    this.requests.push(Date.now());
    this.cleanOldRequests();
  }

  private cleanOldRequests(): void {
    const cutoff = Date.now() - this.timeWindow;
    this.requests = this.requests.filter(time => time > cutoff);
  }
}
```

## ローカルAIプロセッサー実装

```typescript
// services/localAIProcessor.ts
export class LocalAIProcessor {
  private ruleConfig: RuleConfig | null = null;
  private templateConfig: TemplateConfig | null = null;
  private adviceTemplates: AdviceTemplate[] = [];

  enableRuleBasedSummary(config: RuleConfig): void {
    this.ruleConfig = config;
  }

  enableTemplateAdvice(config: TemplateConfig): void {
    this.templateConfig = config;
    this.loadAdviceTemplates();
  }

  async processSummary(issues: Issue[]): Promise<Summary> {
    if (!this.ruleConfig) {
      throw new Error('Rule-based summary not enabled');
    }

    // 優先度分析
    const priorityAnalysis = this.analyzePriority(issues);
    const statusAnalysis = this.analyzeStatus(issues);
    const urgencyAnalysis = this.analyzeUrgency(issues);

    // サマリー生成
    const summary = {
      type: 'rule-based' as const,
      content: this.generateSummaryText(priorityAnalysis, statusAnalysis, urgencyAnalysis),
      metadata: {
        totalIssues: issues.length,
        criticalCount: priorityAnalysis.critical,
        importantCount: priorityAnalysis.important,
        overdueCount: urgencyAnalysis.overdue,
        completedCount: statusAnalysis.completed,
      },
      generatedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000), // 1時間後
    };

    return summary;
  }

  async processAdvice(issue: Issue): Promise<Advice> {
    const template = this.findBestTemplate(issue);
    if (!template) {
      return {
        type: 'template-based',
        content: 'このチケットに対する具体的なアドバイスは現在利用できません。',
        confidence: 0.1,
        suggestions: [],
        generatedAt: new Date(),
      };
    }

    const advice = {
      type: 'template-based' as const,
      content: this.interpolateTemplate(template.content, issue),
      confidence: template.confidence,
      suggestions: template.suggestions.map(s => this.interpolateTemplate(s, issue)),
      generatedAt: new Date(),
    };

    return advice;
  }

  private analyzePriority(issues: Issue[]): { critical: number; important: number; normal: number } {
    return issues.reduce((acc, issue) => {
      const priority = this.calculateIssuePriority(issue);
      acc[priority]++;
      return acc;
    }, { critical: 0, important: 0, normal: 0 });
  }

  private analyzeStatus(issues: Issue[]): { completed: number; inProgress: number; pending: number } {
    return issues.reduce((acc, issue) => {
      if (issue.statusId === 4) { // 完了ステータス
        acc.completed++;
      } else if (issue.statusId === 2 || issue.statusId === 3) { // 進行中
        acc.inProgress++;
      } else {
        acc.pending++;
      }
      return acc;
    }, { completed: 0, inProgress: 0, pending: 0 });
  }

  private analyzeUrgency(issues: Issue[]): { overdue: number; dueSoon: number; normal: number } {
    const now = new Date();
    const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    return issues.reduce((acc, issue) => {
      if (issue.dueDate) {
        if (issue.dueDate < now) {
          acc.overdue++;
        } else if (issue.dueDate < threeDaysFromNow) {
          acc.dueSoon++;
        } else {
          acc.normal++;
        }
      } else {
        acc.normal++;
      }
      return acc;
    }, { overdue: 0, dueSoon: 0, normal: 0 });
  }

  private generateSummaryText(
    priority: { critical: number; important: number; normal: number },
    status: { completed: number; inProgress: number; pending: number },
    urgency: { overdue: number; dueSoon: number; normal: number }
  ): string {
    const parts = [];

    // 全体概要
    const totalIssues = priority.critical + priority.important + priority.normal;
    parts.push(`合計${totalIssues}件のチケットを確認しました。`);

    // 優先度分析
    if (priority.critical > 0) {
      parts.push(`緊急レベル: ${priority.critical}件の対応が必要です。`);
    }
    if (priority.important > 0) {
      parts.push(`重要レベル: ${priority.important}件の確認をお勧めします。`);
    }

    // 期限分析
    if (urgency.overdue > 0) {
      parts.push(`⚠️ ${urgency.overdue}件のチケットが期限超過しています。`);
    }
    if (urgency.dueSoon > 0) {
      parts.push(`📅 ${urgency.dueSoon}件のチケットが3日以内に期限を迎えます。`);
    }

    // ステータス分析
    if (status.completed > 0) {
      parts.push(`✅ ${status.completed}件のチケットが完了済みです。`);
    }

    return parts.join(' ');
  }

  private findBestTemplate(issue: Issue): AdviceTemplate | null {
    let bestMatch: AdviceTemplate | null = null;
    let bestScore = 0;

    for (const template of this.adviceTemplates) {
      const score = this.calculateTemplateScore(template, issue);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = template;
      }
    }

    return bestScore > 0.3 ? bestMatch : null; // 閾値以上のマッチのみ返す
  }

  private calculateTemplateScore(template: AdviceTemplate, issue: Issue): number {
    let score = 0;
    const conditions = template.conditions;

    // 優先度マッチング
    if (conditions.priority && conditions.priority.includes(issue.priority)) {
      score += 0.4;
    }

    // ステータスマッチング
    if (conditions.statusId && conditions.statusId.includes(issue.statusId)) {
      score += 0.3;
    }

    // 期限マッチング
    if (conditions.hasDeadline !== undefined) {
      const hasDeadline = Boolean(issue.dueDate);
      if (conditions.hasDeadline === hasDeadline) {
        score += 0.2;
      }
    }

    // キーワードマッチング
    if (conditions.keywords && conditions.keywords.length > 0) {
      const content = `${issue.summary} ${issue.description}`.toLowerCase();
      const matchedKeywords = conditions.keywords.filter(keyword => 
        content.includes(keyword.toLowerCase())
      );
      score += (matchedKeywords.length / conditions.keywords.length) * 0.1;
    }

    return Math.min(score, 1.0);
  }

  private interpolateTemplate(template: string, issue: Issue): string {
    return template
      .replace(/\{issue\.key\}/g, issue.key)
      .replace(/\{issue\.summary\}/g, issue.summary)
      .replace(/\{issue\.priority\}/g, issue.priority)
      .replace(/\{issue\.dueDate\}/g, issue.dueDate ? issue.dueDate.toLocaleDateString('ja-JP') : 'なし');
  }

  private loadAdviceTemplates(): void {
    // 基本的なアドバイステンプレート
    this.adviceTemplates = [
      {
        id: 'high-priority-overdue',
        content: '{issue.key} は高優先度で期限超過しています。早急な対応が必要です。',
        confidence: 0.9,
        suggestions: [
          '担当者に連絡を取り、進捗を確認してください',
          '必要に応じてリソースの追加を検討してください',
          'ステークホルダーに現状を報告してください'
        ],
        conditions: {
          priority: ['critical', 'important'],
          hasDeadline: true
        }
      },
      {
        id: 'no-assignee',
        content: '{issue.key} に担当者が割り当てられていません。',
        confidence: 0.8,
        suggestions: [
          '適切な担当者を割り当ててください',
          'スキルセットと作業負荷を考慮してください'
        ],
        conditions: {
          hasAssignee: false
        }
      },
      {
        id: 'long-running',
        content: '{issue.key} は長期間更新されていません。',
        confidence: 0.7,
        suggestions: [
          '現在のステータスを確認してください',
          '必要に応じてクローズを検討してください',
          '担当者とミーティングを設定してください'
        ],
        conditions: {
          statusId: [1, 2, 3],
          updatedDaysAgo: 14
        }
      }
    ];
  }
}

// 型定義
interface RuleConfig {
  priorityKeywords: string[];
  statusKeywords: string[];
  maxSummaryLength: number;
}

interface TemplateConfig {
  templates: AdviceTemplate[];
}

interface AdviceTemplate {
  id: string;
  content: string;
  confidence: number;
  suggestions: string[];
  conditions: {
    priority?: string[];
    statusId?: number[];
    hasDeadline?: boolean;
    hasAssignee?: boolean;
    keywords?: string[];
    updatedDaysAgo?: number;
  };
}
```

## MCPフォールバックマネージャー

```typescript
class MCPFallbackManager {
  private readonly fallbackStrategies = [
    'direct-api',      // Backlog REST API直接呼び出し
    'cached-data',     // ローカルキャッシュデータ使用
    'offline-mode',    // オフラインモード移行
    'read-only',       // 読み取り専用モード
  ];
  
  private currentStrategy = 'mcp';
  private retryCount = 0;
  private readonly maxRetries = 3;

  async handleMCPFailure(error: MCPError): Promise<void> {
    logger.error('MCP connection failed', { error });
    
    // 自動リトライ（指数バックオフ）
    if (this.retryCount < this.maxRetries) {
      await this.retryMCPConnection();
      return;
    }

    // フォールバック戦略の実行
    await this.executeFallbackChain();
  }

  private async executeFallbackChain(): Promise<void> {
    for (const strategy of this.fallbackStrategies) {
      try {
        await this.executeStrategy(strategy);
        this.currentStrategy = strategy;
        this.notifyStrategyChange(strategy);
        break;
      } catch (error) {
        logger.warn(`Fallback strategy failed: ${strategy}`, { error });
        continue;
      }
    }
  }

  private async executeStrategy(strategy: string): Promise<void> {
    switch (strategy) {
      case 'direct-api':
        await this.initializeDirectBacklogAPI();
        break;
      case 'cached-data':
        await this.enableCachedDataMode();
        break;
      case 'offline-mode':
        await this.enterOfflineMode();
        break;
      case 'read-only':
        await this.enableReadOnlyMode();
        break;
    }
  }

  // Backlog REST API直接呼び出し
  private async initializeDirectBacklogAPI(): Promise<void> {
    const spaces = await this.getConfiguredSpaces();
    this.directApiClients = new Map();
    
    for (const space of spaces) {
      const client = new BacklogDirectClient({
        spaceKey: space.domain,
        apiKey: await this.credentialManager.decryptApiKey(space.apiKey),
        rateLimiter: new RateLimiter({ rpm: 150 })
      });
      
      await client.validate();
      this.directApiClients.set(space.id, client);
    }
    
    logger.info('Direct Backlog API initialized');
  }

  // キャッシュデータモード
  private async enableCachedDataMode(): Promise<void> {
    const cacheAge = await this.getCacheMaxAge();
    if (cacheAge > 24 * 60 * 60 * 1000) { // 24時間以上古い
      throw new Error('Cache too old for reliable operation');
    }
    
    await this.dataService.switchToCacheOnlyMode();
    this.showCacheWarning();
    logger.info('Switched to cached data mode');
  }

  // オフラインモード
  private async enterOfflineMode(): Promise<void> {
    await this.dataService.enableOfflineMode();
    this.disableAutoSync();
    this.showOfflineIndicator();
    logger.info('Entered offline mode');
  }
}
```