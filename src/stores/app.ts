import { defineStore } from 'pinia'

interface AppState {
  loading: boolean
  title: string
}

export const useAppStore = defineStore('app', {
  state: (): AppState => ({
    loading: false,
    title: 'ProjectLens'
  }),

  getters: {
    isLoading: (state) => state.loading,
    appTitle: (state) => state.title
  },

  actions: {
    setLoading(loading: boolean) {
      this.loading = loading
    },

    setTitle(title: string) {
      this.title = title
    }
  }
})