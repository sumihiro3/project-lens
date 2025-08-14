import { app, BrowserWindow, shell, protocol } from 'electron'
import { join } from 'node:path'
import * as fs from 'node:fs'
import { is } from '@electron-toolkit/utils'
import { getDatabase, type DatabaseConfig } from './database/connection'

// パフォーマンス最適化: 起動時間測定
const startTime = Date.now()
let windowReadyTime: number | null = null
let databaseInitTime: number | null = null

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

    // パフォーマンスモニター用ログ
    if (process.env.PERFORMANCE_MONITOR) {
      console.log(`⚡ ウィンドウ準備完了: ${windowReadyTime}ms`)
    }

    mainWindow.show()

    // 開発時のパフォーマンス情報表示
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

  console.log(`🔍 環境判定: is.dev=${is.dev}, NODE_ENV=${process.env.NODE_ENV}`)
  console.log(`🔍 判定結果: isDevelopment=${isDevelopment}, isProduction=${isProduction}`)

  // パフォーマンス最適化: 並列でリソースをプリロード
  if (isDevelopment) {
    // Development: Connect to Nuxt dev server
    // Nuxtが使用可能なポートを動的に検出
    const devServerPort = process.env.NUXT_PORT || '3000'
    const devServerUrl = `http://localhost:${devServerPort}`
    console.log(`📱 開発モードでNuxtサーバーに接続: ${devServerUrl}`)
    mainWindow.loadURL(devServerUrl)

    // 開発時の追加最適化
    mainWindow.webContents.once('did-finish-load', () => {
      const loadTime = Date.now() - startTime
      console.log(`📱 開発サーバーのロード完了: ${loadTime}ms`)

      if (process.env.PERFORMANCE_MONITOR) {
        console.log('Nuxt ready')
      }
    })
  }
  else {
    // Production: Load built Nuxt files - 200.htmlを使用してSPAルーティングに対応
    const htmlPath = join(__dirname, '../../.output/public/200.html')
    console.log(`🔍 プロダクション用HTMLファイルパス: ${htmlPath}`)
    console.log(`📂 HTMLファイルの存在確認: ${fs.existsSync(htmlPath)}`)

    mainWindow.loadFile(htmlPath)

    // プロダクション時の最適化とデバッグログ
    mainWindow.webContents.once('did-finish-load', () => {
      const loadTime = Date.now() - startTime
      console.log(`📦 プロダクションビルドのロード完了: ${loadTime}ms`)

      if (process.env.PERFORMANCE_MONITOR) {
        console.log('Nuxt ready')
      }
    })

    // エラーハンドリングを追加
    mainWindow.webContents.once('did-fail-load', (_, errorCode, errorDescription) => {
      console.error(`❌ ページの読み込みに失敗しました:`, errorCode, errorDescription)
    })

    // ページ読み込み開始時のログ
    mainWindow.webContents.once('did-start-loading', () => {
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
  const dbStartTime = Date.now()

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

    console.log(`🗄️ データベース初期化開始 (環境: ${dbConfig.environment})`)

    // データベース初期化とマイグレーション実行
    await db.initialize(dbConfig)

    // 接続テスト
    const isHealthy = await db.testConnection()
    if (!isHealthy) {
      throw new Error('データベース接続テストに失敗しました')
    }

    // ヘルスチェック（本番環境のみ）
    if (!isDevelopment) {
      const health = await db.healthCheck()
      if (!health.isHealthy) {
        console.warn('⚠️ データベースヘルスチェックで問題が検出されました:', health.issues)
      }
    }

    databaseInitTime = Date.now() - dbStartTime
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

    console.error(`❌ データベース初期化に失敗しました (${databaseInitTime}ms):`, errorMessage)

    // 開発時はエラーの詳細を表示
    if (isDev) {
      console.error('データベースエラーの詳細:', error)
    }

    // データベース初期化エラーは致命的なため、アプリケーションを終了
    // ただし、開発時は警告のみ表示してアプリケーションを継続
    if (!isDev) {
      app.quit()
      return
    }
    else {
      console.warn('⚠️ 開発環境のため、データベースエラーを無視してアプリケーションを継続します')
    }
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // パフォーマンス測定
  const appReadyTime = Date.now() - startTime
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
  }
  catch (error) {
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
            console.log('🔧 開発時DevToolsを開きました')
          }
          catch (error) {
            console.error('❌ DevToolsを開けませんでした:', error)
            // 代替方法でDevToolsを開く
            try {
              window.webContents.toggleDevTools()
              console.log('🔧 代替方法でDevToolsを開きました')
            }
            catch (altError) {
              console.error('❌ 代替方法でもDevToolsを開けませんでした:', altError)
            }
          }
        }, 500) // 短縮してより早く開く
      })
    }

    // コンソールメッセージをElectronのメインプロセスに転送
    window.webContents.on('console-message', (_, level, message, line, sourceId) => {
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
        console.error('📛 リソース読み込み失敗:', {
          errorCode,
          errorDescription,
          validatedURL,
          isMainFrame,
        })
      })

      // ネットワークリクエストのエラーのみをログに記録（成功は記録しない）
      window.webContents.session.webRequest.onErrorOccurred((details) => {
        console.error('🚨 ネットワークエラー:', details.url, details.error)
      })

      window.webContents.session.webRequest.onCompleted((details) => {
        if (details.statusCode >= 400) {
          console.error('🔥 HTTPエラー:', details.url, details.statusCode)
        }
      })
    }
  })

  createWindow()

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// パフォーマンス最適化: ガベージコレクション最適化
app.on('window-all-closed', () => {
  // メモリクリーンアップ
  if (typeof global !== 'undefined' && global.gc) {
    global.gc()
  }

  if (process.platform !== 'darwin') {
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
  console.log(`👋 アプリケーション終了 (実行時間: ${totalTime}ms)`)

  // データベース接続のクリーンアップ
  try {
    const db = getDatabase()
    await db.cleanup()
    console.log('🗄️ データベース接続をクリーンアップしました')
  }
  catch (error) {
    console.error('データベースクリーンアップエラー:', error)
  }

  // メモリクリーンアップ
  if (typeof global !== 'undefined' && global.gc) {
    global.gc()
  }
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

// In this file you can include the rest of your app's main process code.
// You can also put them in separate files and require them here.
