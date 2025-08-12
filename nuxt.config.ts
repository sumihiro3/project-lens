// https://nuxt.com/docs/api/configuration/nuxt-config
import { defineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({

  // Modules
  modules: [
    ['@nuxtjs/i18n', {
      defaultLocale: 'ja',
      strategy: 'no_prefix',
      locales: ['ja', 'en'],
    }],
    ['@nuxt/eslint', {
      config: {
        stylistic: true,
      },
    }],
    ['@pinia/nuxt', {
      storesDirs: ['./stores/**'],
    }],
    // @vueuse/nuxtを一時的に無効化してビルドエラーを回避
    // '@vueuse/nuxt',
  ],

  // パフォーマンス最適化: ルーティング設定

  // パフォーマンス最適化: プラグイン設定
  plugins: [
    // 産産環境でのVue DevTools無効化
    ...(process.env.NODE_ENV === 'production' ? [] : []),
  ],
  devtools: { enabled: process.env.NODE_ENV !== 'production' },

  // Electron optimization
  app: {
    baseURL: process.env.NODE_ENV === 'production' ? './' : '/',
    buildAssetsDir: process.env.NODE_ENV === 'production' ? '_nuxt/' : '/_nuxt/',
    // パフォーマンス最適化: ヘッド設定
    head: {
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'format-detection', content: 'telephone=no' },
      ],
    },
  },

  // SPA mode for Electron
  ssr: false,
  spaLoadingTemplate: false,
  
  // Router configuration for Electron file:// protocol
  router: {
    options: {
      strict: false,
      hashMode: process.env.NODE_ENV === 'production',
    },
  },

  // CSS framework
  css: [
    'vuetify/lib/styles/main.sass',
  ],

  // パフォーマンス最適化: ランタイム設定
  runtimeConfig: {
    public: {
      // 産産環境でのパフォーマンス最適化フラグ
      optimizePerformance: process.env.NODE_ENV === 'production',
      enableDevtools: process.env.NODE_ENV !== 'production',
    },
  },
  srcDir: 'src/',

  // Build configuration
  build: {
    transpile: ['vuetify'],
  },

  // 開発サーバーの設定
  devServer: {
    port: 3000,
    host: '0.0.0.0',
  },

  // パフォーマンス最適化: 実験的機能
  experimental: {
    payloadExtraction: process.env.NODE_ENV === 'production', // 開発時はpayload抽出を無効化
    writeEarlyHints: false,
    viewTransition: false,
    // メモリ最適化
    asyncEntry: true,
    treeshakeClientOnly: true,
  },

  nitro: {
    preset: 'static',
    experimental: {
      wasm: true,
    },
    // パフォーマンス最適化: 静的生成設定
    minify: process.env.NODE_ENV === 'production',
    compressPublicAssets: {
      gzip: true,
      brotli: true,
    },
    // CSSファイルの出力設定
    rollupConfig: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return '_nuxt/[name]-[hash][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
    // Electronでの静的ルーティング設定  
    prerender: {
      routes: ['/'],
      crawlLinks: false,
    },
  },

  // Vite configuration
  vite: {
    base: process.env.NODE_ENV === 'production' ? './' : '/',
    define: {
      'process.env.DEBUG': false,
      '__VUE_PROD_DEVTOOLS__': false,
      '__VUE_OPTIONS_API__': true,
      '__VUE_PROD_HYDRATION_MISMATCH_DETAILS__': false,
    },
    ssr: {
      noExternal: ['vuetify'],
    },
    build: {
      // パフォーマンス最適化: ビルド設定
      minify: process.env.NODE_ENV === 'production' ? 'terser' : false,
      sourcemap: process.env.NODE_ENV !== 'production',
      target: 'esnext',
      cssCodeSplit: true,
      assetsInlineLimit: 4096,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 500,
      rollupOptions: {
        external: [],
        output: {
          // 静的アセットの相対パスを設定（CSSファイルを_nuxtディレクトリに配置）
          assetFileNames: (assetInfo) => {
            const extType = assetInfo.name?.split('.').pop();
            if (/css/i.test(extType || '')) {
              return '_nuxt/[name]-[hash][extname]'; // CSSファイルを_nuxtに配置
            }
            if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(extType || '')) {
              return 'assets/images/[name]-[hash][extname]';
            }
            if (/woff|woff2|eot|ttf|otf/i.test(extType || '')) {
              return 'assets/fonts/[name]-[hash][extname]';
            }
            return 'assets/[name]-[hash][extname]';
          },
          manualChunks: {
            'vue-vendor': ['vue', '@vue/runtime-core'],
            'vuetify-vendor': ['vuetify'],
            'utils': ['@vueuse/core'],
          },
        },
      },
      // パフォーマンス最適化: Terser設定
      terserOptions: {
        compress: {
          drop_console: process.env.NODE_ENV === 'production',
          drop_debugger: true,
          pure_funcs: process.env.NODE_ENV === 'production' ? ['console.log', 'console.info'] : [],
        },
        mangle: {
          safari10: true,
        },
        format: {
          safari10: true,
        },
      },
    },
    server: {
      // Electron開発時の最適化
      hmr: {
        port: 3002,
        overlay: true,
        clientPort: 3002,
      },
      // ホットリロードの監視設定
      watch: {
        usePolling: false,
        ignored: ['**/node_modules/**', '**/dist/**', '**/dist-electron/**', '**/.nuxt/**'],
      },
    },
    vue: {
      template: {
        preprocessOptions: {
          pug: {
            // 開発時はキャッシュを無効化
            cache: process.env.NODE_ENV === 'production',
            // デバッグモードでより良いエラーメッセージ
            compileDebug: process.env.NODE_ENV !== 'production',
            pretty: process.env.NODE_ENV !== 'production',
            // Pugファイルのホットリロード対応
            globals: ['require'],
            self: true,
          },
        },
      },
    },
    // 開発時の追加最適化
    optimizeDeps: {
      include: ['vuetify', '@vueuse/core'],
      exclude: ['electron', '@mdi/font'],
      force: false, // 開発時のキャッシュを使用
    },
    // パフォーマンス最適化: CSS設定
    css: {
      preprocessorOptions: {
        scss: {
          charset: false,
        },
      },
      postcss: {
        plugins: [
          ...(process.env.NODE_ENV === 'production'
            ? [
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                require('autoprefixer'),
                // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
                require('cssnano')({
                  preset: 'default',
                }),
              ]
            : []),
        ],
      },
    },
  },

  // パフォーマンス最適化: Webpack設定（フォールバック）
  webpack: {
    optimization: {
      splitChunks: {
        chunks: 'all',
        minSize: 20000,
        maxSize: 200000,
        cacheGroups: {
          default: {
            minChunks: 2,
            priority: -20,
            reuseExistingChunk: true,
          },
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            chunks: 'all',
            priority: -10,
            maxSize: 200000,
          },
          vuetify: {
            test: /[\\/]node_modules[\\/]vuetify[\\/]/,
            name: 'vuetify',
            chunks: 'all',
            priority: 0,
          },
        },
      },
    },
  },

  // TypeScript configuration
  typescript: {
    strict: true,
    typeCheck: process.env.NODE_ENV === 'production', // 開発時はタイプチェックを無効化して高速化
    // パフォーマンス最適化: TypeScriptコンパイラー設定
    tsConfig: {
      compilerOptions: {
        target: 'esnext',
        module: 'esnext',
        lib: ['esnext', 'dom', 'dom.iterable'],
        skipLibCheck: true,
        allowSyntheticDefaultImports: true,
        forceConsistentCasingInFileNames: true,
        incremental: true,
        tsBuildInfoFile: '.nuxt/.tsbuildinfo',
      },
    },
  },

  // パフォーマンス最適化: フック設定
  hooks: {
    'build:before': () => {
      console.log('🚀 パフォーマンス最適化されたビルドを開始します...')
    },
    'build:done': () => {
      if (process.env.NODE_ENV === 'production') {
        console.log('✅ プロダクションビルド完了 (パフォーマンス最適化済み)')
      }
    },
    'ready': () => {
      if (process.env.NODE_ENV === 'development') {
        console.log('🎉 開発サーバーが準備完了しました (パフォーマンス最適化済み)')
      }
    },
  },

})
