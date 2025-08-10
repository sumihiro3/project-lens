/**
 * ElectronAPIインターフェース
 * メインプロセスからレンダラープロセスに公開されるAPI
 */
export interface ElectronAPI {
  /** 実行プラットフォーム */
  platform: string
  /** 各種バージョン情報 */
  versions: {
    /** Node.jsバージョン */
    node: string
    /** Electronバージョン */
    electron: string
    /** Chromeバージョン */
    chrome: string
    /** V8エンジンバージョン */
    v8: string
  }
}

declare global {
  /**
   * WindowオブジェクトにElectron APIを追加
   */
  interface Window {
    /** ElectronAPI（主要） */
    electron: ElectronAPI
    /** ElectronAPI（別名） */
    api: ElectronAPI
  }
}
