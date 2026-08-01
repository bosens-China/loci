import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  CrawlProgress,
  CrawlProgressEvent,
  CrawlRunState,
  LociApi,
  DocumentRecord,
  DocumentSource
} from '../shared/api'

// Custom APIs for renderer
const api: LociApi = {
  listSources: () => ipcRenderer.invoke('sources:list') as Promise<DocumentSource[]>,
  createSource: (input) => ipcRenderer.invoke('sources:create', input) as Promise<DocumentSource>,
  updateSource: (id, input) =>
    ipcRenderer.invoke('sources:update', id, input) as Promise<DocumentSource>,
  crawlSource: (id) => ipcRenderer.invoke('sources:crawl', id) as Promise<CrawlProgress>,
  listCrawlRuns: () => ipcRenderer.invoke('sources:crawl-runs') as Promise<CrawlRunState[]>,
  onCrawlProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: CrawlProgressEvent): void =>
      listener(payload)
    ipcRenderer.on('sources:crawl-progress', handler)
    return () => ipcRenderer.removeListener('sources:crawl-progress', handler)
  },
  listDocuments: () => ipcRenderer.invoke('documents:list') as Promise<DocumentRecord[]>,
  searchDocuments: (query) =>
    ipcRenderer.invoke('documents:search', query) as Promise<DocumentRecord[]>,
  deleteSource: (id) => ipcRenderer.invoke('sources:delete', id) as Promise<void>,
  getSettings: () => ipcRenderer.invoke('settings:get') as ReturnType<LociApi['getSettings']>,
  saveSettings: (settings) =>
    ipcRenderer.invoke('settings:save', settings) as ReturnType<LociApi['saveSettings']>
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
