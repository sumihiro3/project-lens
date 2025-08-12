/**
 * アプリケーション設定型
 */

import type { ThemeMode, Locale, KeyBinding } from './common'
import type { BacklogApiConfig } from './backlog'

// アプリケーション設定のメイン型
export interface AppSettings {
  version: string
  general: GeneralSettings
  backlog: BacklogSettings
  notifications: NotificationSettings
  ui: UISettings
  shortcuts: ShortcutSettings
  sync: SyncSettings
  privacy: PrivacySettings
  advanced: AdvancedSettings
}

// 一般設定
export interface GeneralSettings {
  language: Locale
  startupBehavior: 'show' | 'minimize' | 'hide'
  minimizeToTray: boolean
  closeToTray: boolean
  autoStart: boolean
  checkForUpdates: boolean
  betaUpdates: boolean
  crashReporting: boolean
  analyticsEnabled: boolean
}

// Backlog設定
export interface BacklogSettings {
  connections: BacklogConnectionSettings[]
  defaultConnection?: string
  syncInterval: number // minutes
  autoSync: boolean
  syncOnStartup: boolean
  maxSyncHistory: number // days
  offlineMode: boolean
  cacheSize: number // MB
}

export interface BacklogConnectionSettings extends BacklogApiConfig {
  id: string
  name: string
  isDefault: boolean
  syncEnabled: boolean
  syncProjects: number[] // 同期対象プロジェクトID
  lastSync?: string
  syncStatus: 'idle' | 'syncing' | 'error' | 'success'
}

// 通知設定
export interface NotificationSettings {
  enabled: boolean
  showInAppNotifications: boolean
  showSystemNotifications: boolean
  soundEnabled: boolean
  soundFile?: string
  issueAssigned: boolean
  issueUpdated: boolean
  issueCommented: boolean
  issueDueSoon: boolean
  dueSoonDays: number
  quietHours: {
    enabled: boolean
    startTime: string // HH:mm format
    endTime: string // HH:mm format
  }
  filters: NotificationFilter[]
}

export interface NotificationFilter {
  id: string
  name: string
  enabled: boolean
  conditions: {
    projects?: number[]
    issueTypes?: number[]
    priorities?: number[]
    assignees?: number[]
    keywords?: string[]
  }
  actions: {
    notify: boolean
    sound: boolean
    email: boolean
  }
}

// UI設定
export interface UISettings {
  theme: ThemeMode
  primaryColor: string
  fontSize: 'small' | 'medium' | 'large'
  compactMode: boolean
  showSidebar: boolean
  sidebarCollapsed: boolean
  showStatusBar: boolean
  showToolbar: boolean
  windowBounds: {
    width: number
    height: number
    x?: number
    y?: number
    maximized: boolean
  }
  listView: {
    itemsPerPage: number
    showAvatars: boolean
    showLabels: boolean
    showDates: boolean
    compactRows: boolean
  }
  boardView: {
    columnsPerRow: number
    cardSize: 'small' | 'medium' | 'large'
    showCardDetails: boolean
    groupBy: 'status' | 'assignee' | 'priority' | 'issueType'
  }
}

// ショートカット設定
export interface ShortcutSettings {
  globalShortcuts: KeyBinding[]
  applicationShortcuts: KeyBinding[]
  customShortcuts: KeyBinding[]
  enabled: boolean
}

// 同期設定
export interface SyncSettings {
  strategy: 'manual' | 'automatic' | 'realtime'
  interval: number // minutes for automatic
  batchSize: number
  retryAttempts: number
  retryDelay: number // seconds
  conflictResolution: 'local' | 'remote' | 'prompt'
  backgroundSync: boolean
  syncOnNetworkChange: boolean
}

// プライバシー設定
export interface PrivacySettings {
  dataCollection: boolean
  usageStatistics: boolean
  errorReporting: boolean
  cacheUserData: boolean
  clearCacheOnExit: boolean
  encryptLocalData: boolean
  autoLogout: boolean
  autoLogoutTime: number // minutes
}

// 高度な設定
export interface AdvancedSettings {
  developerMode: boolean
  debugLogging: boolean
  logLevel: 'error' | 'warn' | 'info' | 'debug'
  maxLogSize: number // MB
  experimentalFeatures: boolean
  customCSS?: string
  apiTimeout: number // seconds
  requestRetries: number
  networkOptimization: boolean
  memoryOptimization: boolean
  performanceMonitoring: boolean
}

// 設定のデフォルト値
export const defaultAppSettings: AppSettings = {
  version: '1.0.0',
  general: {
    language: 'ja',
    startupBehavior: 'show',
    minimizeToTray: true,
    closeToTray: false,
    autoStart: false,
    checkForUpdates: true,
    betaUpdates: false,
    crashReporting: true,
    analyticsEnabled: false,
  },
  backlog: {
    connections: [],
    syncInterval: 15,
    autoSync: true,
    syncOnStartup: true,
    maxSyncHistory: 30,
    offlineMode: false,
    cacheSize: 100,
  },
  notifications: {
    enabled: true,
    showInAppNotifications: true,
    showSystemNotifications: true,
    soundEnabled: true,
    issueAssigned: true,
    issueUpdated: true,
    issueCommented: true,
    issueDueSoon: true,
    dueSoonDays: 3,
    quietHours: {
      enabled: false,
      startTime: '22:00',
      endTime: '08:00',
    },
    filters: [],
  },
  ui: {
    theme: 'system',
    primaryColor: '#1976D2',
    fontSize: 'medium',
    compactMode: false,
    showSidebar: true,
    sidebarCollapsed: false,
    showStatusBar: true,
    showToolbar: true,
    windowBounds: {
      width: 1200,
      height: 800,
      maximized: false,
    },
    listView: {
      itemsPerPage: 50,
      showAvatars: true,
      showLabels: true,
      showDates: true,
      compactRows: false,
    },
    boardView: {
      columnsPerRow: 4,
      cardSize: 'medium',
      showCardDetails: true,
      groupBy: 'status',
    },
  },
  shortcuts: {
    globalShortcuts: [],
    applicationShortcuts: [],
    customShortcuts: [],
    enabled: true,
  },
  sync: {
    strategy: 'automatic',
    interval: 15,
    batchSize: 100,
    retryAttempts: 3,
    retryDelay: 5,
    conflictResolution: 'prompt',
    backgroundSync: true,
    syncOnNetworkChange: true,
  },
  privacy: {
    dataCollection: false,
    usageStatistics: false,
    errorReporting: true,
    cacheUserData: true,
    clearCacheOnExit: false,
    encryptLocalData: true,
    autoLogout: false,
    autoLogoutTime: 30,
  },
  advanced: {
    developerMode: false,
    debugLogging: false,
    logLevel: 'info',
    maxLogSize: 10,
    experimentalFeatures: false,
    apiTimeout: 30,
    requestRetries: 3,
    networkOptimization: true,
    memoryOptimization: true,
    performanceMonitoring: false,
  },
}
