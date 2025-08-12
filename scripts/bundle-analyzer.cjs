#!/usr/bin/env node

/**
 * バンドルサイズ解析スクリプト
 * ビルド済みファイルのサイズを解析し、パフォーマンス最適化のしきい値を求める
 */

const fs = require('fs')
const path = require('path')
const { gzipSizeSync } = require('gzip-size')

const PROJECT_ROOT = path.join(__dirname, '..')
const DIST_ELECTRON = path.join(PROJECT_ROOT, 'dist-electron')
const DIST_OUTPUT = path.join(PROJECT_ROOT, '.output')
const PERFORMANCE_DIR = path.join(PROJECT_ROOT, '.performance')

class BundleAnalyzer {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      bundles: {},
      totals: {
        size: 0,
        gzipSize: 0,
        files: 0,
      },
      recommendations: [],
      performance: {
        targets: {
          mainBundle: 500, // KB
          vendorBundle: 1000, // KB
          totalBundle: 2000, // KB
          gzipRatio: 0.3, // 30%以下
        },
        scores: {},
      },
    }

    // パフォーマンスディレクトリを作成
    if (!fs.existsSync(PERFORMANCE_DIR)) {
      fs.mkdirSync(PERFORMANCE_DIR, { recursive: true })
    }
  }

  /**
   * ファイルサイズを測定
   */
  analyzeFile(filePath, category = 'other') {
    if (!fs.existsSync(filePath)) {
      return null
    }

    const stats = fs.statSync(filePath)
    const content = fs.readFileSync(filePath)
    const size = stats.size
    const gzipSize = gzipSizeSync(content)
    const gzipRatio = gzipSize / size
    const fileName = path.basename(filePath)
    const ext = path.extname(filePath)

    const analysis = {
      path: filePath,
      fileName,
      category,
      extension: ext,
      size: Math.round(size / 1024), // KB
      gzipSize: Math.round(gzipSize / 1024), // KB
      gzipRatio: Math.round(gzipRatio * 100) / 100,
      compressionEfficiency: Math.round((1 - gzipRatio) * 100), // %
    }

    // カテゴリ別に集計
    if (!this.results.bundles[category]) {
      this.results.bundles[category] = {
        files: [],
        totalSize: 0,
        totalGzipSize: 0,
        fileCount: 0,
      }
    }

    this.results.bundles[category].files.push(analysis)
    this.results.bundles[category].totalSize += analysis.size
    this.results.bundles[category].totalGzipSize += analysis.gzipSize
    this.results.bundles[category].fileCount += 1

    this.results.totals.size += analysis.size
    this.results.totals.gzipSize += analysis.gzipSize
    this.results.totals.files += 1

    return analysis
  }

  /**
   * Electronバンドルを解析
   */
  analyzeElectronBundles() {
    console.log('🔍 Electronバンドルを解析中...')

    // メインプロセス
    const mainPath = path.join(DIST_ELECTRON, 'main/index.cjs')
    if (fs.existsSync(mainPath)) {
      this.analyzeFile(mainPath, 'electron-main')
      console.log('✅ メインプロセスバンドルを解析')
    }
    else {
      console.log('⚠️  メインプロセスバンドルが見つかりません')
    }

    // プリロードスクリプト
    const preloadPath = path.join(DIST_ELECTRON, 'preload/index.cjs')
    if (fs.existsSync(preloadPath)) {
      this.analyzeFile(preloadPath, 'electron-preload')
      console.log('✅ プリロードスクリプトを解析')
    }
    else {
      console.log('⚠️  プリロードスクリプトが見つかりません')
    }
  }

  /**
   * Nuxtバンドルを解析
   */
  analyzeNuxtBundles() {
    console.log('🔍 Nuxtバンドルを解析中...')

    if (!fs.existsSync(DIST_OUTPUT)) {
      console.log('⚠️  Nuxtビルドフォルダが見つかりません')
      return
    }

    this.analyzeDirectory(DIST_OUTPUT)
  }

  /**
   * ディレクトリを再帰的に解析
   */
  analyzeDirectory(dirPath, baseCategory = 'nuxt') {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)

      if (entry.isDirectory()) {
        // サブディレクトリを解析
        this.analyzeDirectory(fullPath, `${baseCategory}-${entry.name}`)
      }
      else {
        // ファイルタイプでカテゴリを決定
        const ext = path.extname(entry.name)
        let category = baseCategory

        if (ext === '.js' || ext === '.mjs') {
          if (entry.name.includes('vendor')) {
            category = 'vendor-js'
          }
          else if (entry.name.includes('chunk')) {
            category = 'chunks-js'
          }
          else {
            category = 'app-js'
          }
        }
        else if (ext === '.css') {
          category = 'css'
        }
        else if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico'].includes(ext)) {
          category = 'assets'
        }
        else if (ext === '.html') {
          category = 'html'
        }
        else {
          category = 'other'
        }

        this.analyzeFile(fullPath, category)
      }
    }
  }

  /**
   * パフォーマンススコアを計算
   */
  calculatePerformanceScores() {
    const targets = this.results.performance.targets
    const totals = this.results.totals

    // 全体バンドルサイズスコア
    this.results.performance.scores.totalSize = Math.max(0, 100 - (totals.size - targets.totalBundle) / 10)

    // 圧縮率スコア
    const overallGzipRatio = totals.gzipSize / totals.size
    this.results.performance.scores.compression = overallGzipRatio <= targets.gzipRatio
      ? 100
      : Math.max(0, 100 - ((overallGzipRatio - targets.gzipRatio) * 500))

    // カテゴリ別スコア
    Object.keys(this.results.bundles).forEach((category) => {
      const bundle = this.results.bundles[category]
      const avgFileSize = bundle.totalSize / bundle.fileCount

      // 平均ファイルサイズスコア（100KB以下を目標）
      bundle.averageFileSize = avgFileSize
      bundle.performanceScore = Math.max(0, 100 - (avgFileSize - 100) / 2)
    })

    // 総合スコア
    const scores = this.results.performance.scores
    scores.overall = (scores.totalSize + scores.compression) / 2
  }

  /**
   * 推奨事項を生成
   */
  generateRecommendations() {
    const bundles = this.results.bundles
    const totals = this.results.totals
    const recommendations = []

    // 全体サイズのチェック
    if (totals.size > this.results.performance.targets.totalBundle) {
      recommendations.push({
        type: 'warning',
        category: '全体サイズ',
        message: `全体バンドルサイズが目標 (${this.results.performance.targets.totalBundle}KB) を超過しています (${totals.size}KB)`,
        suggestion: '不要な依存関係の削除、コード分割、Tree Shakingの強化を検討してください',
      })
    }

    // 圧縮率のチェック
    const gzipRatio = totals.gzipSize / totals.size
    if (gzipRatio > this.results.performance.targets.gzipRatio) {
      recommendations.push({
        type: 'info',
        category: '圧縮率',
        message: `GZIP圧縮率が目標 (${this.results.performance.targets.gzipRatio * 100}%) より高いです (${Math.round(gzipRatio * 100)}%)`,
        suggestion: 'ミニファイの強化、コードの重複除去、テキストベースフォーマットの最適化を検討してください',
      })
    }

    // カテゴリ別のチェック
    Object.keys(bundles).forEach((category) => {
      const bundle = bundles[category]

      // 大きなファイルの検出
      const largeFiles = bundle.files.filter(file => file.size > 200) // 200KB以上
      if (largeFiles.length > 0) {
        recommendations.push({
          type: 'warning',
          category: `${category}ファイルサイズ`,
          message: `${category}で大きなファイルが検出されました: ${largeFiles.map(f => `${f.fileName} (${f.size}KB)`).join(', ')}`,
          suggestion: 'コード分割、遅延ロード、動的インポートの導入を検討してください',
        })
      }

      // 圧縮効率の悪いファイル
      const poorCompression = bundle.files.filter(file => file.compressionEfficiency < 30) // 30%未満
      if (poorCompression.length > 0) {
        recommendations.push({
          type: 'info',
          category: `${category}圧縮効率`,
          message: `${category}で圧縮効率の低いファイル: ${poorCompression.map(f => `${f.fileName} (${f.compressionEfficiency}%)`).join(', ')}`,
          suggestion: 'バイナリファイル、既に圧縮されたファイル、またはテキスト最適化が必要な可能性があります',
        })
      }
    })

    this.results.recommendations = recommendations
  }

  /**
   * 結果を表示
   */
  displayResults() {
    console.log('\n📊 バンドル解析結果')
    console.log('=' * 60)

    // 全体サマリー
    console.log(`\n📦 全体サマリー:`)
    console.log(`   ファイル数: ${this.results.totals.files}個`)
    console.log(`   合計サイズ: ${this.results.totals.size}KB`)
    console.log(`   GZIPサイズ: ${this.results.totals.gzipSize}KB`)
    console.log(`   圧縮率: ${Math.round((this.results.totals.gzipSize / this.results.totals.size) * 100)}%`)

    // パフォーマンススコア
    const scores = this.results.performance.scores
    console.log(`\n📈 パフォーマンススコア:`)
    console.log(`   総合スコア: ${Math.round(scores.overall)}/100`)
    console.log(`   サイズスコア: ${Math.round(scores.totalSize)}/100`)
    console.log(`   圧縮スコア: ${Math.round(scores.compression)}/100`)

    // カテゴリ別結果
    console.log(`\n📁 カテゴリ別詳細:`)
    Object.keys(this.results.bundles).forEach((category) => {
      const bundle = this.results.bundles[category]
      console.log(`\n   ${category.toUpperCase()}:`)
      console.log(`     ファイル数: ${bundle.fileCount}個`)
      console.log(`     合計サイズ: ${bundle.totalSize}KB`)
      console.log(`     GZIPサイズ: ${bundle.totalGzipSize}KB`)
      console.log(`     平均ファイルサイズ: ${Math.round(bundle.averageFileSize)}KB`)
      console.log(`     パフォーマンススコア: ${Math.round(bundle.performanceScore)}/100`)

      // 大きなファイルを表示
      const largeFiles = bundle.files.filter(f => f.size > 50).sort((a, b) => b.size - a.size).slice(0, 3)
      if (largeFiles.length > 0) {
        console.log(`     大きなファイル: ${largeFiles.map(f => `${f.fileName} (${f.size}KB)`).join(', ')}`)
      }
    })

    // 推奨事項
    if (this.results.recommendations.length > 0) {
      console.log(`\n💡 推奨事項:`)
      this.results.recommendations.forEach((rec, index) => {
        const icon = rec.type === 'warning' ? '⚠️ ' : 'ℹ️ '
        console.log(`\n   ${index + 1}. ${icon}${rec.category}`)
        console.log(`      ${rec.message}`)
        console.log(`      推奨: ${rec.suggestion}`)
      })
    }
    else {
      console.log(`\n🎉 パフォーマンスが理想的です！`)
    }

    console.log('\n' + '=' * 60)
  }

  /**
   * 結果をJSONファイルに保存
   */
  saveResults() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `bundle-analysis-${timestamp}.json`
    const filepath = path.join(PERFORMANCE_DIR, filename)

    fs.writeFileSync(filepath, JSON.stringify(this.results, null, 2))

    // 最新結果を保存
    const latestPath = path.join(PERFORMANCE_DIR, 'bundle-analysis-latest.json')
    fs.writeFileSync(latestPath, JSON.stringify(this.results, null, 2))

    console.log(`\n💾 結果を保存しました: ${filepath}`)
    return filepath
  }

  /**
   * 完全な解析を実行
   */
  async runFullAnalysis() {
    try {
      console.log('🔍 ProjectLens バンドル解析開始\n')

      // Electronバンドル解析
      this.analyzeElectronBundles()

      // Nuxtバンドル解析
      this.analyzeNuxtBundles()

      // パフォーマンススコア計算
      this.calculatePerformanceScores()

      // 推奨事項生成
      this.generateRecommendations()

      // 結果表示
      this.displayResults()

      // 結果保存
      this.saveResults()

      return this.results
    }
    catch (error) {
      console.error('❌ バンドル解析でエラーが発生しました:', error.message)
      process.exit(1)
    }
  }
}

// CLI実行
if (require.main === module) {
  // gzip-sizeパッケージがインストールされていない場合のフォールバック
  try {
    require('gzip-size')
  }
  catch (_error) {
    console.log('📊 gzip-sizeパッケージが見つかりません。シンプルモードで実行します...')

    // シンプルなフォールバック実装
    global.gzipSizeSync = content => Math.round(content.length * 0.3) // 簡単な推定
  }

  const analyzer = new BundleAnalyzer()
  analyzer.runFullAnalysis()
}

module.exports = BundleAnalyzer
