#!/usr/bin/env node

/**
 * パフォーマンス監視スクリプト
 * 起動時間とメモリ使用量を測定
 */

const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

// パフォーマンス測定結果を保存するディレクトリ
const PERFORMANCE_DIR = path.join(__dirname, '../.performance')

if (!fs.existsSync(PERFORMANCE_DIR)) {
  fs.mkdirSync(PERFORMANCE_DIR, { recursive: true })
}

class PerformanceMonitor {
  constructor() {
    this.startTime = null
    this.metrics = {
      startup: {
        electronStart: null,
        windowReady: null,
        appReady: null,
        total: null,
      },
      memory: {
        initial: null,
        afterStart: null,
        peak: null,
        current: null,
      },
      bundle: {
        mainSize: null,
        rendererSize: null,
        preloadSize: null,
      },
    }
  }

  /**
   * Electronアプリの起動時間を測定
   */
  async measureStartupTime() {
    console.log('🚀 起動時間の測定を開始...')
    this.startTime = Date.now()

    return new Promise((resolve, reject) => {
      // Electronプロセスを起動
      const electronProcess = spawn('npm', ['run', 'dev:electron'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PERFORMANCE_MONITOR: 'true' },
      })

      let windowReadyTime = null
      let appReadyTime = null

      electronProcess.stdout.on('data', (data) => {
        const output = data.toString()
        console.log(output)

        // ウィンドウ準備完了の検出
        if (output.includes('ready-to-show') && !windowReadyTime) {
          windowReadyTime = Date.now() - this.startTime
          console.log(`⚡ ウィンドウ準備完了: ${windowReadyTime}ms`)
        }

        // アプリケーション完全起動の検出
        if (output.includes('Nuxt ready') && !appReadyTime) {
          appReadyTime = Date.now() - this.startTime
          console.log(`✅ アプリケーション準備完了: ${appReadyTime}ms`)

          this.metrics.startup = {
            electronStart: this.startTime,
            windowReady: windowReadyTime,
            appReady: appReadyTime,
            total: appReadyTime,
          }

          // 10秒後にプロセスを終了
          setTimeout(() => {
            electronProcess.kill()
            resolve(this.metrics.startup)
          }, 10000)
        }
      })

      electronProcess.stderr.on('data', (data) => {
        console.error(`❌ エラー: ${data}`)
      })

      electronProcess.on('close', (code) => {
        if (code !== 0 && !appReadyTime) {
          reject(new Error(`Electronプロセスがコード ${code} で終了しました`))
        }
      })

      // タイムアウト（60秒）
      setTimeout(() => {
        electronProcess.kill()
        reject(new Error('起動時間の測定がタイムアウトしました'))
      }, 60000)
    })
  }

  /**
   * メモリ使用量を測定
   */
  async measureMemoryUsage() {
    console.log('🧠 メモリ使用量の測定を開始...')

    // プロセスの初期メモリ使用量
    const initialMemory = process.memoryUsage()
    this.metrics.memory.initial = {
      rss: Math.round(initialMemory.rss / 1024 / 1024), // MB
      heapTotal: Math.round(initialMemory.heapTotal / 1024 / 1024),
      heapUsed: Math.round(initialMemory.heapUsed / 1024 / 1024),
      external: Math.round(initialMemory.external / 1024 / 1024),
    }

    console.log('💾 初期メモリ使用量:', this.metrics.memory.initial)
    return this.metrics.memory
  }

  /**
   * バンドルサイズを測定
   */
  async measureBundleSize() {
    console.log('📦 バンドルサイズの測定を開始...')

    const distPath = path.join(__dirname, '../dist-electron')
    const outputPath = path.join(__dirname, '../.output')

    try {
      // メインプロセス
      const mainPath = path.join(distPath, 'main/index.cjs')
      if (fs.existsSync(mainPath)) {
        const mainStats = fs.statSync(mainPath)
        this.metrics.bundle.mainSize = Math.round(mainStats.size / 1024) // KB
      }

      // プリロード
      const preloadPath = path.join(distPath, 'preload/index.cjs')
      if (fs.existsSync(preloadPath)) {
        const preloadStats = fs.statSync(preloadPath)
        this.metrics.bundle.preloadSize = Math.round(preloadStats.size / 1024) // KB
      }

      // レンダラー（Nuxtビルド）
      if (fs.existsSync(outputPath)) {
        let totalSize = 0
        const calculateDirSize = (dirPath) => {
          const files = fs.readdirSync(dirPath, { withFileTypes: true })
          for (const file of files) {
            const filePath = path.join(dirPath, file.name)
            if (file.isDirectory()) {
              calculateDirSize(filePath)
            }
            else {
              totalSize += fs.statSync(filePath).size
            }
          }
        }
        calculateDirSize(outputPath)
        this.metrics.bundle.rendererSize = Math.round(totalSize / 1024) // KB
      }

      console.log('📊 バンドルサイズ:', this.metrics.bundle)
      return this.metrics.bundle
    }
    catch (error) {
      console.error('バンドルサイズ測定エラー:', error.message)
      return this.metrics.bundle
    }
  }

  /**
   * 結果をファイルに保存
   */
  async saveResults() {
    const timestamp = new Date().toISOString()
    const results = {
      timestamp,
      metrics: this.metrics,
      targets: {
        startupTime: 3000, // 3秒以内
        memoryUsage: 500, // 500MB以内
      },
      passed: {
        startupTime: this.metrics.startup.total < 3000,
        memoryUsage: this.metrics.memory.initial?.rss < 500,
      },
    }

    // 詳細結果を保存
    const resultFile = path.join(PERFORMANCE_DIR, `performance-${Date.now()}.json`)
    fs.writeFileSync(resultFile, JSON.stringify(results, null, 2))

    // 最新結果を保存
    const latestFile = path.join(PERFORMANCE_DIR, 'latest.json')
    fs.writeFileSync(latestFile, JSON.stringify(results, null, 2))

    console.log('💾 結果を保存しました:', resultFile)
    return results
  }

  /**
   * 結果を表示
   */
  displayResults(results) {
    console.log('\n📊 パフォーマンス測定結果')
    console.log('=' * 50)

    // 起動時間
    const startupTime = results.metrics.startup.total
    const startupStatus = results.passed.startupTime ? '✅ 合格' : '❌ 不合格'
    console.log(`🚀 起動時間: ${startupTime}ms (目標: 3000ms未満) ${startupStatus}`)

    // メモリ使用量
    const memoryUsage = results.metrics.memory.initial?.rss || 0
    const memoryStatus = results.passed.memoryUsage ? '✅ 合格' : '❌ 不合格'
    console.log(`🧠 メモリ使用量: ${memoryUsage}MB (目標: 500MB未満) ${memoryStatus}`)

    // バンドルサイズ
    const bundle = results.metrics.bundle
    console.log(`📦 バンドルサイズ:`)
    console.log(`   - メインプロセス: ${bundle.mainSize || 0}KB`)
    console.log(`   - プリロード: ${bundle.preloadSize || 0}KB`)
    console.log(`   - レンダラー: ${bundle.rendererSize || 0}KB`)

    console.log('=' * 50)

    if (results.passed.startupTime && results.passed.memoryUsage) {
      console.log('🎉 全ての目標を達成しました！')
    }
    else {
      console.log('⚠️  目標未達成の項目があります。最適化が必要です。')
    }
  }

  /**
   * 完全なパフォーマンステストを実行
   */
  async runFullTest() {
    try {
      console.log('🔥 ProjectLens パフォーマンステスト開始\n')

      // バンドルサイズ測定（ビルド済みファイルが必要）
      await this.measureBundleSize()

      // メモリ使用量測定
      await this.measureMemoryUsage()

      // 起動時間測定
      await this.measureStartupTime()

      // 結果保存と表示
      const results = await this.saveResults()
      this.displayResults(results)

      return results
    }
    catch (error) {
      console.error('❌ パフォーマンステストでエラーが発生しました:', error.message)
      process.exit(1)
    }
  }
}

// CLI実行
if (require.main === module) {
  const monitor = new PerformanceMonitor()

  const command = process.argv[2]

  switch (command) {
    case 'startup':
      monitor.measureStartupTime().then((results) => {
        console.log('起動時間測定完了:', results)
      })
      break
    case 'memory':
      monitor.measureMemoryUsage().then((results) => {
        console.log('メモリ使用量測定完了:', results)
      })
      break
    case 'bundle':
      monitor.measureBundleSize().then((results) => {
        console.log('バンドルサイズ測定完了:', results)
      })
      break
    case 'full':
    default:
      monitor.runFullTest()
      break
  }
}

module.exports = PerformanceMonitor
