export interface ElectronAPI {
  platform: string
  versions: {
    node: string
    electron: string
    chrome: string
    v8: string
  }
}

declare global {
  interface Window {
    electron: any
    api: ElectronAPI
  }
}