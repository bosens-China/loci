import { ipcMain } from 'electron'
import type { CloudAdminLoginInput, CloudLibraryInput } from '@loci/shared'
import { CloudAdminClient } from '@loci/runtime'

/** 注册云端管理通道，并把敏感会话限制在主进程。 */
export function registerCloudAdminIpc(getServerUrl: () => string): void {
  const client = new CloudAdminClient()
  ipcMain.handle('cloud-admin:login', (_event, input: CloudAdminLoginInput) =>
    client.login(getServerUrl(), input)
  )
  ipcMain.handle('cloud-admin:logout', () => client.logout())
  ipcMain.handle('cloud-admin:session', () => client.getSession())
  ipcMain.handle('cloud-admin:libraries:list', () => client.listLibraries())
  ipcMain.handle('cloud-admin:libraries:create', (_event, input: CloudLibraryInput) =>
    client.createLibrary(input)
  )
  ipcMain.handle('cloud-admin:libraries:update', (_event, id: string, input: CloudLibraryInput) =>
    client.updateLibrary(id, input)
  )
  ipcMain.handle('cloud-admin:libraries:delete', (_event, id: string) => client.deleteLibrary(id))
  ipcMain.handle('cloud-admin:libraries:sync', (_event, id: string) => client.syncLibrary(id))
  ipcMain.handle('cloud-admin:jobs:get', (_event, id: string) => client.getSyncJob(id))
}
