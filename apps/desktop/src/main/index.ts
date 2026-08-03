import { app, BrowserWindow, ipcMain, type Tray } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { Cron } from 'croner'
import { createDatabase, type LociDatabase } from './database'
import type {
  AppSettings,
  CreateSourceInput,
  CrawlNode,
  CrawlProgress,
  CrawlRunState,
  DataTransferResult,
  DocumentSource,
  UpdateSourceInput
} from '../shared/api'
import { normalizeCronSchedule } from '../shared/schedule'
import { runSourceCrawl } from './crawl/source'
import type { LociMcpServices } from './mcp/server'
import { createMcpRuntime, type McpRuntime } from './mcp/runtime'
import { importAgentClient } from './agent-import'
import { registerSingleInstance } from './single-instance'
import { createAppTray } from './tray'
import { exportBackupFile, selectBackupFile } from './data-transfer'
import { createAppWindow } from './app-window'
import { getOpenAtLogin, setOpenAtLogin, shouldStartHidden } from './open-at-login'
import { registerCloudAdminIpc } from './cloud-admin-ipc'
import { registerCloudLibraryRuntime } from './cloud-library-runtime'

let database: LociDatabase | undefined
let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
let mcpRuntime: McpRuntime | undefined
let isQuitting = false
let stopCloudLibraryRuntime = (): void => undefined
const runningCrawls = new Set<string>()
const crawlStates = new Map<string, CrawlRunState>()
const scheduledCrawls = new Map<string, Cron>()
const isPrimaryInstance = registerSingleInstance(() => mainWindow)

function createWindow(showOnReady = true): void {
  mainWindow = createAppWindow(() => isQuitting, showOnReady)
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
if (isPrimaryInstance)
  app.whenReady().then(async () => {
    database = createDatabase(join(app.getPath('userData'), 'loci.sqlite'))
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
      if (runningCrawls.has(id)) throw new Error('更新进行中，暂时不能编辑文档源')
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
      if (runningCrawls.size > 0) throw new Error('文档正在更新，请等待更新完成后再清空')
      return requireDatabase().clearDocuments()
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
    ipcMain.handle('agents:import', (_event, client: unknown) =>
      importAgentClient(client, requireMcpRuntime().getState().mcp.endpoint)
    )
    ipcMain.handle('data:export', () =>
      exportBackupFile(mainWindow, requireDatabase().exportBackup())
    )
    ipcMain.handle('data:import', () => importLocalData())
    registerCloudAdminIpc(() => requireDatabase().getSettings().serverUrl)
    stopCloudLibraryRuntime = registerCloudLibraryRuntime(requireDatabase())

    restoreScheduledCrawls(requireDatabase().listSources())
    createWindow(!shouldStartHidden())

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

function createSource(input: CreateSourceInput): DocumentSource {
  const source = requireDatabase().createSource(input)
  scheduleSource(source)
  return source
}

function deleteSource(id: string): void {
  if (runningCrawls.has(id)) throw new Error('更新进行中，暂时不能删除文档源')
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
    isCrawling: (id) => runningCrawls.has(id),
    getCrawlState: (id) => crawlStates.get(id)
  }
}

function requireMcpRuntime(): McpRuntime {
  if (!mcpRuntime) throw new Error('MCP 服务尚未初始化')
  return mcpRuntime
}

async function importLocalData(): Promise<DataTransferResult> {
  if (runningCrawls.size > 0) throw new Error('文档正在更新，请等待更新完成后再导入')
  const selected = await selectBackupFile(mainWindow)
  if (selected.canceled) return { canceled: true, message: '' }

  const currentDatabase = requireDatabase()
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
        if (!runningCrawls.has(source.id)) await crawlSource(source.id)
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
  if (runningCrawls.has(id)) throw new Error('这个文档源已经在更新中')
  const source = requireDatabase().getSourceConfig(id)
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
    return progress
  } catch (error) {
    finishCrawl(id, crawlStates.get(id)?.progress, errorMessage(error))
    throw error
  } finally {
    runningCrawls.delete(id)
  }
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
