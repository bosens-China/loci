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
import { crawlHttpSource, fetchHttpPage } from './crawl/http'
import { crawlRenderedSource, fetchRenderedCrawlPage } from './crawl/rendered'
import { selectFetchMode, type SelectedFetchMode } from './crawl/mode'
import type { CrawledPage } from './crawl/runner'
import { getHostname } from './crawl/url'
import type { LociMcpServices } from './mcp/server'
import { createMcpRuntime, type McpRuntime } from './mcp/runtime'
import { importAgentClient } from './agent-import'
import { registerSingleInstance } from './single-instance'
import { createAppTray } from './tray'
import { exportBackupFile, selectBackupFile } from './data-transfer'
import { createAppWindow } from './app-window'

let database: LociDatabase | undefined
let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
let mcpRuntime: McpRuntime | undefined
let isQuitting = false
const runningCrawls = new Set<string>()
const crawlStates = new Map<string, CrawlRunState>()
const scheduledCrawls = new Map<string, Cron>()
const isPrimaryInstance = registerSingleInstance(() => mainWindow)

function createWindow(): void {
  mainWindow = createAppWindow(() => isQuitting)
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
    ipcMain.handle('sources:delete', (_event, id: string) => deleteSource(id))
    ipcMain.handle('settings:get', () => requireMcpRuntime().getState())
    ipcMain.handle('settings:save', (_event, settings: AppSettings) =>
      requireMcpRuntime().save(settings)
    )
    ipcMain.handle('agents:import', (_event, client: unknown) =>
      importAgentClient(client, requireMcpRuntime().getState().mcp.endpoint)
    )
    ipcMain.handle('data:export', () =>
      exportBackupFile(mainWindow, requireDatabase().exportBackup())
    )
    ipcMain.handle('data:import', () => importLocalData())

    restoreScheduledCrawls(requireDatabase().listSources())
    createWindow()

    app.on('activate', function () {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform === 'linux') app.quit()
})

app.on('before-quit', () => {
  isQuitting = true
  stopScheduledCrawls()
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
    const progress = await runCrawl(id, onProgress)
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

async function runCrawl(
  id: string,
  onProgress?: (progress: CrawlProgress) => void
): Promise<CrawlProgress> {
  const localDatabase = requireDatabase()
  const source = localDatabase.getSourceConfig(id)
  const initialUrls = localDatabase.listDocumentUrls(id)
  let selectedMode: SelectedFetchMode
  let firstPage: CrawledPage

  if (source.fetchMode === 'auto') {
    const [httpResult, browserResult] = await Promise.allSettled([
      fetchHttpPage(source.firstUrl),
      fetchRenderedCrawlPage(source.firstUrl)
    ])
    const selection = selectAutoResult(httpResult, browserResult)
    selectedMode = selection.mode
    firstPage = selection.page
  } else {
    selectedMode = source.fetchMode
    try {
      firstPage =
        selectedMode === 'http'
          ? await fetchHttpPage(source.firstUrl)
          : await fetchRenderedCrawlPage(source.firstUrl)
    } catch {
      firstPage = { url: source.firstUrl, status: 0 }
    }
  }

  const firstUrl = firstPage.url
  const hostname = getHostname(firstUrl)
  localDatabase.updateResolvedSource(id, firstUrl, selectedMode, firstPage.page?.iconUrl ?? null)
  const settings = localDatabase.getSettings()
  const options = {
    firstUrl,
    firstNodeId: source.firstUrl,
    hostname,
    pageLimit: source.pageLimit,
    concurrency:
      source.concurrency ??
      (selectedMode === 'http' ? settings.httpConcurrency : settings.browserConcurrency),
    initialUrls,
    seedPage: firstPage,
    onDocument: (document) => localDatabase.saveDocument({ ...document, sourceId: id }),
    onError: ({ url, missing }) => {
      if (missing) localDatabase.deleteDocument(id, url)
    },
    onProgress: (progress) => {
      emitCrawlProgress(id, progress)
      onProgress?.(progress)
    }
  } satisfies Parameters<typeof crawlHttpSource>[0]
  return selectedMode === 'http' ? crawlHttpSource(options) : crawlRenderedSource(options)
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

function selectAutoResult(
  httpResult: PromiseSettledResult<CrawledPage>,
  browserResult: PromiseSettledResult<CrawledPage>
): { mode: SelectedFetchMode; page: CrawledPage } {
  const httpPage = httpResult.status === 'fulfilled' ? httpResult.value : undefined
  const browserPage = browserResult.status === 'fulfilled' ? browserResult.value : undefined
  if (httpPage?.page && browserPage?.page) {
    const mode = selectFetchMode(httpPage.page, browserPage.page)
    return { mode, page: mode === 'http' ? httpPage : browserPage }
  }
  if (httpPage?.page) return { mode: 'http', page: httpPage }
  if (browserPage?.page) return { mode: 'browser', page: browserPage }
  if (httpPage) return { mode: 'http', page: httpPage }
  if (browserPage) return { mode: 'browser', page: browserPage }
  throw new Error('第一个页面的 HTTP 与浏览器抓取均失败')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '更新失败'
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
