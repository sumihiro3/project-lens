# プロジェクト設定例

## package.json

```json
{
  "name": "project-lens",
  "version": "1.0.0",
  "description": "Backlogチケット管理ツールのデスクトップアプリケーション",
  "author": "ProjectLens Team",
  "license": "MIT",
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "nuxt dev --port 3000",
    "build": "nuxt build",
    "electron": "electron dist-electron/main.js",
    "electron:dev": "concurrently \"npm run dev\" \"wait-on http://localhost:3000 && electron dist-electron/main.js --inspect\"",
    "electron:build": "npm run build && electron-builder",
    "electron:dist": "npm run build && electron-builder --publish=never",
    "electron:pack": "npm run build && electron-builder --dir",
    "lint": "eslint . --ext .ts,.vue,.js",
    "lint:fix": "eslint . --ext .ts,.vue,.js --fix",
    "typecheck": "nuxt typecheck",
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest --coverage",
    "postinstall": "nuxt prepare && electron-builder install-app-deps"
  },
  "dependencies": {
    "@mastra/core": "^0.1.15",
    "@mastra/mcp": "^0.1.10",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@nuxtjs/i18n": "^8.8.0",
    "@nuxtjs/pug": "^3.0.0",
    "better-sqlite3": "^11.7.0",
    "drizzle-orm": "^0.36.4",
    "electron": "^33.2.1",
    "node-cron": "^3.0.3",
    "node-notifier": "^10.0.1",
    "nuxt": "^3.16.0",
    "pino": "^9.6.0",
    "pug": "^3.0.3",
    "vue": "^3.5.13",
    "vue-i18n": "^10.0.4",
    "vuetify": "^3.8.4"
  },
  "devDependencies": {
    "@nuxt/eslint": "^0.8.0",
    "@playwright/test": "^1.49.0",
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.10.2",
    "@types/node-cron": "^3.0.11",
    "@types/pug": "^2.0.10",
    "drizzle-kit": "^0.28.0",
    "electron-builder": "^25.1.8",
    "typescript": "^5.7.0",
    "vite-plugin-electron": "^0.28.8",
    "vue-tsc": "^2.1.10"
  },
  "build": {
    "appId": "com.projectlens.desktop",
    "productName": "ProjectLens",
    "directories": {
      "output": "dist-app"
    },
    "files": [
      "dist/**/*",
      "dist-electron/**/*",
      "node_modules/**/*",
      "package.json"
    ],
    "mac": {
      "icon": "build/icon.icns",
      "category": "public.app-category.productivity"
    },
    "win": {
      "icon": "build/icon.ico"
    },
    "linux": {
      "icon": "build/icon.png"
    }
  }
}
```

## nuxt.config.ts

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  // デスクトップアプリ用設定
  ssr: false,
  
  // 開発サーバー設定
  devServer: {
    port: 3000,
    host: 'localhost'
  },

  // モジュール
  modules: [
    '@nuxtjs/i18n',
    '@nuxtjs/pug',
    'nuxt-electron',
    '@pinia/nuxt'
  ],

  // Electron設定
  electron: {
    main: 'electron/main.ts',
    preload: 'electron/preload.ts',
    renderer: {},
    build: [
      {
        entry: 'electron/main.ts',
        onstart: (args) => {
          if (process.env.NODE_ENV === 'development') {
            console.log('Electron main process started')
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart: (args) => {
          if (process.env.NODE_ENV === 'development') {
            args.reload()
          }
        }
      }
    ]
  },

  // Pug設定
  pug: {
    compileDebug: process.env.NODE_ENV === 'development',
    pretty: process.env.NODE_ENV === 'development',
    globals: ['require'],
    extensions: ['.pug']
  },

  // Vite設定
  vite: {
    vue: {
      template: {
        preprocessors: {
          pug: 'pug'
        }
      }
    },
    define: {
      __VUE_I18N_FULL_INSTALL__: true,
      __VUE_I18N_LEGACY_API__: false,
      __INTLIFY_PROD_DEVTOOLS__: false
    }
  },

  // Vuetify設定
  css: [
    'vuetify/lib/styles/main.sass',
    '@mdi/font/css/materialdesignicons.min.css'
  ],

  build: {
    transpile: ['vuetify']
  },

  // 多言語化設定
  i18n: {
    locales: [
      {
        code: 'ja',
        file: 'ja/index.ts',
        name: '日本語'
      },
      {
        code: 'en',
        file: 'en/index.ts',
        name: 'English'
      }
    ],
    defaultLocale: 'ja',
    lazy: true,
    langDir: 'locales/',
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'i18n_redirected',
      redirectOn: 'root',
      alwaysRedirect: false,
      fallbackLocale: 'ja'
    },
    strategy: 'no_prefix'
  },

  // TypeScript設定
  typescript: {
    strict: true,
    typeCheck: true
  },

  // ランタイム設定
  runtimeConfig: {
    // プライベート環境変数（サーバーサイドのみ）
    private: {
      encryptionKey: process.env.ENCRYPTION_KEY,
      dbPath: process.env.DB_PATH || './data/projectlens.db'
    },
    // パブリック環境変数（クライアントサイドでも利用可能）
    public: {
      appVersion: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      logLevel: process.env.LOG_LEVEL || 'info'
    }
  },

  // アプリケーション設定
  app: {
    head: {
      title: 'ProjectLens',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Backlogチケット管理ツール' }
      ]
    }
  }
})
```

## tsconfig.json

```json
{
  "extends": "./.nuxt/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "paths": {
      "~/*": ["./src/*"],
      "@/*": ["./src/*"]
    }
  },
  "include": [
    "**/*.ts",
    "**/*.vue",
    "electron/**/*"
  ],
  "exclude": [
    "node_modules",
    "dist",
    "dist-electron",
    "dist-app"
  ]
}
```

## .eslintrc.js

```javascript
module.exports = {
  root: true,
  env: {
    node: true,
    browser: true,
    es2022: true
  },
  extends: [
    '@nuxt/eslint-config',
    'plugin:vue/vue3-recommended',
    '@vue/typescript/recommended'
  ],
  plugins: [
    'vue',
    '@typescript-eslint'
  ],
  rules: {
    // Vue.js固有のルール
    'vue/multi-word-component-names': 'off',
    'vue/no-multiple-template-root': 'off',
    'vue/html-self-closing': ['error', {
      'html': {
        'void': 'never',
        'normal': 'always',
        'component': 'always'
      },
      'svg': 'always',
      'math': 'always'
    }],

    // TypeScript関連
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',

    // 一般的なJavaScriptルール
    'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    'prefer-const': 'error',
    'no-var': 'error',

    // Pugテンプレート対応
    'vue/html-indent': 'off' // Pugテンプレートではインデントルールを無効化
  },
  overrides: [
    {
      files: ['electron/**/*'],
      env: {
        node: true,
        browser: false
      },
      rules: {
        'no-console': 'off'
      }
    },
    {
      files: ['**/*.test.ts', '**/*.spec.ts'],
      env: {
        vitest: true
      }
    }
  ]
}
```

## vite.config.ts

```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import electron from 'vite-plugin-electron'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag.startsWith('v-')
        }
      }
    }),
    vuetify({
      autoImport: true,
      theme: {
        defaultTheme: 'light'
      }
    }),
    electron([
      {
        entry: 'electron/main.ts',
        onstart: (args) => {
          if (process.env.NODE_ENV === 'development') {
            console.log('Electron main process started')
          }
        },
        vite: {
          build: {
            sourcemap: process.env.NODE_ENV === 'development',
            minify: process.env.NODE_ENV !== 'development',
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron']
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart: (args) => {
          if (process.env.NODE_ENV === 'development') {
            args.reload()
          }
        },
        vite: {
          build: {
            sourcemap: process.env.NODE_ENV === 'development',
            minify: process.env.NODE_ENV !== 'development',
            outDir: 'dist-electron'
          }
        }
      }
    ])
  ],
  resolve: {
    alias: {
      '~': resolve(__dirname, 'src'),
      '@': resolve(__dirname, 'src')
    }
  },
  build: {
    target: 'esnext',
    sourcemap: process.env.NODE_ENV === 'development'
  },
  optimizeDeps: {
    include: ['vuetify', '@mdi/font']
  }
})
```

## vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'happy-dom',
    coverage: {
      provider: 'c8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'dist-electron/',
        '**/*.d.ts',
        '**/*.test.{ts,js}',
        '**/*.spec.{ts,js}'
      ]
    }
  },
  resolve: {
    alias: {
      '~': resolve(__dirname, 'src'),
      '@': resolve(__dirname, 'src')
    }
  }
})
```

## playwright.config.ts

```typescript
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html'],
    ['json', { outputFile: 'playwright-report.json' }]
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] }
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] }
    }
  ],

  webServer: {
    command: 'npm run dev',
    port: 3000,
    reuseExistingServer: !process.env.CI
  }
})
```

## drizzle.config.ts

```typescript
import type { Config } from 'drizzle-kit'

export default {
  schema: './src/database/schema.ts',
  out: './src/database/migrations',
  driver: 'better-sqlite',
  dbCredentials: {
    url: process.env.DB_PATH || './data/projectlens.db'
  },
  verbose: true,
  strict: true
} satisfies Config
```

## プロジェクトディレクトリ構成

```
project-lens/
├── components/          # Vueコンポーネント (.vue with Pug template)
│   ├── Issue/
│   │   ├── IssueCard.vue      # Pugテンプレート使用
│   │   ├── IssueList.vue      # Pugテンプレート使用
│   │   └── IssueDetail.vue    # Pugテンプレート使用
│   ├── Settings/
│   │   ├── SettingsDialog.vue # Pugテンプレート使用
│   │   └── LanguageSelector.vue # Pugテンプレート使用
│   ├── AI/
│   │   └── AISummaryPanel.vue # Pugテンプレート使用
│   └── Common/
│       ├── MainWindow.vue     # Pugテンプレート使用
│       └── NotificationToast.vue # Pugテンプレート使用
├── pages/               # Nuxtページ (.vue with Pug template)
│   ├── index.vue           # メインダッシュボード (Pug)
│   └── settings.vue        # 設定ページ (Pug)
├── layouts/             # レイアウト (.vue with Pug template)
│   └── default.vue         # デフォルトレイアウト (Pug)
├── electron/
│   ├── main.ts             # Electronメインプロセス
│   └── preload.ts          # プリロードスクリプト
├── services/            # サービスクラス
│   ├── mcpManager.ts
│   ├── scoringEngine.ts
│   ├── notificationService.ts
│   ├── mastraAIService.ts
│   └── settingsService.ts
├── database/            # データベース関連
│   ├── schema.ts           # Drizzle ORMスキーマ
│   ├── migrations/         # マイグレーションファイル
│   └── connection.ts       # DB接続設定
├── types/               # TypeScript型定義
│   ├── issue.ts
│   ├── space.ts
│   ├── settings.ts
│   └── api.ts
├── locales/             # 多言語ファイル
│   ├── ja/
│   │   └── index.ts
│   └── en/
│       └── index.ts
├── composables/         # Nuxt composables
│   ├── useProjectLensI18n.ts
│   ├── useDateTime.ts
│   └── useNotifications.ts
├── plugins/             # Nuxtプラグイン
│   ├── vuetify.client.ts
│   └── i18n.client.ts
├── tests/               # テストファイル
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── build/               # ビルド用アセット
│   ├── icon.icns        # macOS用アイコン
│   ├── icon.ico         # Windows用アイコン
│   └── icon.png         # Linux用アイコン
├── data/                # ローカルデータ (gitignore)
│   └── projectlens.db   # SQLiteデータベース
├── nuxt.config.ts       # Pug設定含むNuxt設定
├── package.json         # 依存関係設定
├── tsconfig.json        # TypeScript設定
├── .eslintrc.js         # ESLint設定
├── vite.config.ts       # Vite設定
├── vitest.config.ts     # Vitest設定
├── playwright.config.ts # E2Eテスト設定
└── drizzle.config.ts    # Drizzle ORM設定
```

## 環境変数設定

### .env.example

```bash
# アプリケーション設定
NODE_ENV=development
LOG_LEVEL=info

# データベース設定
DB_PATH=./data/projectlens.db
ENCRYPTION_KEY=your-secret-encryption-key-here

# MCP設定
MCP_TIMEOUT=30000
MCP_RETRY_COUNT=3

# AI設定
OPENAI_API_KEY=your-openai-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key
GOOGLE_AI_API_KEY=your-google-ai-api-key

# 開発設定
VITE_DEV_TOOLS=true
ELECTRON_ENABLE_LOGGING=true
```

### .env.local (開発環境)

```bash
NODE_ENV=development
LOG_LEVEL=debug
DB_PATH=./data/dev-projectlens.db
VITE_DEV_TOOLS=true
ELECTRON_ENABLE_LOGGING=true
```

### .env.production

```bash
NODE_ENV=production
LOG_LEVEL=warn
DB_PATH=./data/projectlens.db
VITE_DEV_TOOLS=false
ELECTRON_ENABLE_LOGGING=false
```