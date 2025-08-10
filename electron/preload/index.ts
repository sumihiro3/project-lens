import { contextBridge } from 'electron'
// import { ipcRenderer } from 'electron' // 将来使用するためコメントアウト
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  // Example API methods for future use
  platform: process.platform,
  versions: process.versions,

  // Future IPC methods will be added here
  // For example:
  // openFile: () => ipcRenderer.invoke('open-file'),
  // saveFile: (data: any) => ipcRenderer.invoke('save-file', data),
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  }
  catch (error) {
    console.error(error)
  }
}
else {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).electron = electronAPI
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = api
}
