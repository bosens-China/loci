import { app, BrowserWindow, ipcMain, type Tray } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import dockIcon from '@resources/icon.png?asset'
import { Cron } from 'croner'
import {
  CloudLibraryService,
  acquireCrawlRuntimeLock,
  acquireMaintenanceRuntimeLock,
  createDatabase,
  createMcpRuntime,
  databaseNeedsMigration,
  importAgentClient,
  readRuntimeLock,
  resolveLociDataDir,
  resolvePreferredMcpConnection,
  type LociDatabase,
  type McpRuntime,
  type RuntimeLock
} from '@loci/runtime'
import type {
  AppSettings,
  CreateSourceInput,
  CrawlNode,
  CrawlProgress,
  CrawlRunState,
  DataTransferResult,
  DocumentSource,
  UpdateSourceInput
} from '@loci/shared'
import { normalizeCronSchedule } from '@loci/shared'
import { runSourceCrawl } from './crawl/source'
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
let appUpdater: AppUpdater | undefined
let dataDir = ''
const runningCrawls = new Set<string>()
const crawlStates = new Map<string, CrawlRunState>()
const scheduledCrawls = new Map<string, Cron>()
const isPrimaryInstance = registerSingleInstance(() => mainWindow)

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
      database = createDatabase(databasePath)
    } finally {
      migrationLock?.release()
    }
    cloudLibraryService = new CloudLibraryService(requireDatabase())
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
      assertMaintenanceIdle()
      if (isSourceCrawling(id)) throw new Error('更新进行中，暂时不能编辑文档源')
      const source = requireDatabase().updateSource(id, input)
      scheduleSource(source)
      return source
    })
    ipcMain.handle('sources:crawl', (_event, id: string) => crawlSource(id))
    ipcMain.handle('sources:crawl-runs', () => [...crawlStates.values()])
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
      const connection = await resolvePreferredMcpConnection(
        requireMcpRuntime().getState().mcp.endpoint
      )
      return importAgentClient(client, connection)
    })
    ipcMain.handle('data:export', () =>
      exportBackupFile(mainWindow, requireDatabase().exportBackup())
    )
    ipcMain.handle('data:import', () => importLocalData())
    registerCloudAdminIpc(() => requireDatabase().getSettings().serverUrl)
    stopCloudLibraryRuntime = registerCloudLibraryRuntime(
      requireDatabase(),
      requireCloudLibraryService()
    )
    appUpdater = createAppUpdater()
    ipcMain.handle('app:update:get', () => requireAppUpdater().getState())
    ipcMain.handle('app:update:check', () => requireAppUpdater().check())
    ipcMain.handle('app:update:open-release', () => requireAppUpdater().openRelease())

    restoreScheduledCrawls(requireDatabase().listSources())
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

function deleteSource(id: string): void {
  assertMaintenanceIdle()
  if (isSourceCrawling(id)) throw new Error('更新进行中，暂时不能删除文档源')
  crawlStates.delete(id)
  stopScheduledCrawl(id)
  requireDatabase().deleteSource(id)
}

function createMcpServices(): LociMcpServices {
  return {
    listSources: () => requireDatabase().listSources(),
    listDocuments: () => requireDatabase().listDocuments(),
    searchDocuments: (query) => requireDatabase().searchDocuments(query),
    createSource,
    crawlSource,
    deleteSource,
    isCrawling: isSourceCrawling,
    getCrawlState: (id) => crawlStates.get(id),
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
    crawlStates.clear()
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
  sources.forEach(scheduleSource)
}

function scheduleSource(source: DocumentSource): void {
  stopScheduledCrawl(source.id)
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
        if (!isSourceCrawling(source.id)) await crawlSource(source.id)
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

async function crawlSource(
  id: string,
  onProgress?: (progress: CrawlProgress) => void
): Promise<CrawlProgress> {
  if (isSourceCrawling(id)) throw new Error('这个文档源已经在更新中')
  const source = requireDatabase().getSourceConfig(id)
  const lock = acquireCrawlRuntimeLock(dataDir, id, '桌面端')
  const initialNode: CrawlNode = {
    id: source.firstUrl,
    url: source.firstUrl,
    title: source.fetchMode === 'auto' ? '正在检测抓取方式' : '正在读取第一个页面',
    status: 'running'
  }
  publishCrawlState({
    sourceId: id,
    progress: {
      queued: 1,
      processed: 0,
      succeeded: 0,
      failed: 0,
      limitReached: false,
      node: initialNode
    },
    nodes: [initialNode],
    error: null,
    running: true
  })
  const runId = requireDatabase().startCrawlRun(id)
  runningCrawls.add(id)
  try {
    const progress = await runSourceCrawl(requireDatabase(), id, (progress) => {
      emitCrawlProgress(id, progress)
      onProgress?.(progress)
    })
    if (progress.succeeded === 0 && progress.failed > 0) {
      throw new Error(`抓取失败：${progress.failed} 个页面均未成功`)
    }
    finishCrawl(id, progress, null)
    requireDatabase().finishCrawlRun(runId, 'completed', progress, null)
    return progress
  } catch (error) {
    const message = errorMessage(error)
    const progress = crawlStates.get(id)?.progress
    finishCrawl(id, progress, message)
    requireDatabase().finishCrawlRun(runId, 'failed', progress, message)
    throw error
  } finally {
    runningCrawls.delete(id)
    lock.release()
  }
}

function isSourceCrawling(sourceId: string): boolean {
  return runningCrawls.has(sourceId) || Boolean(readRuntimeLock(dataDir, `crawl-${sourceId}`))
}

function assertMaintenanceIdle(): void {
  const lock = readRuntimeLock(dataDir, 'maintenance')
  if (lock) throw new Error(`数据库正在由${lock.owner}维护，请稍后重试`)
}

function emitCrawlProgress(sourceId: string, progress: CrawlProgress): void {
  const current = crawlStates.get(sourceId)
  if (!current) return
  publishCrawlState({
    ...current,
    progress,
    nodes: mergeNode(current.nodes, progress.node)
  })
}

function finishCrawl(
  sourceId: string,
  progress: CrawlProgress | undefined,
  error: string | null
): void {
  const current = crawlStates.get(sourceId)
  if (!current) return
  publishCrawlState({
    ...current,
    progress: progress ? { ...progress, node: current.progress.node } : current.progress,
    error,
    running: false
  })
}

function publishCrawlState(state: CrawlRunState): void {
  crawlStates.set(state.sourceId, state)
  mainWindow?.webContents.send('sources:crawl-progress', {
    sourceId: state.sourceId,
    progress: state.progress,
    error: state.error,
    running: state.running
  })
}

function mergeNode(nodes: CrawlNode[], node: CrawlNode | undefined): CrawlNode[] {
  if (!node) return nodes
  const index = nodes.findIndex((item) => item.id === node.id)
  return index < 0
    ? [...nodes, node]
    : nodes.map((item, itemIndex) => (itemIndex === index ? node : item))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '更新失败'
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
