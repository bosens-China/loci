import { ipcMain } from 'electron'
import { CloudLibraryService, type LociDatabase } from '@loci/runtime'

const DAY_MS = 24 * 60 * 60 * 1000

/** 注册公开云文档 IPC，并在启动时及每天更新当前后端的同源副本。 */
export function registerCloudLibraryRuntime(
  database: LociDatabase,
  service = new CloudLibraryService(database)
): () => void {
  const serverUrl = (): string => database.getSettings().serverUrl

  ipcMain.handle('cloud-catalog:list', () => service.listCatalog(serverUrl()))
  ipcMain.handle('cloud-catalog:import', (_event, libraryId: unknown, autoSync: unknown) =>
    service.importLibrary(serverUrl(), requireId(libraryId), requireBoolean(autoSync))
  )
  ipcMain.handle('cloud-catalog:update', (_event, sourceId: unknown) =>
    service.updateLibrary(requireId(sourceId), serverUrl())
  )
  ipcMain.handle('cloud-catalog:auto-sync', (_event, sourceId: unknown, enabled: unknown) =>
    service.setAutoSync(requireId(sourceId), serverUrl(), requireBoolean(enabled))
  )

  void service.syncEligible(serverUrl())
  const timer = setInterval(() => void service.syncEligible(serverUrl()), DAY_MS)
  timer.unref()
  return () => clearInterval(timer)
}

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('文档库 ID 无效')
  return value
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('自动同步设置无效')
  return value
}
