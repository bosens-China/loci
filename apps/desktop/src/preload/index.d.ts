import { ElectronAPI } from '@electron-toolkit/preload'
import type { LociApi } from '@loci/shared'

declare global {
  interface Window {
    electron: ElectronAPI
    api: LociApi
  }
}
