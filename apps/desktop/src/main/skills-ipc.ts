import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import { SkillManager, type LociDatabase } from '@loci/runtime'
import type { SkillOperationInput } from '@loci/shared'
import { resolveDesktopSkillResourceDir } from './skill-resources'

interface SkillsIpcOptions {
  getDatabase: () => LociDatabase
  getDataDir: () => string
  getWindow: () => BrowserWindow | undefined
}

/** 桌面 IPC 只做参数转发，所有文件事务由 runtime 统一执行。 */
export function registerSkillsIpc(options: SkillsIpcOptions): void {
  const manager = (): SkillManager =>
    new SkillManager({
      database: options.getDatabase(),
      dataDir: options.getDataDir(),
      packageVersion: app.getVersion(),
      skillResourceDir: resolveDesktopSkillResourceDir(app.isPackaged, process.resourcesPath)
    })

  ipcMain.handle('skills:list', (_event, input?: SkillOperationInput) => manager().list(input))
  ipcMain.handle('skills:preview', (_event, input?: SkillOperationInput) =>
    manager().preview(input)
  )
  ipcMain.handle('skills:add', (_event, input?: SkillOperationInput) => manager().add(input))
  ipcMain.handle('skills:remove', (_event, input?: SkillOperationInput) => manager().remove(input))
  ipcMain.handle('skills:clear', (_event, input?: SkillOperationInput) => manager().clear(input))
  ipcMain.handle('skills:select-project', async () => {
    const window = options.getWindow()
    const selection = window
      ? await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return {
      canceled: selection.canceled,
      path: selection.canceled ? null : (selection.filePaths[0] ?? null)
    }
  })
}
