import { app, BrowserWindow, ipcMain, type Tray } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import dockIcon from '@resources/icon.png?asset'
import { Cron } from 'croner'
import {
  CloudLibraryService,
  acquireCrawlRuntimeLock,
  acquireMaintenanceRuntimeLock,
  acquireRuntimeLock,
  createDatabase,
  createMcpRuntime,
  databaseNeedsMigration,
  importAgentClient,
  installAgentGlobalRules,
  readRuntimeLock,
  resolveLociDataDir,
  createHttpMcpConnection,
  type LociDatabase,
  type McpRuntime,
  type RuntimeLock
} from '@loci/runtime'
import type {
  AppSettings,
  CreateSourceInput,
  DataTransferResult,
  DocumentSource,
  UpdateSourceInput
} from '@loci/shared'
import { DEVELOPMENT_SERVER_URL, normalizeCronSchedule } from '@loci/shared'
import { createDesktopCrawlRuntime } from './crawl/runtime'
import type { LociMcpServices } from '@loci/runtime'
import { registerSingleInstance } from './single-instance'
import { createAppTray } from './tray'
import { exportBackupFile, selectBackupFile } from './data-transfer'
import { createAppWindow } from './app-window'
import { getOpenAtLogin, setOpenAtLogin, shouldStartHidden } from './open-at-login'
import { registerCloudAdminIpc } from './cloud-admin-ipc'
import { registerCloudLibraryRuntime } from './cloud-library-runtime'
import { createAppUpdater, type AppUpdater } from './app-update'

let database: LociDatabase | undefined
let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
let mcpRuntime: McpRuntime | undefined
let cloudLibraryService: CloudLibraryService | undefined
let isQuitting = false
let stopCloudLibraryRuntime = (): void => undefined
let scheduleRuntimeLock: RuntimeLock | undefined
let appUpdater: AppUpdater | undefined
let dataDir = ''
const scheduledCrawls = new Map<string, Cron>()
const isPrimaryInstance = registerSingleInstance(() => mainWindow)
const crawlRuntime = createDesktopCrawlRuntime({
  getDatabase: requireDatabase,
  getDataDir: () => dataDir,
  publishState: (state) => {
    mainWindow?.webContents.send('sources:crawl-progress', {
      sourceId: state.sourceId,
      progress: state.progress,
      error: state.error,
      running: state.running,
      paused: state.paused
    })
  }
})

app.setName('Loci')

function createWindow(showOnReady = true): void {
  mainWindow = createAppWindow(() => isQuitting, showOnReady)
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
if (isPrimaryInstance)
  app.whenReady().then(async () => {
    dataDir = resolveLociDataDir()
    if (process.platform === 'darwin') app.dock?.setIcon(dockIcon)
    const databasePath = join(dataDir, 'loci.sqlite')
    const migrationLock = databaseNeedsMigration(databasePath)
      ? acquireMigrationLock('桌面端')
      : undefined
    try {
      const serverUrl = process.env.LOCI_SERVER_URL?.trim()
      database = createDatabase(
        databasePath,
        serverUrl
          ? { serverUrl, overrideServerUrl: true }
          : app.isPackaged
            ? {}
            : { serverUrl: DEVELOPMENT_SERVER_URL }
      )
    } finally {
      migrationLock?.release()
    }
    cloudLibraryService = new CloudLibraryService(requireDatabase(), fetch, dataDir)
    mcpRuntime = createMcpRuntime(requireDatabase(), createMcpServices())
    await mcpRuntime.start()
    tray = createAppTray(
      () => mainWindow?.show(),
      () => {
        isQuitting = true
        app.quit()
      }
    )

    // Set app user model id for windows
    electronApp.setAppUserModelId('com.loci.app')

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    ipcMain.handle('sources:list', () => requireDatabase().listSources())
    ipcMain.handle('sources:create', (_event, input: CreateSourceInput) => createSource(input))
    ipcMain.handle('sources:update', (_event, id: string, input: UpdateSourceInput) => {
      const source = mutateSource(id, '桌面端编辑文档源', () =>
        requireDatabase().updateSource(id, input)
      )
      scheduleSource(source)
      return source
    })
    ipcMain.handle('sources:crawl', (_event, id: string) => crawlRuntime.crawlSource(id))
    ipcMain.handle('sources:crawl-pause', (_event, id: string) => crawlRuntime.setPaused(id, true))
    ipcMain.handle('sources:crawl-resume', (_event, id: string) =>
      crawlRuntime.setPaused(id, false)
    )
    ipcMain.handle('sources:crawl-runs', () => crawlRuntime.listStates())
    ipcMain.handle('documents:list', () => requireDatabase().listDocuments())
    ipcMain.handle('documents:search', (_event, query: string) =>
      requireDatabase().searchDocuments(query)
    )
    ipcMain.handle('documents:clear', () => {
      const lock = acquireMaintenanceRuntimeLock(dataDir, '桌面端数据清理')
      try {
        return requireDatabase().clearDocuments()
      } finally {
        lock.release()
      }
    })
    ipcMain.handle('sources:delete', (_event, id: string) => deleteSource(id))
    ipcMain.handle('settings:get', () => requireMcpRuntime().getState())
    ipcMain.handle('settings:save', (_event, settings: AppSettings) =>
      requireMcpRuntime().save(settings)
    )
    ipcMain.handle('app:open-at-login:get', getOpenAtLogin)
    ipcMain.handle('app:open-at-login:set', (_event, enabled: unknown) => {
      if (typeof enabled !== 'boolean') throw new Error('开机自启设置无效')
      return setOpenAtLogin(enabled)
    })
    ipcMain.handle('agents:import', async (_event, client: unknown) => {
      const connection = createHttpMcpConnection(requireMcpRuntime().getState().mcp.endpoint)
      return importAgentClient(client, connection)
    })
    ipcMain.handle('agents:global-rules:install', (_event, client: unknown) =>
      installAgentGlobalRules(client, {
        dataDir,
        owner: '桌面端 Agent 全局规则写入'
      })
    )
    ipcMain.handle('data:export', () =>
      exportBackupFile(mainWindow, requireDatabase().exportBackup())
    )
    ipcMain.handle('data:import', () => importLocalData())
    registerCloudAdminIpc(() => requireDatabase().getSettings().serverUrl)
    try {
      scheduleRuntimeLock = acquireRuntimeLock(dataDir, 'schedule', '桌面端计划运行器')
      stopCloudLibraryRuntime = registerCloudLibraryRuntime(
        requireDatabase(),
        requireCloudLibraryService()
      )
    } catch (error) {
      console.warn('计划任务已由其他 Loci 进程运行，桌面端跳过计划恢复', error)
    }
    appUpdater = createAppUpdater()
    ipcMain.handle('app:update:get', () => requireAppUpdater().getState())
    ipcMain.handle('app:update:check', () => requireAppUpdater().check())
    ipcMain.handle('app:update:open-release', () => requireAppUpdater().openRelease())

    if (scheduleRuntimeLock) restoreScheduledCrawls(requireDatabase().listSources())
    createWindow(!shouldStartHidden())
    if (app.isPackaged) void requireAppUpdater().check(false)
    mainWindow?.on('focus', () => mainWindow?.webContents.send('database:external-change'))

    app.on('activate', function () {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else mainWindow?.show()
    })
  })

app.on('before-quit', () => {
  isQuitting = true
  stopScheduledCrawls()
  stopCloudLibraryRuntime()
  scheduleRuntimeLock?.release()
  void mcpRuntime?.close()
  database?.close()
  tray?.destroy()
})

function requireDatabase(): LociDatabase {
  if (!database) throw new Error('本地数据库尚未初始化')
  return database
}

function acquireMigrationLock(owner: string): RuntimeLock {
  return acquireMaintenanceRuntimeLock(dataDir, `${owner}数据库迁移`)
}

function createSource(input: CreateSourceInput): DocumentSource {
  assertMaintenanceIdle()
  const source = requireDatabase().createSource(input)
  scheduleSource(source)
  return source
}

function mutateSource<T>(id: string, owner: string, action: () => T): T {
  const lock = acquireCrawlRuntimeLock(dataDir, id, owner)
  try {
    return action()
  } finally {
    lock.release()
  }
}

async function deleteSource(id: string): Promise<void> {
  assertMaintenanceIdle()
  if (crawlRuntime.isCrawling(id)) {
    await crawlRuntime.cancelPaused(id)
    assertMaintenanceIdle()
  }
  mutateSource(id, '桌面端删除文档源', () => {
    crawlRuntime.deleteState(id)
    stopScheduledCrawl(id)
    requireDatabase().deleteSource(id)
  })
}

function createMcpServices(): LociMcpServices {
  return {
    listSources: () => requireDatabase().listSources(),
    listDocuments: () => requireDatabase().listDocuments(),
    searchDocuments: (query) => requireDatabase().searchDocuments(query),
    createSource,
    crawlSource: crawlRuntime.crawlSource,
    deleteSource,
    isCrawling: crawlRuntime.isCrawling,
    getCrawlState: crawlRuntime.getState,
    listCloudLibraries: () =>
      requireCloudLibraryService().listCatalog(requireDatabase().getSettings().serverUrl),
    pullCloudLibrary: (libraryId) => {
      assertMaintenanceIdle()
      return requireCloudLibraryService().importLibrary(
        requireDatabase().getSettings().serverUrl,
        libraryId,
        false
      )
    }
  }
}

function requireCloudLibraryService(): CloudLibraryService {
  if (!cloudLibraryService) throw new Error('云端文档服务尚未初始化')
  return cloudLibraryService
}

function requireMcpRuntime(): McpRuntime {
  if (!mcpRuntime) throw new Error('MCP 服务尚未初始化')
  return mcpRuntime
}

function requireAppUpdater(): AppUpdater {
  if (!appUpdater) throw new Error('应用更新检查尚未初始化')
  return appUpdater
}

async function importLocalData(): Promise<DataTransferResult> {
  const selected = await selectBackupFile(mainWindow)
  if (selected.canceled) return { canceled: true, message: '' }

  const currentDatabase = requireDatabase()
  const lock = acquireMaintenanceRuntimeLock(dataDir, '桌面端数据导入')
  stopScheduledCrawls()
  try {
    const summary = currentDatabase.importBackup(selected.data)
    crawlRuntime.clearStates()
    let mcpWarning = false
    try {
      await mcpRuntime?.close()
    } catch (error) {
      mcpWarning = true
      console.error('导入后关闭旧 MCP 服务失败', error)
    }
    mcpRuntime = createMcpRuntime(currentDatabase, createMcpServices())
    await mcpRuntime.start()
    mcpWarning ||= Boolean(mcpRuntime.getState().mcp.error)
    return {
      canceled: false,
      message: `已从 ${selected.filename} 导入 ${summary.sources} 个文档源和 ${summary.documents} 篇文档${mcpWarning ? '；MCP 服务需要重启应用后恢复' : ''}`
    }
  } finally {
    restoreScheduledCrawls(currentDatabase.listSources())
    lock.release()
  }
}

function restoreScheduledCrawls(sources: DocumentSource[]): void {
  stopScheduledCrawls()
  if (!scheduleRuntimeLock) return
  sources.forEach(scheduleSource)
}

function scheduleSource(source: DocumentSource): void {
  stopScheduledCrawl(source.id)
  if (!scheduleRuntimeLock) return
  const expression = source.schedule
  if (!expression) return
  try {
    const job = new Cron(
      normalizeCronSchedule(expression) ?? expression,
      {
        protect: true,
        catch: (error) => console.error(`定时抓取 ${source.name} 失败`, error)
      },
      async () => {
        if (!crawlRuntime.isCrawling(source.id)) await crawlRuntime.crawlSource(source.id)
      }
    )
    scheduledCrawls.set(source.id, job)
  } catch (error) {
    console.error(`忽略无效的定时抓取规则：${source.name}`, error)
  }
}

function stopScheduledCrawl(sourceId: string): void {
  scheduledCrawls.get(sourceId)?.stop()
  scheduledCrawls.delete(sourceId)
}

function stopScheduledCrawls(): void {
  for (const sourceId of scheduledCrawls.keys()) stopScheduledCrawl(sourceId)
}

function assertMaintenanceIdle(): void {
  const lock = readRuntimeLock(dataDir, 'maintenance')
  if (lock) throw new Error(`数据库正在由${lock.owner}维护，请稍后重试`)
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
