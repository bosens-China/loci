import { ElectronAPI } from '@electron-toolkit/preload'
import type { DocHubApi } from '../shared/api'

declare global {
  interface Window {
    electron: ElectronAPI
    api: DocHubApi
  }
}
