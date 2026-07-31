import { app, shell, BrowserWindow, ipcMain, Menu, Tray } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { createDatabase, type DocHubDatabase } from './database'
import type {
  CreateSourceInput,
  CrawlNode,
  CrawlProgress,
  CrawlRunState,
  UpdateSourceInput
} from '../shared/api'
import { crawlHttpSource, fetchHttpPage } from './crawl/http'
import { crawlRenderedSource, fetchRenderedCrawlPage } from './crawl/rendered'
import { selectFetchMode, type SelectedFetchMode } from './crawl/mode'
import type { CrawledPage } from './crawl/runner'
import { getHostname } from './crawl/url'

let database: DocHubDatabase | undefined
let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
let isQuitting = false
const runningCrawls = new Set<string>()
const crawlStates = new Map<string, CrawlRunState>()

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    mainWindow?.hide()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  database = createDatabase(join(app.getPath('userData'), 'doc-hub.sqlite'))
  createTray()

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('sources:list', () => requireDatabase().listSources())
  ipcMain.handle('sources:create', (_event, input: CreateSourceInput) =>
    requireDatabase().createSource(input)
  )
  ipcMain.handle('sources:update', (_event, id: string, input: UpdateSourceInput) => {
    if (runningCrawls.has(id)) throw new Error('更新进行中，暂时不能编辑文档源')
    return requireDatabase().updateSource(id, input)
  })
  ipcMain.handle('sources:crawl', (_event, id: string) => crawlSource(id))
  ipcMain.handle('sources:crawl-runs', () => [...crawlStates.values()])
  ipcMain.handle('documents:list', () => requireDatabase().listDocuments())
  ipcMain.handle('documents:search', (_event, query: string) =>
    requireDatabase().searchDocuments(query)
  )
  ipcMain.handle('sources:delete', (_event, id: string) => {
    if (runningCrawls.has(id)) throw new Error('更新进行中，暂时不能删除文档源')
    crawlStates.delete(id)
    requireDatabase().deleteSource(id)
  })

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
  // The app stays alive in the tray until the user explicitly exits.
})

app.on('before-quit', () => database?.close())
app.on('before-quit', () => {
  isQuitting = true
  tray?.destroy()
})

function requireDatabase(): DocHubDatabase {
  if (!database) throw new Error('本地数据库尚未初始化')
  return database
}

async function crawlSource(id: string): Promise<CrawlProgress> {
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
    const progress = await runCrawl(id)
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

async function runCrawl(id: string): Promise<CrawlProgress> {
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
  localDatabase.updateResolvedSource(id, firstUrl, selectedMode)
  const options = {
    firstUrl,
    firstNodeId: source.firstUrl,
    hostname,
    pageLimit: source.pageLimit,
    initialUrls,
    seedPage: firstPage,
    onDocument: (document) => localDatabase.saveDocument({ ...document, sourceId: id }),
    onError: ({ url, missing }) => {
      if (missing) localDatabase.deleteDocument(id, url)
    },
    onProgress: (progress) => emitCrawlProgress(id, progress)
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

function createTray(): void {
  tray = new Tray(icon)
  tray.setToolTip('Doc Hub')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => mainWindow?.show() },
      { type: 'separator' },
      {
        label: '退出 Doc Hub',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', () => mainWindow?.show())
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
