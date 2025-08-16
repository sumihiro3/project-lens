#!/usr/bin/env node

/**
 * Stage統合テスト実行スクリプト
 *
 * Stage実装のテストスイートを実行し、詳細なレポートを生成します。
 */

const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

// テスト設定
const TEST_CONFIG = {
  timeout: 60000, // 60秒
  coverage: true,
  verbose: true,
  bail: false, // テスト失敗時も継続実行
}

// 色付きコンソール出力
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
}

function colorLog(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

// テストレポート生成
function generateTestReport(results) {
  const reportPath = path.join(__dirname, '..', '.test-reports', 'stage-integration-report.json')
  const reportDir = path.dirname(reportPath)

  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true })
  }

  const report = {
    timestamp: new Date().toISOString(),
    testSuite: 'Stage Integration Tests',
    ...results,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  }

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  return reportPath
}

// メイン実行関数
async function runStageTests() {
  colorLog('🚀 Stage統合テスト実行を開始します', 'bright')
  colorLog('='.repeat(60), 'cyan')

  const startTime = Date.now()

  try {
    // テスト前の環境チェック
    colorLog('📋 環境チェック中...', 'blue')

    // Node.js バージョンチェック
    const nodeVersion = process.version
    colorLog(`  Node.js: ${nodeVersion}`, 'green')

    // 依存関係チェック
    const packageJson = require('../package.json')
    colorLog(`  Vitest: ${packageJson.devDependencies.vitest}`, 'green')

    // テストファイルの存在確認
    const testFile = path.join(__dirname, '..', 'electron', 'test', 'services', 'backlog', 'stage-integration.test.ts')
    if (!fs.existsSync(testFile)) {
      throw new Error(`テストファイルが見つかりません: ${testFile}`)
    }
    colorLog(`  テストファイル: ✓`, 'green')

    colorLog('📋 環境チェック完了', 'green')

    // テスト実行
    colorLog('🧪 Stage統合テストを実行中...', 'blue')

    const testCommand = 'npm'
    const testArgs = ['run', 'test:stage']

    if (TEST_CONFIG.coverage) {
      testArgs.push('--', '--coverage')
    }

    if (TEST_CONFIG.verbose) {
      testArgs.push('--', '--reporter=verbose')
    }

    const testProcess = spawn(testCommand, testArgs, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        VITEST: 'true',
      },
    })

    const testResults = await new Promise((resolve, reject) => {
      testProcess.on('close', (code) => {
        const endTime = Date.now()
        const duration = endTime - startTime

        const results = {
          success: code === 0,
          exitCode: code,
          duration,
          command: `${testCommand} ${testArgs.join(' ')}`,
        }

        if (code === 0) {
          resolve(results)
        }
        else {
          reject(new Error(`テスト実行が失敗しました (exit code: ${code})`))
        }
      })

      testProcess.on('error', (error) => {
        reject(error)
      })
    })

    // 成功時の処理
    const duration = testResults.duration
    colorLog('='.repeat(60), 'cyan')
    colorLog('🎉 Stage統合テストが正常に完了しました！', 'green')
    colorLog(`⏱️  実行時間: ${(duration / 1000).toFixed(2)}秒`, 'blue')

    // レポート生成
    const reportPath = generateTestReport(testResults)
    colorLog(`📊 テストレポート: ${reportPath}`, 'blue')

    // パフォーマンス統計表示
    colorLog('📈 パフォーマンス概要:', 'magenta')
    colorLog(`   - テスト実行時間: ${(duration / 1000).toFixed(2)}秒`, 'cyan')
    colorLog(`   - 成功/失敗: ${testResults.success ? '成功' : '失敗'}`, testResults.success ? 'green' : 'red')

    // 次のステップの提案
    colorLog('', 'reset')
    colorLog('🎯 次のステップ:', 'yellow')
    colorLog('   1. カバレッジレポートを確認してください', 'cyan')
    colorLog('   2. パフォーマンス指標を監視してください', 'cyan')
    colorLog('   3. 実際のBacklog APIでの結合テストを検討してください', 'cyan')

    return 0
  }
  catch (error) {
    // エラー時の処理
    const duration = Date.now() - startTime

    colorLog('='.repeat(60), 'cyan')
    colorLog('❌ Stage統合テストが失敗しました', 'red')
    colorLog(`⏱️  実行時間: ${(duration / 1000).toFixed(2)}秒`, 'blue')
    colorLog(`🔥 エラー: ${error.message}`, 'red')

    // エラーレポート生成
    const errorResults = {
      success: false,
      error: error.message,
      stack: error.stack,
      duration,
    }

    const reportPath = generateTestReport(errorResults)
    colorLog(`📊 エラーレポート: ${reportPath}`, 'blue')

    // トラブルシューティング情報
    colorLog('', 'reset')
    colorLog('🔧 トラブルシューティング:', 'yellow')
    colorLog('   1. 依存関係が正しくインストールされているか確認してください', 'cyan')
    colorLog('   2. TypeScriptコンパイルエラーがないか確認してください', 'cyan')
    colorLog('   3. テストファイルの構文が正しいか確認してください', 'cyan')
    colorLog('   4. 詳細はエラーレポートを参照してください', 'cyan')

    return 1
  }
}

// スクリプトが直接実行された場合
if (require.main === module) {
  runStageTests()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      colorLog(`Fatal error: ${error.message}`, 'red')
      process.exit(1)
    })
}

module.exports = { runStageTests }
