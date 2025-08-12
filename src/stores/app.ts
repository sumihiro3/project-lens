import { defineStore } from 'pinia'

/**
 * アプリケーション全体の状態管理用インターフェース
 * Piniaストアの状態定義
 */
interface AppState {
  /** アプリケーションのローディング状態 */
  loading: boolean
  /** アプリケーションのタイトル */
  title: string
}

export const useAppStore = defineStore('app', {
  state: (): AppState => ({
    loading: false,
    title: 'ProjectLens',
  }),

  getters: {
    isLoading: state => state.loading,
    appTitle: state => state.title,
  },

  actions: {
    setLoading(loading: boolean) {
      this.loading = loading
    },

    setTitle(title: string) {
      this.title = title
    },
  },
})
