import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { crawlSource, GithubLimitError, type CrawlNode, type CrawlProgress } from '@loci/core'
import type { CrawlRunState, DocumentSource } from '@loci/shared'
import { CloudAdminClient } from './cloud-admin-client.js'
import { AgentIntegrationService } from './agent-integration.js'
import { CloudLibraryService, cloudLibraryLockKey } from './cloud-library-service.js'
import { CrawlTaskCoordinator } from './crawl-task-coordinator.js'
import { createDatabase, databaseNeedsMigration, type LociDatabase } from './database.js'
import { crawlRunState, waitForCrawlLockRelease, waitForExternalCrawl } from './external-crawl.js'
import {
  fetchSourceExplicitPages,
  mergeCrawlProgress,
  mergeExplicitPageProgress,
  runExplicitPageFetch
} from './explicit-page-service.js'
import { LocalBrowserCrawler, type BrowserInstallPrompt } from './browser-crawler.js'
import { resolveLociCacheDir, resolveLociDataDir } from './data-path.js'
import {
  RuntimeLockedError,
  acquireCrawlRuntimeLock,
  acquireDatabaseWriteRuntimeLock,
  acquireMaintenanceRuntimeLock,
  readRuntimeLock
} from './runtime-lock.js'
import { refreshReviewedSource } from './reviewed-source-refresh.js'
import { createUrlReviewService } from './url-review-service.js'
import type { LocalRuntime, LocalRuntimeOptions } from './local-runtime-types.js'

export type { LocalRuntime, LocalRuntimeOptions } from './local-runtime-types.js'

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
    const serverUrl = process.env.LOCI_SERVER_URL?.trim()
    database = createDatabase(databasePath, serverUrl ? { serverUrl, overrideServerUrl: true } : {})
  } finally {
    migrationLock?.release()
  }
  const browser = options.browser ?? new LocalBrowserCrawler(join(cacheDir, 'playwright'))
  const agentIntegration = options.agentIntegration
    ? new AgentIntegrationService({
        ...options.agentIntegration,
        database,
        dataDir
      })
    : undefined
  const states = new Map<string, CrawlRunState>()
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

  const runOnce = async (
    sourceId: string,
    onProgress?: (progress: CrawlProgress) => void,
    onBrowserMissing?: BrowserInstallPrompt,
    signal?: AbortSignal,
    localJob?: { id: string; owner: string }
  ): Promise<CrawlProgress> => {
    let lock
    try {
      lock = acquireCrawlRuntimeLock(dataDir, sourceId, owner)
    } catch (error) {
      if (!(error instanceof RuntimeLockedError)) throw error
      if (!readRuntimeLock(dataDir, `crawl-${sourceId}`)) throw error
      const pageFetchIsRunning = error.record?.owner.includes('指定页面抓取') === true
      try {
        const progress = await waitForExternalCrawl(
          database,
          sourceId,
          (current) => {
            updateState(states, sourceId, current, null, true)
            onProgress?.(current)
          },
          signal
        )
        if (!pageFetchIsRunning) return progress
      } catch (waitError) {
        if (!pageFetchIsRunning || signal?.aborted) throw waitError
      }
      await waitForCrawlLockRelease(dataDir, sourceId, signal)
      return runOnce(sourceId, onProgress, onBrowserMissing, signal, localJob)
    }
    try {
      const source = database.getSourceConfig(sourceId)
      const activeReview = database.getActiveUrlReview(sourceId)
      if (activeReview) throw new Error('文档库正在等待 Agent URL 审查，完成或取消后才能普通同步')
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
        const documents: Parameters<LociDatabase['saveDocument']>[0][] = []
        const deletedUrls: string[] = []
        let replaceAll = false
        const reportProgress = (progress: CrawlProgress): void => {
          updateState(states, sourceId, progress, null, true)
          database.updateCrawlRunProgress(runId, progress)
          onProgress?.(progress)
        }
        const reviewed =
          source.discoveryMode === 'agent_review'
            ? await refreshReviewedSource(
                database,
                browser,
                source,
                onBrowserMissing,
                signal,
                reportProgress
              )
            : undefined
        if (reviewed) {
          if (reviewed.progress.processed === 0) reportProgress(reviewed.progress)
        }
        const result = reviewed
          ? {
              progress: reviewed.progress,
              resolution: {
                firstUrl: reviewed.resolution.firstUrl,
                hostname: source.hostname,
                fetchMode: reviewed.resolution.fetchMode,
                iconUrl: reviewed.resolution.iconUrl,
                discovery: 'pages' as const
              }
            }
          : await crawlSource({
              kind: source.kind,
              firstUrl: source.firstUrl,
              firstNodeId: source.firstUrl,
              hostname: source.hostname,
              scopePath: source.scopePath,
              excludePathPattern: source.excludePathPattern,
              pageLimit: source.pageLimit,
              initialUrls: database.listDocumentUrls(sourceId),
              fetchMode: source.fetchMode,
              httpConcurrency: source.httpConcurrency ?? settings.httpConcurrency,
              browserConcurrency: source.browserConcurrency ?? settings.browserConcurrency,
              maxRetries: settings.maxRetries,
              batchIntervalMs: settings.batchIntervalSeconds * 1000,
              githubArchiveLimitBytes:
                (source.githubArchiveLimitMb ?? settings.githubArchiveLimitMb) * 1024 * 1024,
              githubMarkdownLimitBytes:
                (source.githubMarkdownLimitMb ?? settings.githubMarkdownLimitMb) * 1024 * 1024,
              githubPreviousRevision: source.githubRevision,
              githubBlocked: source.githubBlocked,
              signal,
              crawler: { fetchPage: (url, request) => browser.fetchPage(url, request) },
              beforeBrowserCrawl: () => browser.ensureInstalled(onBrowserMissing),
              onDocument: (document) => {
                documents.push({ ...document, sourceId })
              },
              onSnapshot: (snapshot) => {
                replaceAll = true
                documents.push(...snapshot.map((document) => ({ ...document, sourceId })))
              },
              onError: ({ url, missing }) => {
                if (missing) deletedUrls.push(url)
              },
              onDuplicate: ({ url }) => {
                deletedUrls.push(url)
              },
              onProgress: reportProgress
            })
        const targets = database.listExplicitPageTargets(sourceId)
        const targetUrls = new Set(targets.map((target) => target.url))
        const reviewedUrls = new Set(reviewed?.pages.map((page) => page.url) ?? [])
        const reviewedTargetPages = reviewed?.pages.filter((page) => targetUrls.has(page.url)) ?? []
        if (reviewed) {
          documents.push(...reviewed.documents.filter((document) => !targetUrls.has(document.url)))
          deletedUrls.push(...reviewed.deletedUrls.filter((url) => !targetUrls.has(url)))
        }
        const remainingTargets = reviewed
          ? targets.filter((target) => !reviewedUrls.has(target.url))
          : targets
        const explicit = remainingTargets.length
          ? await fetchSourceExplicitPages({
              database,
              browser,
              source,
              urls: remainingTargets.map((target) => target.url),
              fetchMode: result.resolution.fetchMode,
              signal,
              onBrowserMissing,
              onProgress: (progress) =>
                reportProgress(mergeCrawlProgress(result.progress, progress))
            })
          : undefined
        const progress = mergeExplicitPageProgress(result.progress, explicit?.items ?? [])
        const explicitPages = [...reviewedTargetPages, ...(explicit?.items ?? [])]
        if (!reviewed && progress.succeeded === 0 && progress.failed > 0) {
          throw new Error(`抓取失败：${progress.failed} 个页面均未成功`)
        }
        signal?.throwIfAborted()
        const committed = database.commitSourceCrawl(sourceId, {
          documents,
          deletedUrls,
          replaceAll,
          explicitPages: explicitPages.length ? explicitPages : undefined,
          ...(localJob ? { localJob: { ...localJob, runId, result: progress } } : {}),
          resolution: {
            firstUrl: result.resolution.firstUrl,
            mode: result.resolution.fetchMode,
            iconUrl: result.resolution.iconUrl,
            discovery: result.resolution.discovery,
            github: result.resolution.github
          }
        })
        if (!committed) throw new Error('任务已取消，未提交抓取结果')
        updateState(states, sourceId, progress, null, false)
        if (!localJob) database.finishCrawlRun(runId, 'completed', progress, null)
        return progress
      } catch (error) {
        if (error instanceof GithubLimitError) {
          database.updateGithubBlocked(sourceId, {
            revision: error.revision,
            kind: error.kind,
            limitBytes: error.limitBytes
          })
        }
        const message = error instanceof Error ? error.message : '更新失败'
        const current = states.get(sourceId)
        if (current) states.set(sourceId, { ...current, running: false, error: message })
        database.finishCrawlRun(runId, 'failed', current?.progress, message)
        throw error
      }
    } finally {
      lock.release()
    }
  }

  const run = (
    sourceId: string,
    onProgress?: (progress: CrawlProgress) => void,
    onBrowserMissing?: BrowserInstallPrompt,
    signal?: AbortSignal,
    localJob?: { id: string; owner: string }
  ): Promise<CrawlProgress> =>
    crawlTasks.run(
      sourceId,
      (reportProgress) => runOnce(sourceId, reportProgress, onBrowserMissing, signal, localJob),
      onProgress
    )

  return {
    dataDir,
    cacheDir,
    database,
    cloud: new CloudLibraryService(database, fetch, dataDir),
    admin: new CloudAdminClient(),
    agentIntegration,
    urlReviews: createUrlReviewService({ database, browser, dataDir, owner }),
    crawlSource: run,
    fetchPages: (sourceId, urls, onBrowserMissing, signal, onProgress) => {
      assertWritable()
      return runExplicitPageFetch(
        { database, browser, dataDir, owner },
        sourceId,
        urls,
        onBrowserMissing,
        signal,
        onProgress
      )
    },
    createSource: (input) => {
      assertWritable()
      return database.createSource(input)
    },
    deleteSource: (sourceId) => {
      const source = requireSource(database, sourceId)
      if (!source.cloud) {
        mutateSource(sourceId, '删除文档源', () => database.deleteSource(sourceId))
        return
      }
      const lock = acquireDatabaseWriteRuntimeLock(
        dataDir,
        cloudLibraryLockKey(source.cloud.serverUrl, source.cloud.libraryId),
        `${owner} 删除云文档副本`
      )
      try {
        database.deleteSource(sourceId)
      } finally {
        lock.release()
      }
    },
    updateSourcePreservingSchedule: (source, input) =>
      mutateSource(source.id, '编辑文档源', () => {
        assertNoActiveUrlReview(database, source.id)
        const current = requireSource(database, source.id)
        return database.updateSource(source.id, { ...input, schedule: current.schedule })
      }),
    updateSourceSchedule: (source, schedule) =>
      mutateSource(source.id, '修改定时计划', () => {
        assertNoActiveUrlReview(database, source.id)
        const current = requireSource(database, source.id)
        return database.updateSource(source.id, {
          name: current.name,
          url: current.url,
          mode: current.mode,
          pageLimit: current.pageLimit,
          scopePath: current.scopePath,
          excludePathPattern: current.excludePathPattern ?? null,
          schedule,
          httpConcurrency: current.httpConcurrency,
          browserConcurrency: current.browserConcurrency,
          githubArchiveLimitMb: current.githubArchiveLimitMb,
          githubMarkdownLimitMb: current.githubMarkdownLimitMb
        })
      }),
    isCrawling: (sourceId) =>
      Boolean(
        crawlTasks.isRunning(sourceId) ||
        states.get(sourceId)?.running ||
        database.getActiveUrlReview(sourceId) ||
        readRuntimeLock(dataDir, `crawl-${sourceId}`)
      ),
    getCrawlState: (sourceId) => {
      const local = states.get(sourceId)
      if (local) return local
      const active = database.getActiveCrawlRun(sourceId)
      return active ? crawlRunState(active) : undefined
    },
    resetCrawlStates: () => states.clear(),
    assertWritable,
    close: async () => {
      await browser.close()
      database.close()
    }
  }
}

function requireSource(database: LociDatabase, sourceId: string): DocumentSource {
  const source = database.listSources().find((item) => item.id === sourceId)
  if (!source) throw new Error('文档源不存在')
  return source
}

function assertNoActiveUrlReview(database: LociDatabase, sourceId: string): void {
  if (database.getActiveUrlReview(sourceId)) {
    throw new Error('文档库正在等待 Agent URL 审查，完成或取消后才能修改')
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
