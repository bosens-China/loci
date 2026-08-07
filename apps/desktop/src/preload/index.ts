import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  CrawlProgress,
  CrawlProgressEvent,
  CrawlRunState,
  LociApi,
  DocumentRecord,
  DocumentSource,
  CloudAdminSession,
  CloudLibrary,
  CloudSyncJob,
  CloudCatalogItem,
  CloudImportResult
} from '@loci/shared'

// Custom APIs for renderer
const api: LociApi = {
  listSources: () => ipcRenderer.invoke('sources:list') as Promise<DocumentSource[]>,
  createSource: (input) => ipcRenderer.invoke('sources:create', input) as Promise<DocumentSource>,
  updateSource: (id, input) =>
    ipcRenderer.invoke('sources:update', id, input) as Promise<DocumentSource>,
  crawlSource: (id) => ipcRenderer.invoke('sources:crawl', id) as Promise<CrawlProgress>,
  pauseCrawl: (id) => ipcRenderer.invoke('sources:crawl-pause', id) as Promise<void>,
  resumeCrawl: (id) => ipcRenderer.invoke('sources:crawl-resume', id) as Promise<void>,
  listCrawlRuns: () => ipcRenderer.invoke('sources:crawl-runs') as Promise<CrawlRunState[]>,
  onCrawlProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: CrawlProgressEvent): void =>
      listener(payload)
    ipcRenderer.on('sources:crawl-progress', handler)
    return () => ipcRenderer.removeListener('sources:crawl-progress', handler)
  },
  onExternalDataChange: (listener) => {
    const handler = (): void => listener()
    ipcRenderer.on('database:external-change', handler)
    return () => ipcRenderer.removeListener('database:external-change', handler)
  },
  listDocuments: () => ipcRenderer.invoke('documents:list') as Promise<DocumentRecord[]>,
  searchDocuments: (query) =>
    ipcRenderer.invoke('documents:search', query) as Promise<DocumentRecord[]>,
  clearDocuments: () => ipcRenderer.invoke('documents:clear') as Promise<number>,
  deleteSource: (id) => ipcRenderer.invoke('sources:delete', id) as Promise<void>,
  getSettings: () => ipcRenderer.invoke('settings:get') as ReturnType<LociApi['getSettings']>,
  saveSettings: (settings) =>
    ipcRenderer.invoke('settings:save', settings) as ReturnType<LociApi['saveSettings']>,
  getOpenAtLogin: () =>
    ipcRenderer.invoke('app:open-at-login:get') as ReturnType<LociApi['getOpenAtLogin']>,
  setOpenAtLogin: (enabled) =>
    ipcRenderer.invoke('app:open-at-login:set', enabled) as ReturnType<LociApi['setOpenAtLogin']>,
  getDesktopUpdate: () =>
    ipcRenderer.invoke('app:update:get') as ReturnType<LociApi['getDesktopUpdate']>,
  checkDesktopUpdate: () =>
    ipcRenderer.invoke('app:update:check') as ReturnType<LociApi['checkDesktopUpdate']>,
  openDesktopRelease: () =>
    ipcRenderer.invoke('app:update:open-release') as ReturnType<LociApi['openDesktopRelease']>,
  importAgentClient: (client) =>
    ipcRenderer.invoke('agents:import', client) as ReturnType<LociApi['importAgentClient']>,
  installAgentGlobalRules: (client) =>
    ipcRenderer.invoke('agents:global-rules:install', client) as ReturnType<
      LociApi['installAgentGlobalRules']
    >,
  exportData: () => ipcRenderer.invoke('data:export') as ReturnType<LociApi['exportData']>,
  importData: () => ipcRenderer.invoke('data:import') as ReturnType<LociApi['importData']>,
  cloudAdminLogin: (input) =>
    ipcRenderer.invoke('cloud-admin:login', input) as Promise<CloudAdminSession>,
  cloudAdminLogout: () => ipcRenderer.invoke('cloud-admin:logout') as Promise<void>,
  getCloudAdminSession: () =>
    ipcRenderer.invoke('cloud-admin:session') as Promise<CloudAdminSession | null>,
  listCloudLibraries: () =>
    ipcRenderer.invoke('cloud-admin:libraries:list') as Promise<CloudLibrary[]>,
  createCloudLibrary: (input) =>
    ipcRenderer.invoke('cloud-admin:libraries:create', input) as Promise<CloudLibrary>,
  updateCloudLibrary: (id, input) =>
    ipcRenderer.invoke('cloud-admin:libraries:update', id, input) as Promise<CloudLibrary>,
  deleteCloudLibrary: (id) =>
    ipcRenderer.invoke('cloud-admin:libraries:delete', id) as Promise<void>,
  syncCloudLibrary: (id) =>
    ipcRenderer.invoke('cloud-admin:libraries:sync', id) as Promise<CloudSyncJob>,
  syncCloudLibraries: (ids) =>
    ipcRenderer.invoke('cloud-admin:libraries:sync-many', ids) as Promise<CloudSyncJob[]>,
  listCloudSyncJobs: () => ipcRenderer.invoke('cloud-admin:jobs:list') as Promise<CloudSyncJob[]>,
  getCloudSyncJob: (id) => ipcRenderer.invoke('cloud-admin:jobs:get', id) as Promise<CloudSyncJob>,
  cancelCloudSyncJob: (id) =>
    ipcRenderer.invoke('cloud-admin:jobs:cancel', id) as Promise<CloudSyncJob>,
  listCloudCatalog: () => ipcRenderer.invoke('cloud-catalog:list') as Promise<CloudCatalogItem[]>,
  importCloudLibrary: (libraryId, autoSync) =>
    ipcRenderer.invoke('cloud-catalog:import', libraryId, autoSync) as Promise<CloudImportResult>,
  updateCloudLibraryCopy: (sourceId) =>
    ipcRenderer.invoke('cloud-catalog:update', sourceId) as Promise<CloudImportResult>,
  setCloudLibraryAutoSync: (sourceId, enabled) =>
    ipcRenderer.invoke('cloud-catalog:auto-sync', sourceId, enabled) as Promise<void>
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
