import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { crawlSource, type CrawlNode, type CrawlProgress } from '@loci/core'
import {
  CloudAdminClient,
  CloudLibraryService,
  acquireCrawlRuntimeLock,
  acquireMaintenanceRuntimeLock,
  createDatabase,
  databaseNeedsMigration,
  readRuntimeLock,
  resolveLociCacheDir,
  resolveLociDataDir,
  type LociDatabase
} from '@loci/runtime'
import type {
  CreateSourceInput,
  CrawlRunState,
  DocumentSource,
  UpdateSourceInput
} from '@loci/shared'
import { CliBrowserCrawler, type BrowserInstallPrompt } from './browser.js'

export interface CliRuntime {
  dataDir: string
  cacheDir: string
  database: LociDatabase
  cloud: CloudLibraryService
  admin: CloudAdminClient
  crawlSource: (
    sourceId: string,
    onProgress?: (progress: CrawlProgress) => void,
    onBrowserMissing?: BrowserInstallPrompt
  ) => Promise<CrawlProgress>
  createSource: (input: CreateSourceInput) => DocumentSource
  deleteSource: (sourceId: string) => void
  updateSourcePreservingDesktopFields: (
    source: DocumentSource,
    input: Omit<UpdateSourceInput, 'schedule'>
  ) => DocumentSource
  isCrawling: (sourceId: string) => boolean
  getCrawlState: (sourceId: string) => CrawlRunState | undefined
  assertWritable: () => void
  close: () => Promise<void>
}

export function createCliRuntime(): CliRuntime {
  const dataDir = resolveLociDataDir()
  const cacheDir = resolveLociCacheDir()
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(cacheDir, { recursive: true })
  const databasePath = join(dataDir, 'loci.sqlite')
  const migrationLock = databaseNeedsMigration(databasePath)
    ? acquireMaintenanceRuntimeLock(dataDir, 'CLI 数据库迁移')
    : undefined
  let database: LociDatabase
  try {
    database = createDatabase(databasePath)
  } finally {
    migrationLock?.release()
  }
  const browser = new CliBrowserCrawler(join(cacheDir, 'playwright'))
  const states = new Map<string, CrawlRunState>()
  const assertWritable = (): void => {
    const maintenance = readRuntimeLock(dataDir, 'maintenance')
    if (maintenance) throw new Error(`数据库正在由${maintenance.owner}维护，请稍后重试`)
  }

  const run = async (
    sourceId: string,
    onProgress?: (progress: CrawlProgress) => void,
    onBrowserMissing?: BrowserInstallPrompt
  ): Promise<CrawlProgress> => {
    const source = database.getSourceConfig(sourceId)
    const lock = acquireCrawlRuntimeLock(dataDir, sourceId, 'CLI')
    const initialNode: CrawlNode = {
      id: source.firstUrl,
      url: source.firstUrl,
      title: source.fetchMode === 'auto' ? '正在检测抓取方式' : '正在读取第一个页面',
      status: 'running'
    }
    states.set(sourceId, {
      sourceId,
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
      running: true,
      paused: false
    })
    const runId = database.startCrawlRun(sourceId)
    try {
      const settings = database.getSettings()
      const result = await crawlSource({
        firstUrl: source.firstUrl,
        firstNodeId: source.firstUrl,
        hostname: source.hostname,
        scopePath: source.scopePath,
        pageLimit: source.pageLimit,
        initialUrls: database.listDocumentUrls(sourceId),
        fetchMode: source.fetchMode,
        httpConcurrency: source.httpConcurrency ?? settings.httpConcurrency,
        browserConcurrency: source.browserConcurrency ?? settings.browserConcurrency,
        maxRetries: settings.maxRetries,
        batchIntervalMs: settings.batchIntervalSeconds * 1000,
        crawler: { fetchPage: (url, request) => browser.fetchPage(url, request) },
        beforeBrowserCrawl: () => browser.ensureInstalled(onBrowserMissing),
        onDocument: (document) => database.saveDocument({ ...document, sourceId }),
        onError: ({ url, missing }) => {
          if (missing) database.deleteDocument(sourceId, url)
        },
        onProgress: (progress) => {
          updateState(states, sourceId, progress, null, true)
          onProgress?.(progress)
        },
        onResolved: (resolution) =>
          database.updateResolvedSource(
            sourceId,
            resolution.firstUrl,
            resolution.fetchMode,
            resolution.iconUrl
          )
      })
      if (result.progress.succeeded === 0 && result.progress.failed > 0) {
        throw new Error(`抓取失败：${result.progress.failed} 个页面均未成功`)
      }
      updateState(states, sourceId, result.progress, null, false)
      database.finishCrawlRun(runId, 'completed', result.progress, null)
      return result.progress
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新失败'
      const current = states.get(sourceId)
      if (current) {
        states.set(sourceId, {
          ...current,
          running: false,
          error: message
        })
      }
      database.finishCrawlRun(runId, 'failed', current?.progress, message)
      throw error
    } finally {
      lock.release()
    }
  }

  return {
    dataDir,
    cacheDir,
    database,
    cloud: new CloudLibraryService(database),
    admin: new CloudAdminClient(),
    crawlSource: run,
    createSource: (input) => {
      assertWritable()
      return database.createSource({ ...input, schedule: null })
    },
    deleteSource: (sourceId) => {
      assertWritable()
      if (readRuntimeLock(dataDir, `crawl-${sourceId}`)) {
        throw new Error('更新进行中，暂时不能删除文档源')
      }
      database.deleteSource(sourceId)
    },
    updateSourcePreservingDesktopFields: (source, input) => {
      assertWritable()
      if (readRuntimeLock(dataDir, `crawl-${source.id}`)) {
        throw new Error('更新进行中，暂时不能编辑文档源')
      }
      return database.updateSource(source.id, { ...input, schedule: source.schedule })
    },
    isCrawling: (sourceId) =>
      Boolean(states.get(sourceId)?.running || readRuntimeLock(dataDir, `crawl-${sourceId}`)),
    getCrawlState: (sourceId) => states.get(sourceId),
    assertWritable,
    close: async () => {
      await browser.close()
      database.close()
    }
  }
}

function updateState(
  states: Map<string, CrawlRunState>,
  sourceId: string,
  progress: CrawlProgress,
  error: string | null,
  running: boolean
): void {
  const current = states.get(sourceId)
  if (!current) return
  const node = progress.node
  const existingIndex = node ? current.nodes.findIndex((item) => item.id === node.id) : -1
  const nodes = !node
    ? current.nodes
    : existingIndex < 0
      ? [...current.nodes, node]
      : current.nodes.map((item, index) => (index === existingIndex ? node : item))
  states.set(sourceId, { ...current, progress, nodes, error, running, paused: false })
}
