import { ElectronAPI } from '@electron-toolkit/preload'
import type { LociApi } from '../shared/api'

declare global {
  interface Window {
    electron: ElectronAPI
    api: LociApi
  }
}
