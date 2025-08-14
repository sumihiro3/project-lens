import { app, BrowserWindow, shell, protocol } from 'electron'
import { join } from 'node:path'
import * as fs from 'node:fs'
import { is } from '@electron-toolkit/utils'
import { getDatabase, type DatabaseConfig } from './database/connection'
import logger, { info, error, warn, debug, fatal, withAsyncPerformance } from './utils/logger'

// パフォーマンス最適化: 起動時間測定
const startTime = Date.now()
let windowReadyTime: number | null = null
let databaseInitTime: number | null = null

// Pinoログシステムの早期初期化（100ms以内保証）
// logger は default export でインポートされているため、ここで追加設定
logger.info('Electron main process starting', {
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  nodeVersion: process.version,
  electronVersion: process.versions.electron,
})

// 未処理例外とプロセス終了のログ設定
process.on('uncaughtException', (error) => {
  fatal('Uncaught Exception', error, {
    origin: 'uncaughtException',
    pid: process.pid,
    uptime: process.uptime(),
  })
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  const errorReason = reason instanceof Error ? reason : new Error(String(reason))
  error('Unhandled Rejection', errorReason, {
    origin: 'unhandledRejection',
    promise: promise.toString(),
  })
})

// Electronアプリエラーハンドリング
app.on('render-process-gone', (_, __, details) => {
  error('Render process gone', new Error(details.reason), {
    reason: details.reason,
    exitCode: details.exitCode,
  })
})

app.on('child-process-gone', (_, details) => {
  error('Child process gone', new Error(details.reason), {
    serviceName: details.serviceName,
    reason: details.reason,
    exitCode: details.exitCode,
  })
})

// パフォーマンス最適化: メモリ使用量を最適化
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder')
app.commandLine.appendSwitch('ignore-gpu-blacklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')

// プロダクション環境でのメモリ最適化
if (!is.dev) {
  app.commandLine.appendSwitch('memory-pressure-off')
  app.commandLine.appendSwitch('max_old_space_size', '512')
  app.commandLine.appendSwitch('no-sandbox')
}

function createWindow(): void {
  logger.debug('Creating main window')

  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    // パフォーマンス最適化: 背景色を指定してフラッシュを防ぐ
    backgroundColor: '#ffffff',
    // パフォーマンス最適化: ウィンドウアニメーションを無効化
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset',
          vibrancy: 'under-window',
        }
      : {}),
    ...(process.platform === 'linux' ? { icon: join(__dirname, '../../build/icon.png') } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // パフォーマンス最適化設定
      backgroundThrottling: false,
      experimentalFeatures: false,
      // メモリ最適化
      ...(!is.dev && {
        devTools: false,
        webgl: false,
        plugins: false,
      }),
    },
  })

  mainWindow.on('ready-to-show', () => {
    windowReadyTime = Date.now() - startTime

    logger.info('Main window ready to show', {
      windowReadyTime,
      databaseInitTime,
      performanceMonitor: !!process.env.PERFORMANCE_MONITOR,
    })

    // パフォーマンスモニター用ログ（従来の機能を維持）
    if (process.env.PERFORMANCE_MONITOR) {
      console.log(`⚡ ウィンドウ準備完了: ${windowReadyTime}ms`)
    }

    mainWindow.show()

    // 開発時のパフォーマンス情報表示（従来の機能を維持）
    if (is.dev) {
      console.log(`🚀 Electronウィンドウが ${windowReadyTime}ms で準備完了しました`)
      if (databaseInitTime !== null) {
        console.log(`🗄️ データベース初期化: ${databaseInitTime}ms`)
      }
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Content Security Policyの設定
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': is.dev
          ? ['default-src \'self\' \'unsafe-inline\' \'unsafe-eval\' http://localhost:* ws://localhost:*; img-src \'self\' data: http://localhost:*;']
          : ['default-src \'self\' \'unsafe-inline\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; script-src \'self\' \'unsafe-inline\' \'unsafe-eval\';'],
      },
    })
  })

  // 環境判定の詳細ログ
  const isDevelopment = is.dev || process.env.NODE_ENV === 'development'
  const isProduction = !isDevelopment || process.env.NODE_ENV === 'production'

  logger.debug('Environment detection', {
    isDev: is.dev,
    nodeEnv: process.env.NODE_ENV,
    isDevelopment,
    isProduction,
  })

  console.log(`🔍 環境判定: is.dev=${is.dev}, NODE_ENV=${process.env.NODE_ENV}`)
  console.log(`🔍 判定結果: isDevelopment=${isDevelopment}, isProduction=${isProduction}`)

  // パフォーマンス最適化: 並列でリソースをプリロード
  if (isDevelopment) {
    // Development: Connect to Nuxt dev server
    // Nuxtが使用可能なポートを動的に検出
    const devServerPort = process.env.NUXT_PORT || '3000'
    const devServerUrl = `http://localhost:${devServerPort}`

    logger.info('Connecting to Nuxt dev server', {
      devServerUrl,
      port: devServerPort,
    })

    console.log(`📱 開発モードでNuxtサーバーに接続: ${devServerUrl}`)
    mainWindow.loadURL(devServerUrl)

    // 開発時の追加最適化
    mainWindow.webContents.once('did-finish-load', () => {
      const loadTime = Date.now() - startTime

      logger.info('Development server loaded', {
        loadTime,
        url: devServerUrl,
      })

      console.log(`📱 開発サーバーのロード完了: ${loadTime}ms`)

      if (process.env.PERFORMANCE_MONITOR) {
        console.log('Nuxt ready')
      }
    })
  }
  else {
    // Production: Load built Nuxt files - 200.htmlを使用してSPAルーティングに対応
    const htmlPath = join(__dirname, '../../.output/public/200.html')
    const fileExists = fs.existsSync(htmlPath)

    logger.info('Loading production build', {
      htmlPath,
      fileExists,
    })

    console.log(`🔍 プロダクション用HTMLファイルパス: ${htmlPath}`)
    console.log(`📂 HTMLファイルの存在確認: ${fileExists}`)

    mainWindow.loadFile(htmlPath)

    // プロダクション時の最適化とデバッグログ
    mainWindow.webContents.once('did-finish-load', () => {
      const loadTime = Date.now() - startTime

      logger.info('Production build loaded', {
        loadTime,
        htmlPath,
      })

      console.log(`📦 プロダクションビルドのロード完了: ${loadTime}ms`)

      if (process.env.PERFORMANCE_MONITOR) {
        console.log('Nuxt ready')
      }
    })

    // エラーハンドリングを追加
    mainWindow.webContents.once('did-fail-load', (_, errorCode, errorDescription) => {
      logger.error('Page load failed', new Error(errorDescription), {
        errorCode,
        htmlPath,
      })
      console.error(`❌ ページの読み込みに失敗しました:`, errorCode, errorDescription)
    })

    // ページ読み込み開始時のログ
    mainWindow.webContents.once('did-start-loading', () => {
      logger.debug('Starting to load production HTML file', { htmlPath })
      console.log(`🚀 プロダクションHTMLファイルの読み込み開始`)
    })
  }
}

// パフォーマンス最適化: プロトコルハンドラーを早期に登録
if (!is.dev) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        allowServiceWorkers: true,
        supportFetchAPI: true,
      },
    },
  ])
}

/**
 * データベース初期化
 */
async function initializeDatabase(): Promise<void> {
  return withAsyncPerformance('database-initialization', async () => {
    const dbStartTime = Date.now()

    logger.info('Starting database initialization')

    try {
      const db = getDatabase()

      // 環境判定
      const isDevelopment = is.dev || process.env.NODE_ENV === 'development'
      const isTest = process.env.NODE_ENV === 'test'

      // データベース設定
      const dbConfig: Partial<DatabaseConfig> = {
        environment: isTest ? 'test' : isDevelopment ? 'development' : 'production',
        enableWAL: !isTest, // テスト時はWALモードを無効化
        enableForeignKeys: true,
        busyTimeout: 5000,
        cacheSize: isDevelopment ? -1000 : -2000, // 開発時1MB、本番時2MB
        enableSynchronous: isDevelopment ? 'OFF' : 'NORMAL',
        enableMigrations: true,
        maxConnections: isDevelopment ? 3 : 5,
        connectionTimeout: 30000,
        enableLogging: isDevelopment && process.env.DATABASE_DEBUG === 'true',
      }

      logger.info('Database initialization started', {
        environment: dbConfig.environment,
        config: {
          enableWAL: dbConfig.enableWAL,
          busyTimeout: dbConfig.busyTimeout,
          cacheSize: dbConfig.cacheSize,
        },
      })

      console.log(`🗄️ データベース初期化開始 (環境: ${dbConfig.environment})`)

      // データベース初期化とマイグレーション実行
      await db.initialize(dbConfig)

      // 接続テスト
      const isHealthy = await db.testConnection()
      if (!isHealthy) {
        const connectionError = new Error('データベース接続テストに失敗しました')
        logger.error('Database connection test failed', connectionError)
        throw connectionError
      }

      // ヘルスチェック（本番環境のみ）
      if (!isDevelopment) {
        const health = await db.healthCheck()
        if (!health.isHealthy) {
          logger.warn('Database health check detected issues', {
            issues: health.issues,
          })
          console.warn('⚠️ データベースヘルスチェックで問題が検出されました:', health.issues)
        }
      }

      databaseInitTime = Date.now() - dbStartTime

      logger.info('Database initialization completed successfully', {
        initTime: databaseInitTime,
        environment: dbConfig.environment,
      })

      console.log(`✅ データベース初期化完了: ${databaseInitTime}ms`)

      // パフォーマンス監視用ログ
      if (process.env.PERFORMANCE_MONITOR) {
        const status = db.getStatus()
        console.log('Database ready', {
          initTime: databaseInitTime,
          environment: status.environment,
          isHealthy: status.connectionInfo?.isConnected || false,
        })
      }
    }
    catch (error) {
      databaseInitTime = Date.now() - dbStartTime
      const errorMessage = error instanceof Error ? error.message : String(error)

      // 環境判定（エラーハンドリング用）
      const isDev = is.dev || process.env.NODE_ENV === 'development'

      logger.error('Database initialization failed', error as Error, {
        initTime: databaseInitTime,
        isDev,
        environment: process.env.NODE_ENV,
      })

      console.error(`❌ データベース初期化に失敗しました (${databaseInitTime}ms):`, errorMessage)

      // 開発時はエラーの詳細を表示
      if (isDev) {
        console.error('データベースエラーの詳細:', error)
      }

      // データベース初期化エラーは致命的なため、アプリケーションを終了
      // ただし、開発時は警告のみ表示してアプリケーションを継続
      if (!isDev) {
        logger.fatal('Database initialization failed in production - quitting app', error as Error)
        app.quit()
        return
      }
      else {
        logger.warn('Continuing despite database error in development environment')
        console.warn('⚠️ 開発環境のため、データベースエラーを無視してアプリケーションを継続します')
      }
    }
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // パフォーマンス測定
  const appReadyTime = Date.now() - startTime

  logger.info('Electron app ready', {
    appReadyTime,
    appVersion: app.getVersion(),
    userModelId: 'com.projectlens.desktop',
  })

  console.log(`⚡ Electronアプリ初期化完了: ${appReadyTime}ms`)

  // データベース初期化（並列実行）
  const databaseInitPromise = initializeDatabase()

  // Set app user model id for windows
  app.setAppUserModelId('com.projectlens.desktop')

  // パフォーマンス最適化: メモリ管理設定
  app.setAppUserModelId('com.projectlens.desktop')

  // メモリ最適化: 不要なプロセスを削減
  if (!is.dev) {
    app.setPath('crashDumps', join(app.getPath('temp'), 'crashes'))
  }

  // データベース初期化の完了を待つ
  try {
    await databaseInitPromise
    logger.debug('Database initialization promise resolved')
  }
  catch (error) {
    logger.error('Database initialization promise rejected', error as Error)
    console.error('データベース初期化エラー:', error)
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    if (is.dev) {
      // 開発時のみDevToolsを自動起動
      window.webContents.once('did-finish-load', () => {
        setTimeout(() => {
          try {
            window.webContents.openDevTools({ mode: 'detach' })
            logger.debug('DevTools opened in development mode')
            console.log('🔧 開発時DevToolsを開きました')
          }
          catch (error) {
            logger.warn('Failed to open DevTools (primary method)', { error })
            console.error('❌ DevToolsを開けませんでした:', error)
            // 代替方法でDevToolsを開く
            try {
              window.webContents.toggleDevTools()
              logger.debug('DevTools opened using alternative method')
              console.log('🔧 代替方法でDevToolsを開きました')
            }
            catch (altError) {
              logger.error('Failed to open DevTools (alternative method)', altError as Error)
              console.error('❌ 代替方法でもDevToolsを開けませんでした:', altError)
            }
          }
        }, 500) // 短縮してより早く開く
      })
    }

    // コンソールメッセージをElectronのメインプロセスに転送
    window.webContents.on('console-message', (_, level, message, line, sourceId) => {
      // レンダラープロセスのログレベルに応じてメインプロセスでログ出力
      const logData = {
        renderer: true,
        line,
        sourceId: sourceId || 'unknown',
      }

      switch (level) {
        case 0: // verbose
        case 1: // info
          debug(`[Renderer] ${message}`, logData)
          break
        case 2: // warning
          warn(`[Renderer] ${message}`, logData)
          break
        case 3: // error
          error(`[Renderer] ${message}`, new Error(message), logData)
          break
        default:
          info(`[Renderer] ${message}`, logData)
      }

      console.log(`🖥️  [Renderer Console] ${level}: ${message} (${sourceId}:${line})`)
    })

    // 開発時のキーボードショートカット設定
    if (is.dev) {
      window.webContents.on('before-input-event', (_, input) => {
        // F12でDevToolsの切り替え
        if (input.key === 'F12' && input.type === 'keyDown') {
          window.webContents.toggleDevTools()
        }
        // Ctrl+Shift+I (Windows/Linux) または Cmd+Opt+I (Mac) でDevToolsの切り替え
        if (input.key === 'I' && input.type === 'keyDown'
          && ((input.control && input.shift) || (input.meta && input.alt))) {
          window.webContents.toggleDevTools()
        }
      })
    }

    // 開発時のみデバッグ情報を表示
    if (is.dev) {
      // リソース読み込み状況をデバッグ
      window.webContents.on('did-finish-load', () => {
        console.log('🎯 ページの読み込みが完了しました')

        // JavaScriptエラーをキャッチ
        window.webContents.executeJavaScript(`
        window.addEventListener('error', (e) => {
          console.error('🚨 JS Error:', e.error, 'File:', e.filename, 'Line:', e.lineno);
        });
        window.addEventListener('unhandledrejection', (e) => {
          console.error('🚨 Unhandled Promise Rejection:', e.reason);
          // CSSエラーの場合は無視して続行
          if (e.reason && e.reason.toString().includes('CSS')) {
            console.log('📝 CSSエラーは無視して続行します');
            e.preventDefault();
          }
        });
        
        // DOM読み込み状況をチェック
        console.log('🔍 Document ready state:', document.readyState);
        console.log('🔍 Head scripts count:', document.head.querySelectorAll('script').length);
        console.log('🔍 Body content length:', document.body.innerHTML.length);
        
        // Nuxtの状態をチェック
        setTimeout(() => {
          console.log('🔍 Window.__NUXT__:', typeof window.__NUXT__, window.__NUXT__);
          console.log('🔍 Script tags:', Array.from(document.querySelectorAll('script')).map(s => s.src || 'inline'));
          console.log('🔍 Link tags:', Array.from(document.querySelectorAll('link')).map(l => l.href));
          
          // NuxtAppの初期化状況をチェック
          if (window.$nuxt) {
            console.log('🎯 Nuxt app instance found:', !!window.$nuxt);
          }
          if (window.useNuxtApp) {
            console.log('🎯 useNuxtApp available:', typeof window.useNuxtApp);
          }
        }, 1000);
        
        // さらに詳細な診断を3秒後と5秒後に実行
        setTimeout(() => {
          console.log('🔍 3s check - Vue app mounted:', !!document.querySelector('#__nuxt').innerHTML);
          console.log('🔍 3s check - DOM elements:', document.querySelector('#__nuxt').children.length);
        }, 3000);
        
        setTimeout(() => {
          console.log('🔍 5s check - Vue app mounted:', !!document.querySelector('#__nuxt').innerHTML);
          console.log('🔍 5s check - Final DOM:', document.querySelector('#__nuxt').innerHTML.substring(0, 100));
        }, 5000);
      `).catch(err => console.error('JavaScriptの実行に失敗:', err))
      })

      // リソース読み込みエラーをキャッチ
      window.webContents.on('did-fail-load', (_, errorCode, errorDescription, validatedURL, isMainFrame) => {
        logger.error('Resource load failed', new Error(errorDescription), {
          errorCode,
          validatedURL,
          isMainFrame,
        })
        console.error('📛 リソース読み込み失敗:', {
          errorCode,
          errorDescription,
          validatedURL,
          isMainFrame,
        })
      })

      // ネットワークリクエストのエラーのみをログに記録（成功は記録しない）
      window.webContents.session.webRequest.onErrorOccurred((details) => {
        logger.warn('Network request error', {
          url: details.url,
          error: details.error,
          method: details.method,
        })
        console.error('🚨 ネットワークエラー:', details.url, details.error)
      })

      window.webContents.session.webRequest.onCompleted((details) => {
        if (details.statusCode >= 400) {
          logger.warn('HTTP error response', {
            url: details.url,
            statusCode: details.statusCode,
            method: details.method,
          })
          console.error('🔥 HTTPエラー:', details.url, details.statusCode)
        }
      })
    }
  })

  createWindow()
  logger.info('Main window created and initialized')

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    logger.debug('App activated')
    if (BrowserWindow.getAllWindows().length === 0) {
      logger.info('No windows open - creating new window')
      createWindow()
    }
  })
})

// パフォーマンス最適化: ガベージコレクション最適化
app.on('window-all-closed', () => {
  logger.info('All windows closed', {
    platform: process.platform,
    willQuit: process.platform !== 'darwin',
  })

  // メモリクリーンアップ
  if (typeof global !== 'undefined' && global.gc) {
    global.gc()
    logger.debug('Garbage collection triggered')
  }

  if (process.platform !== 'darwin') {
    logger.info('Quitting application (non-macOS platform)')
    app.quit()
  }
})

// パフォーマンス最適化: メモリ圧迫時の対応
app.on('browser-window-blur', () => {
  // ウィンドウがフォーカスを失った時のメモリ最適化
  if (!is.dev && typeof global !== 'undefined' && global.gc) {
    setTimeout(() => {
      if (global.gc) {
        global.gc()
      }
    }, 5000)
  }
})

// 終了時のクリーンアップ
app.on('before-quit', async () => {
  const totalTime = Date.now() - startTime

  logger.info('Application before quit', {
    totalRuntime: totalTime,
    version: app.getVersion(),
  })

  console.log(`👋 アプリケーション終了 (実行時間: ${totalTime}ms)`)

  // データベース接続のクリーンアップ
  try {
    const db = getDatabase()
    await db.cleanup()
    logger.info('Database cleanup completed successfully')
    console.log('🗄️ データベース接続をクリーンアップしました')
  }
  catch (error) {
    logger.error('Database cleanup failed', error as Error)
    console.error('データベースクリーンアップエラー:', error)
  }

  // メモリクリーンアップ
  if (typeof global !== 'undefined' && global.gc) {
    global.gc()
    logger.debug('Final garbage collection triggered')
  }

  // ログシステムのクリーンアップ
  logger.info('Shutting down logger system')
  logger.destroy()
})

// アプリが完全に終了する直前のログ
app.on('will-quit', () => {
  info('Application will quit - final cleanup')
})

// パフォーマンス最適化: メモリ使用量監視（開発時のみ）
if (is.dev) {
  setInterval(() => {
    const memUsage = process.memoryUsage()
    console.log(`🧠 メモリ使用量: RSS=${Math.round(memUsage.rss / 1024 / 1024)}MB, Heap=${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`)

    // データベースのパフォーマンス統計も表示
    try {
      const db = getDatabase()
      const status = db.getStatus()
      if (status.isInitialized && status.performance) {
        console.log(`🗄️ DB統計: クエリ数=${status.performance.queryCount}, 平均時間=${status.performance.averageQueryTime.toFixed(2)}ms, 低速クエリ=${status.performance.slowQueryCount}`)
      }
    }
    catch {
      // データベースが初期化されていない場合は無視
    }
  }, 30000) // 30秒ごと
}

// 最終的なシグナルハンドリング（Graceful shutdown）
process.on('SIGINT', () => {
  logger.info('Received SIGINT signal - initiating graceful shutdown')
  app.quit()
})

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM signal - initiating graceful shutdown')
  app.quit()
})

// In this file you can include the rest of your app's main process code.
// You can also put them in separate files and require them here.
