/**
 * パフォーマンス監視ユーティリティ
 * メモリ使用量、パフォーマンス測定、最適化ヒントを提供
 */

// パフォーマンス測定結果のインターフェース
export interface PerformanceMetrics {
  // メモリ使用量
  memory: {
    used: number // MB
    total: number // MB
    percentage: number // %
  }
  // レンダリングパフォーマンス
  rendering: {
    fps: number
    frameTime: number // ms
    droppedFrames: number
  }
  // ドムパフォーマンス
  dom: {
    nodeCount: number
    eventListeners: number
  }
  // ネットワーク
  network: {
    pendingRequests: number
    totalTransferSize: number // bytes
  }
  // タイムスタンプ
  timestamp: number
}

// パフォーマンス監視オプション
export interface PerformanceMonitorOptions {
  interval: number // 監視間隔 (ms)
  maxSamples: number // 保持するサンプル数
  enableLogging: boolean // コンソールログを有効化
  memoryThreshold: number // メモリ警告しきい値 (MB)
  fpsThreshold: number // FPS警告しきい値
}

// デフォルト設定
const DEFAULT_OPTIONS: PerformanceMonitorOptions = {
  interval: 5000, // 5秒
  maxSamples: 100,
  enableLogging: process.env.NODE_ENV === 'development',
  memoryThreshold: 400, // 400MB
  fpsThreshold: 30, // 30fps
}

/**
 * パフォーマンス監視クラス
 */
export class PerformanceMonitor {
  private options: PerformanceMonitorOptions
  private samples: PerformanceMetrics[] = []
  private monitoringInterval: number | null = null
  private observer: PerformanceObserver | null = null
  private isMonitoring = false
  private lastFrameTime = 0
  private frameCount = 0
  private droppedFrames = 0
  private rafId: number | null = null

  constructor(options: Partial<PerformanceMonitorOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.setupPerformanceObserver()
  }

  /**
   * パフォーマンスオブザーバーのセットアップ
   */
  private setupPerformanceObserver(): void {
    if (typeof window === 'undefined' || !window.PerformanceObserver) {
      return
    }

    try {
      this.observer = new PerformanceObserver((list) => {
        const entries = list.getEntries()
        entries.forEach((entry) => {
          if (entry.entryType === 'measure' || entry.entryType === 'navigation') {
            this.logPerformanceEntry(entry)
          }
        })
      })

      // 利用可能なエントリタイプを監視
      const entryTypes = ['measure', 'navigation', 'resource', 'paint']
      entryTypes.forEach((type) => {
        try {
          if (this.observer) {
            this.observer.observe({ entryTypes: [type] })
          }
        }
        catch {
          // サポートされていないエントリタイプは無視
        }
      })
    }
    catch (error) {
      console.warn('パフォーマンスオブザーバーのセットアップに失敗しました:', error)
    }
  }

  /**
   * パフォーマンスエントリのログ出力
   */
  private logPerformanceEntry(entry: PerformanceEntry): void {
    if (!this.options.enableLogging) return

    if (entry.entryType === 'navigation') {
      const navEntry = entry as PerformanceNavigationTiming
      const startTime = navEntry.fetchStart || 0
      const endTime = navEntry.loadEventEnd || 0
      console.log(`🏁 ナビゲーション: ${
        Math.round(endTime - startTime)
      }ms`)
    }
    else if (entry.entryType === 'paint') {
      console.log(`🎨 ${entry.name}: ${Math.round(entry.startTime)}ms`)
    }
  }

  /**
   * 現在のパフォーマンスメトリクスを取得
   */
  getCurrentMetrics(): PerformanceMetrics {
    const memory = this.getMemoryInfo()
    const rendering = this.getRenderingInfo()
    const dom = this.getDOMInfo()
    const network = this.getNetworkInfo()

    return {
      memory,
      rendering,
      dom,
      network,
      timestamp: Date.now(),
    }
  }

  /**
   * メモリ情報を取得
   */
  private getMemoryInfo(): PerformanceMetrics['memory'] {
    if (typeof window === 'undefined') {
      return { used: 0, total: 0, percentage: 0 }
    }

    const memory = (performance as Performance & {
      memory?: {
        usedJSHeapSize: number
        totalJSHeapSize: number
        jsHeapSizeLimit: number
      }
    }).memory
    if (memory && typeof memory.usedJSHeapSize === 'number' && typeof memory.totalJSHeapSize === 'number') {
      const used = Math.round(memory.usedJSHeapSize / 1024 / 1024) // MB
      const total = Math.round(memory.totalJSHeapSize / 1024 / 1024) // MB
      const percentage = total > 0 ? Math.round((used / total) * 100) : 0
      return { used, total, percentage }
    }

    // フォールバック: 推定値
    return { used: 50, total: 100, percentage: 50 }
  }

  /**
   * レンダリング情報を取得
   */
  private getRenderingInfo(): PerformanceMetrics['rendering'] {
    const now = performance.now()
    const deltaTime = now - this.lastFrameTime

    if (this.lastFrameTime > 0) {
      this.frameCount++

      // 16.67ms (60fps) を超えた場合はフレームドロップとみなす
      if (deltaTime > 16.67) {
        this.droppedFrames++
      }
    }

    this.lastFrameTime = now

    // FPSを計算（1秒間の平均）
    const fps = deltaTime > 0 ? Math.min(60, 1000 / deltaTime) : 60

    return {
      fps: Math.round(fps),
      frameTime: Math.round(deltaTime * 100) / 100,
      droppedFrames: this.droppedFrames,
    }
  }

  /**
   * DOM情報を取得
   */
  private getDOMInfo(): PerformanceMetrics['dom'] {
    if (typeof document === 'undefined') {
      return { nodeCount: 0, eventListeners: 0 }
    }

    const nodeCount = document.getElementsByTagName('*').length

    // イベントリスナー数は推定（正確な取得は困難）
    const eventListeners = Math.round(nodeCount * 0.1) // おおよその推定

    return {
      nodeCount,
      eventListeners,
    }
  }

  /**
   * ネットワーク情報を取得
   */
  private getNetworkInfo(): PerformanceMetrics['network'] {
    if (typeof performance === 'undefined') {
      return { pendingRequests: 0, totalTransferSize: 0 }
    }

    const resourceEntries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    const totalTransferSize = resourceEntries.reduce((total, entry) => {
      const transferSize = (entry as PerformanceResourceTiming & { transferSize?: number }).transferSize
      return total + (typeof transferSize === 'number' ? transferSize : 0)
    }, 0)

    // ペンディングリクエスト数は推定（正確な取得は困難）
    const pendingRequests = 0 // 実際の実装ではフェッチAPIをラップする必要があります

    return {
      pendingRequests,
      totalTransferSize,
    }
  }

  /**
   * 監視を開始
   */
  startMonitoring(): void {
    if (this.isMonitoring) {
      console.warn('パフォーマンス監視は既に実行中です')
      return
    }

    this.isMonitoring = true
    this.samples = []
    this.frameCount = 0
    this.droppedFrames = 0
    this.lastFrameTime = 0

    // 定期監視
    this.monitoringInterval = window.setInterval(() => {
      this.collectSample()
    }, this.options.interval)

    // FPS監視用のanimationFrame
    this.startFrameMonitoring()

    if (this.options.enableLogging) {
      console.log(`📈 パフォーマンス監視を開始しました (間隔: ${this.options.interval}ms)`)
    }
  }

  /**
   * フレーム監視を開始
   */
  private startFrameMonitoring(): void {
    const monitorFrame = () => {
      if (this.isMonitoring) {
        this.getCurrentMetrics() // レンダリング情報を更新
        this.rafId = requestAnimationFrame(monitorFrame)
      }
    }
    this.rafId = requestAnimationFrame(monitorFrame)
  }

  /**
   * 監視を停止
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return
    }

    this.isMonitoring = false

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval)
      this.monitoringInterval = null
    }

    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }

    if (this.options.enableLogging) {
      console.log('📈 パフォーマンス監視を停止しました')
    }
  }

  /**
   * サンプルを収集
   */
  private collectSample(): void {
    const metrics = this.getCurrentMetrics()

    // 最大サンプル数を超えた場合は古いものを削除
    if (this.samples.length >= this.options.maxSamples) {
      this.samples.shift()
    }

    this.samples.push(metrics)

    // 警告チョック
    this.checkWarnings(metrics)

    if (this.options.enableLogging) {
      this.logMetrics(metrics)
    }
  }

  /**
   * 警告チェック
   */
  private checkWarnings(metrics: PerformanceMetrics): void {
    // メモリ警告
    if (metrics.memory.used > this.options.memoryThreshold) {
      console.warn(`⚠️  メモリ使用量が高いです: ${metrics.memory.used}MB (${metrics.memory.percentage}%)`)
    }

    // FPS警告
    if (metrics.rendering.fps < this.options.fpsThreshold) {
      console.warn(`⚠️  FPSが低下しています: ${metrics.rendering.fps}fps`)
    }

    // ドロップフレーム警告
    if (metrics.rendering.droppedFrames > 10) {
      console.warn(`⚠️  フレームドロップが発生しています: ${metrics.rendering.droppedFrames}回`)
    }

    // DOMノード警告
    if (metrics.dom.nodeCount > 5000) {
      console.warn(`⚠️  DOMノード数が多いです: ${metrics.dom.nodeCount}個`)
    }
  }

  /**
   * メトリクスをログ出力
   */
  private logMetrics(metrics: PerformanceMetrics): void {
    console.log(`📈 パフォーマンス: メモリ ${metrics.memory.used}MB (${metrics.memory.percentage}%) | FPS ${metrics.rendering.fps} | DOM ${metrics.dom.nodeCount} nodes`)
  }

  /**
   * 統計情報を取得
   */
  getStatistics(): {
    averageMemoryUsage: number
    averageFps: number
    totalSamples: number
    monitoringDuration: number // minutes
  } | null {
    if (this.samples.length === 0) {
      return null
    }

    const totalMemory = this.samples.reduce((sum, sample) => sum + sample.memory.used, 0)
    const totalFps = this.samples.reduce((sum, sample) => sum + sample.rendering.fps, 0)
    const averageMemoryUsage = Math.round(totalMemory / this.samples.length)
    const averageFps = Math.round(totalFps / this.samples.length)

    const firstSample = this.samples[0]
    const lastSample = this.samples[this.samples.length - 1]

    if (!firstSample || !lastSample) {
      return {
        averageMemoryUsage,
        averageFps,
        totalSamples: this.samples.length,
        monitoringDuration: 0,
      }
    }

    const monitoringDuration = Math.round((lastSample.timestamp - firstSample.timestamp) / 1000 / 60)

    return {
      averageMemoryUsage,
      averageFps,
      totalSamples: this.samples.length,
      monitoringDuration,
    }
  }

  /**
   * パフォーマンスレポートを生成
   */
  generateReport(): string {
    const stats = this.getStatistics()
    if (!stats) {
      return 'パフォーマンスデータがありません'
    }

    const currentMetrics = this.getCurrentMetrics()

    return `
📈 ProjectLens パフォーマンスレポート
${'='.repeat(50)}

🔄 監視期間: ${stats.monitoringDuration}分 (${stats.totalSamples}サンプル)

🧠 メモリ使用量:
  現在: ${currentMetrics.memory.used}MB (${currentMetrics.memory.percentage}%)
  平均: ${stats.averageMemoryUsage}MB
  目標: < ${this.options.memoryThreshold}MB
  状態: ${currentMetrics.memory.used < this.options.memoryThreshold ? '✅ 良好' : '⚠️  注意'}

🎨 レンダリングパフォーマンス:
  現在FPS: ${currentMetrics.rendering.fps}
  平均FPS: ${stats.averageFps}
  目標: > ${this.options.fpsThreshold}fps
  フレームドロップ: ${currentMetrics.rendering.droppedFrames}回
  状態: ${currentMetrics.rendering.fps >= this.options.fpsThreshold ? '✅ 良好' : '⚠️  注意'}

🌍 DOM情報:
  ノード数: ${currentMetrics.dom.nodeCount}個
  イベントリスナー: ${currentMetrics.dom.eventListeners}個
  状態: ${currentMetrics.dom.nodeCount < 5000 ? '✅ 良好' : '⚠️  注意'}

🌐 ネットワーク:
  総転送サイズ: ${Math.round(currentMetrics.network.totalTransferSize / 1024)}KB
  ペンディングリクエスト: ${currentMetrics.network.pendingRequests}件

${'='.repeat(50)}
`
  }

  /**
   * リソースをクリーンアップ
   */
  cleanup(): void {
    this.stopMonitoring()

    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }

    this.samples = []

    if (this.options.enableLogging) {
      console.log('🧹 パフォーマンスモニターをクリーンアップしました')
    }
  }
}

// グローバルインスタンスを作成
let globalMonitor: PerformanceMonitor | null = null

/**
 * グローバルパフォーマンスモニターを取得/作成
 */
export function getPerformanceMonitor(options?: Partial<PerformanceMonitorOptions>): PerformanceMonitor {
  if (!globalMonitor) {
    globalMonitor = new PerformanceMonitor(options)
  }
  return globalMonitor
}

/**
 * メモリ使用量を簡単に取得
 */
export function getCurrentMemoryUsage(): { used: number, percentage: number } | null {
  const memory = (performance as Performance & {
    memory?: {
      usedJSHeapSize: number
      totalJSHeapSize: number
      jsHeapSizeLimit: number
    }
  }).memory
  if (typeof window === 'undefined' || !memory) {
    return null
  }
  const used = Math.round(memory.usedJSHeapSize / 1024 / 1024)
  const total = Math.round(memory.totalJSHeapSize / 1024 / 1024)
  const percentage = Math.round((used / total) * 100)

  return { used, percentage }
}

/**
 * パフォーマンス測定用デコレーター
 */
export function measurePerformance(_target: unknown, propertyName: string, descriptor: PropertyDescriptor) {
  const originalMethod = descriptor.value

  descriptor.value = function (...args: unknown[]) {
    const startTime = performance.now()
    const result = originalMethod.apply(this, args)
    const endTime = performance.now()
    const duration = endTime - startTime

    if (duration > 10) { // 10ms以上かかった場合のみログ
      console.log(`⏱️  ${propertyName}: ${Math.round(duration * 100) / 100}ms`)
    }

    return result
  }

  return descriptor
}

/**
 * メモリリーク検出ユーティリティ
 */
export class MemoryLeakDetector {
  private objectCounts: Map<string, number> = new Map()
  private intervalId: number | null = null

  /**
   * メモリリーク検出を開始
   */
  startDetection(interval: number = 10000): void {
    this.intervalId = window.setInterval(() => {
      this.checkForLeaks()
    }, interval)

    console.log('🔍 メモリリーク検出を開始しました')
  }

  /**
   * メモリリーク検出を停止
   */
  stopDetection(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    console.log('🔍 メモリリーク検出を停止しました')
  }

  /**
   * リークチェック
   */
  private checkForLeaks(): void {
    const currentMemory = getCurrentMemoryUsage()
    if (!currentMemory) return

    // DOMノード数のチェック
    if (typeof document !== 'undefined') {
      const nodeCount = document.getElementsByTagName('*').length
      const previousCount = this.objectCounts.get('domNodes') || 0

      if (nodeCount > previousCount * 1.2) { // 20%以上の増加
        console.warn(`⚠️  DOMノード数が急增しています: ${previousCount} -> ${nodeCount}`)
      }

      this.objectCounts.set('domNodes', nodeCount)
    }

    // メモリ使用量のチェック
    const previousMemory = this.objectCounts.get('memory') || 0
    if (currentMemory.used > previousMemory * 1.5) { // 50%以上の増加
      console.warn(`⚠️  メモリ使用量が急增しています: ${previousMemory}MB -> ${currentMemory.used}MB`)
    }

    this.objectCounts.set('memory', currentMemory.used)
  }
}

// Vue.js用のコンポーザブル
export function usePerformanceMonitor(options?: Partial<PerformanceMonitorOptions>) {
  const monitor = getPerformanceMonitor(options)

  const startMonitoring = () => monitor.startMonitoring()
  const stopMonitoring = () => monitor.stopMonitoring()
  const getMetrics = () => monitor.getCurrentMetrics()
  const getStats = () => monitor.getStatistics()
  const generateReport = () => monitor.generateReport()
  const cleanup = () => monitor.cleanup()

  // コンポーネントのアンマウント時にクリーンアップ
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', cleanup)
  }

  return {
    monitor,
    startMonitoring,
    stopMonitoring,
    getMetrics,
    getStats,
    generateReport,
    cleanup,
  }
}
