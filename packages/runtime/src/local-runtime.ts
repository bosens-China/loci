import { createDocumentQuery } from './document-query.js'
import { createEmbeddingService } from './embedding-service.js'
import { randomUUID } from 'node:crypto'
import { clearWithMaintenanceLock, importWithMaintenanceLock } from './data-maintenance.js'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  DOCUMENT_SOURCE_DEFAULTS,
  DEFAULT_LIBRARY_VERSION,
  DEFAULT_LIBRARY_CATEGORY,
  deriveSourceName,
  getSourcePatchContentRemovalRisk,
  parseGithubRepositoryUrl,
  type CrawlProgress,
  type ForegroundCrawlState,
  type DocumentSource
} from '@loci/shared'
import { createDocumentMutation } from './document-mutation.js'
import { createLibraryCrawlStatuses } from './library-crawl-status.js'
import { AgentIntegrationService } from './agent-integration.js'
import { CrawlTaskCoordinator, crawlRequestKey } from './crawl-task-coordinator.js'
import { createDatabase, databaseNeedsMigration, type LociDatabase } from './database.js'
import { crawlRunState } from './external-crawl.js'
import { runExplicitPageFetch } from './explicit-page-service.js'
import { LocalBrowserCrawler, type BrowserInstallPrompt } from './browser-crawler.js'
import { BrowserManager } from './browser-manager.js'
import { resolveLociCacheDir, resolveLociDataDir } from './data-path.js'
import {
  acquireCrawlRuntimeLock,
  acquireDatabaseWriteRuntimeLock,
  acquireMaintenanceRuntimeLock,
  hasActiveCrawlLocks,
  readRuntimeLock
} from './runtime-lock.js'
import { createLocalSourceCrawlRunner, type LocalCrawlState } from './local-source-crawl-runner.js'
import type { LocalRuntime, LocalRuntimeOptions } from './local-runtime-types.js'

export type { LocalRuntime, LocalRuntimeOptions } from './local-runtime-types.js'

export class SourceContentRemovalRequired extends Error {
  constructor(libraryName: string) {
    super(`更改「${libraryName}」的收录范围或排除规则可能清理已有文档和指定页面`)
  }
}

/** 所有本机入口共用的应用运行时，入口层只负责交互和 transport。 */
export function createLocalRuntime(options: LocalRuntimeOptions = {}): LocalRuntime {
  const dataDir = options.dataDir ?? resolveLociDataDir()
  const cacheDir = options.cacheDir ?? resolveLociCacheDir()
  const owner = options.owner ?? 'Loci'
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(cacheDir, { recursive: true })
  const databasePath = join(dataDir, 'loci.sqlite')
  const migrationLock = databaseNeedsMigration(databasePath)
    ? acquireMaintenanceRuntimeLock(dataDir, `${owner} 数据库迁移`)
    : undefined
  let database: LociDatabase
  try {
    database = createDatabase(databasePath)
  } finally {
    migrationLock?.release()
  }
  const browsersPath = join(cacheDir, 'playwright')
  const browserManager = new BrowserManager({
    browsersPath,
    lockRoot: cacheDir,
    usageLockRoot: dataDir,
    owner,
    beforeUninstall: () => browser.close(),
    assertCanUninstall: () => {
      if (hasActiveCrawlLocks(dataDir)) {
        throw new Error('仍有文档抓取任务正在使用浏览器，请等待完成后重试')
      }
    }
  })
  const browser =
    options.browser ??
    new LocalBrowserCrawler(browsersPath, async () => {
      await browserManager.run('install')
    })
  const agentIntegration = options.agentIntegration
    ? new AgentIntegrationService({
        ...options.agentIntegration,
        database,
        dataDir
      })
    : undefined
  const activePages = new Map<string, ForegroundCrawlState & { runId: string }>()
  const states = new Map<string, LocalCrawlState>()
  const crawlTasks = new CrawlTaskCoordinator()
  const assertWritable = (): void => {
    const maintenance = readRuntimeLock(dataDir, 'maintenance')
    if (maintenance) throw new Error(`数据库正在由${maintenance.owner}维护，请稍后重试`)
  }
  const mutateSource = <T>(sourceId: string, label: string, action: () => T): T => {
    const lock = acquireCrawlRuntimeLock(dataDir, sourceId, `${owner} ${label}`)
    try {
      return action()
    } finally {
      lock.release()
    }
  }

  function writeMetadata<T>(action: () => T): T {
    // 同一行的幂等约束落在 SQLite，独立写入锁只负责与备份恢复互斥。
    const lock = acquireDatabaseWriteRuntimeLock(dataDir, `write-${randomUUID()}`, owner)
    try {
      return action()
    } finally {
      lock.release()
    }
  }
  async function maintenance<T>(action: () => Promise<T>): Promise<T> {
    const lock = acquireMaintenanceRuntimeLock(dataDir, `${owner} 数据维护`)
    try {
      return await action()
    } finally {
      lock.release()
    }
  }
  function applySourceConfig(
    source: DocumentSource,
    patch: Parameters<LocalRuntime['patchSource']>[1],
    allowContentRemoval: boolean,
    save = (input: Parameters<LociDatabase['updateSource']>[1]) =>
      database.updateSource(source.id, input)
  ) {
    if (patch.category !== undefined)
      patch = { ...patch, category: patch.category?.trim() || DEFAULT_LIBRARY_CATEGORY }
    if (patch.version !== undefined)
      patch = { ...patch, version: patch.version?.trim() || DEFAULT_LIBRARY_VERSION }
    if (
      !Object.entries(patch).some(([key, value]) => source[key as keyof DocumentSource] !== value)
    )
      return source
    return mutateSource(source.id, '编辑文档库', () => {
      const current = database.getSource(source.id)
      // 持有库锁后再判断，防止其他进程在预览与保存之间改变可裁剪范围。
      if (!allowContentRemoval && getSourcePatchContentRemovalRisk(current, patch))
        throw new SourceContentRemovalRequired(current.name)
      return save({ ...current, ...patch })
    })
  }

  const upsertSource: LocalRuntime['createSource'] = (
    { url, kind, ...patch },
    allowContentRemoval = true
  ) =>
    writeMetadata(() =>
      database.upsertSource(
        {
          ...DOCUMENT_SOURCE_DEFAULTS,
          url,
          kind,
          name: parseGithubRepositoryUrl(url)?.repo ?? deriveSourceName(url),
          ...patch
        },
        (source, save) => applySourceConfig(source, patch, allowContentRemoval, save)
      )
    )

  const runOnce = createLocalSourceCrawlRunner({
    dataDir,
    owner,
    database,
    browser,
    states,
    detached: options.detachedCrawl
  })
  const shutdown = new AbortController()
  const documents = createDocumentQuery(database, dataDir, owner)
  const embeddings = createEmbeddingService(
    database,
    dataDir,
    options.launchEmbeddingRefresh,
    options.embeddingBackend
  )
  const pending = new Set<Promise<unknown>>()
  let closing: Promise<void> | undefined
  function track<T>(operation: Promise<T>): Promise<T> {
    pending.add(operation)
    const release = () => {
      pending.delete(operation)
    }
    void operation.then(release, release)
    return operation
  }
  const importBackupArchive: LocalRuntime['importBackupArchive'] = (input, options) =>
    track(
      importWithMaintenanceLock(database, dataDir, owner, input, options, shutdown.signal).then(
        (summary) => {
          states.clear()
          return summary
        }
      )
    )

  const lifetime = (signal?: AbortSignal) =>
    signal ? AbortSignal.any([signal, shutdown.signal]) : shutdown.signal

  const run = (
    sourceId: string,
    onProgress?: (progress: CrawlProgress) => void,
    onBrowserMissing?: BrowserInstallPrompt,
    signal?: AbortSignal,
    additionalUrls?: readonly string[]
  ): Promise<CrawlProgress> =>
    track(
      crawlTasks.run(
        sourceId,
        (reportProgress) =>
          runOnce(sourceId, reportProgress, onBrowserMissing, lifetime(signal), additionalUrls),
        onProgress,
        lifetime(signal),
        crawlRequestKey('sync', additionalUrls)
      )
    )

  return {
    dataDir,
    cacheDir,
    database,
    browserManager,
    ...documents,
    embeddings,
    searchDocumentSections: (input) =>
      track(
        embeddings
          .prepareSearch(input)
          .then((candidates) => documents.searchDocuments(input, candidates))
      ),
    getSearchLibraryTree: async (id, input) => {
      if (input?.queries === undefined) return documents.getLibraryTree(id, input)
      return track(
        embeddings
          .prepareSearch({ queries: input.queries, libraryIds: [id] })
          .then((candidates) => documents.getLibraryTree(id, input, candidates))
      )
    },
    ...createDocumentMutation(database, mutateSource),
    ...createLibraryCrawlStatuses(database, dataDir, (id) => activePages.get(id) ?? states.get(id)),
    agentIntegration,
    crawlSource: run,
    fetchPages: (sourceId, urls, onBrowserMissing, signal, onProgress) => {
      assertWritable()
      return track(
        runExplicitPageFetch(
          { database, browser, dataDir, owner, activePages, detached: options.detachedCrawl },
          sourceId,
          urls,
          onBrowserMissing,
          lifetime(signal),
          onProgress
        )
      )
    },
    createSource: upsertSource,
    upsertSource,
    patchSource: (id, patch, allowContentRemoval = true) =>
      applySourceConfig(database.getSource(id), patch, allowContentRemoval),
    listCategories: database.listCategories,
    createCategory: (name) => writeMetadata(() => database.createCategory(name)),
    deleteCategory: (name) => writeMetadata(() => database.deleteCategory(name)),
    patchAppSettings: (partial) => writeMetadata(() => database.patchAppSettings(partial)),
    patchHostnamePolicy: (hostname, partial) =>
      writeMetadata(() => database.patchHostnamePolicy(hostname, partial)),
    saveSettings: (input) => writeMetadata(() => database.saveSettings(input)),
    saveHostnameCrawlPolicy: (input) =>
      writeMetadata(() => database.saveHostnameCrawlPolicy(input)),
    deleteHostnameCrawlPolicy: (hostname) =>
      writeMetadata(() => database.deleteHostnameCrawlPolicy(hostname)),
    exportBackupArchive: (options) =>
      track(maintenance(() => database.exportBackupArchive(options))),
    importBackupArchive,
    getClearDataCounts: database.getClearDataCounts,
    clearData: (scope, signal) =>
      track(
        clearWithMaintenanceLock(database, dataDir, owner, scope, lifetime(signal)).then(
          (summary) => {
            states.clear()
            activePages.clear()
            return summary
          }
        )
      ),
    updateSource: (id, input) =>
      mutateSource(id, '编辑文档库', () => database.updateSource(id, input)),
    isCrawling: (sourceId) =>
      Boolean(
        crawlTasks.isRunning(sourceId) ||
        states.get(sourceId)?.running ||
        readRuntimeLock(dataDir, `crawl-${sourceId}`)
      ),
    getCrawlState: (sourceId) => {
      const local = states.get(sourceId)
      if (local?.running) return local
      if (!readRuntimeLock(dataDir, `crawl-${sourceId}`)) return local
      const active = database.getActiveCrawlRun(sourceId)
      return active ? crawlRunState(active) : local
    },
    resetCrawlStates: () => states.clear(),
    assertWritable,
    close: () => {
      closing ??= (async () => {
        shutdown.abort()
        await Promise.allSettled(pending)
        try {
          await browserManager.waitForCurrent()
          await browser.close()
        } finally {
          try {
            await embeddings.close()
          } finally {
            database.close()
          }
        }
      })()
      return closing
    }
  }
}
