import {
  classifyExplicitPageUrls,
  crawlSource,
  GithubLimitError,
  type ExplicitPageResult,
  type CrawlNode,
  type CrawlProgress,
  type SourceCrawlResult
} from '@loci/core'
import type { CrawlRunState } from '@loci/shared'
import { LocalBrowserCrawler, type BrowserInstallPrompt } from './browser-crawler.js'
import { crawlRequestKey } from './crawl-task-coordinator.js'
import type { LociDatabase } from './database.js'
import type { StoredDocument } from './document-content-database.js'
import { waitForCrawlLockRelease, waitForExternalCrawl } from './external-crawl.js'
import {
  explicitPageProgress,
  fetchSourceExplicitPages,
  mergeCrawlProgress,
  mergeExplicitPageProgress,
  runExplicitPageFetch
} from './explicit-page-service.js'
import { CrawlCancelledError, RuntimeLockedError, acquireRunningCrawl } from './runtime-lock.js'

export interface LocalCrawlState extends CrawlRunState {
  runId: string
}

interface CrawlRunnerContext {
  dataDir: string
  owner: string
  database: LociDatabase
  browser: LocalBrowserCrawler
  detached?: boolean
  states: Map<string, LocalCrawlState>
}

export type RunLocalSourceCrawl = (
  sourceId: string,
  onProgress?: (progress: CrawlProgress) => void,
  onBrowserMissing?: BrowserInstallPrompt,
  signal?: AbortSignal,
  additionalUrls?: readonly string[]
) => Promise<CrawlProgress>

/** 单次文档库抓取与原子提交，入口运行时只负责调度和资源生命周期。 */
export function createLocalSourceCrawlRunner(context: CrawlRunnerContext): RunLocalSourceCrawl {
  const { dataDir, owner, database, browser, states } = context
  const run: RunLocalSourceCrawl = async (
    sourceId: string,
    onProgress?: (progress: CrawlProgress) => void,
    onBrowserMissing?: BrowserInstallPrompt,
    signal?: AbortSignal,
    additionalUrls?: readonly string[]
  ): Promise<CrawlProgress> => {
    let lock
    try {
      lock = acquireRunningCrawl(dataDir, sourceId, owner, signal, context.detached)
      signal = lock.signal
    } catch (error) {
      if (context.detached || !(error instanceof RuntimeLockedError)) throw error
      const record = error.record
      if (!record || error.key !== `crawl-${sourceId}`) throw error
      const pageFetchIsRunning = record.owner.includes('指定页面抓取')
      try {
        const progress = await waitForExternalCrawl(database, sourceId, onProgress, signal, {
          dataDir,
          record
        })
        if (!pageFetchIsRunning) {
          if (!additionalUrls?.length) return progress
          // 前台跟随者可能带有原任务未请求的入口，等原库提交后只补齐缺失的页面。
          const indexed = new Set(database.listDocumentUrls(sourceId))
          const missing = additionalUrls.filter((url) => !indexed.has(url))
          if (!missing.length) return progress
          const extra = await runExplicitPageFetch(
            context,
            sourceId,
            missing,
            onBrowserMissing,
            signal,
            (p) => onProgress?.(mergeCrawlProgress(progress, p))
          )
          return mergeCrawlProgress(progress, extra.progress)
        }
      } catch (waitError) {
        if (!pageFetchIsRunning || signal?.aborted || waitError instanceof CrawlCancelledError)
          throw waitError
      }
      await waitForCrawlLockRelease(dataDir, sourceId, signal)
      return run(sourceId, onProgress, onBrowserMissing, signal, additionalUrls)
    }
    try {
      signal?.throwIfAborted()
      const source = database.getSourceConfig(sourceId)
      const settings = database.getSettings()
      const policy = database.getHostnameCrawlPolicy(source.hostname)
      const initialNode: CrawlNode = {
        id: source.firstUrl,
        url: source.firstUrl,
        title: source.fetchMode === 'auto' ? '正在检测抓取方式' : '正在读取第一个页面',
        status: 'running'
      }
      const initialProgress: CrawlProgress = {
        queued: 0,
        processed: 0,
        succeeded: 0,
        failed: 0,
        limitReached: false,
        node: initialNode
      }
      const runId = database.startCrawlRun(
        sourceId,
        'sync',
        lock.runId,
        crawlRequestKey('sync', additionalUrls)
      )
      states.set(sourceId, {
        runId,
        sourceId,
        progress: initialProgress,
        nodes: [initialNode],
        error: null,
        running: true,
        paused: false
      })
      const documents: StoredDocument[] = []
      const deletedUrls: string[] = []
      let replaceAll = false
      try {
        const reportProgress = (progress: CrawlProgress): void => {
          updateState(states, sourceId, progress, null, true)
          database.updateCrawlRunProgress(runId, progress)
          onProgress?.(progress)
        }
        // 先持久化未知总量的准备状态，供其他进程复用探测进度。
        reportProgress(initialProgress)
        const targets = new Set(
          database.listExplicitPageTargets(sourceId).map((target) => target.url)
        )
        const storedUrls = database.listDocumentUrls(sourceId, false)
        const reviewed = source.discoveryMode === 'agent_review'
        const result = reviewed
          ? await refreshStoredReviewPages(
              {
                database,
                browser,
                source,
                urls: storedUrls.filter((url) => !targets.has(url)),
                signal,
                onBrowserMissing,
                onProgress: reportProgress
              },
              documents,
              deletedUrls
            )
          : await crawlSource({
              kind: source.kind,
              firstUrl: source.firstUrl,
              firstNodeId: source.firstUrl,
              hostname: source.hostname,
              scopePath: source.scopePath,
              excludePathPattern: source.excludePathPattern,
              pageLimit: source.pageLimit,
              initialUrls: storedUrls,
              fetchMode: source.fetchMode,
              httpConcurrency:
                source.httpConcurrency ?? policy?.httpConcurrency ?? settings.httpConcurrency,
              browserConcurrency:
                source.browserConcurrency ??
                policy?.browserConcurrency ??
                settings.browserConcurrency,
              maxRetries: settings.maxRetries,
              githubArchiveLimitBytes:
                (source.githubArchiveLimitMb ?? settings.githubArchiveLimitMb) * 1024 * 1024,
              githubMarkdownLimitBytes:
                (source.githubMarkdownLimitMb ?? settings.githubMarkdownLimitMb) * 1024 * 1024,
              githubPreviousRevision: source.githubRevision,
              githubBlocked: source.githubBlocked,
              signal,
              crawler: { fetchPage: (url, request) => browser.fetchPage(url, request) },
              beforeBrowserCrawl: async () => {
                if (source.fetchMode === 'auto') return browser.isInstalled()
                await browser.ensureInstalled(onBrowserMissing)
              },
              onDocument: (document) => {
                documents.push({ ...document, sourceId })
              },
              onSnapshot: (snapshot) => {
                replaceAll = true
                for (const document of snapshot) documents.push({ ...document, sourceId })
              },
              onError: ({ url, missing }) => {
                if (missing) deletedUrls.push(url)
              },
              onDuplicate: ({ url }) => {
                deletedUrls.push(url)
              },
              onProgress: reportProgress
            })
        const rejected: ExplicitPageResult[] = []
        if (additionalUrls?.length) {
          // 同一库的其他入口也在本次运行内补抓，取消或查询始终对应同一把锁与运行记录。
          const indexed = new Set(replaceAll ? [] : database.listDocumentUrls(sourceId))
          for (const url of deletedUrls) indexed.delete(url)
          for (const doc of documents) indexed.add(doc.url)
          const missing = classifyExplicitPageUrls({
            ...source,
            urls: additionalUrls.filter((url) => !indexed.has(url))
          })
          for (const { url, error } of missing) {
            if (error)
              rejected.push({
                url,
                status: 'failed',
                failure: { url, message: error, reason: 'request_error', retryable: false }
              })
            else targets.add(url)
          }
        }
        const explicit = targets.size
          ? await fetchSourceExplicitPages({
              database,
              browser,
              source,
              urls: [...targets],
              fetchMode:
                reviewed && !result.progress.queued
                  ? source.fetchMode
                  : result.resolution.fetchMode,
              signal,
              onBrowserMissing,
              onProgress: (progress) =>
                reportProgress(mergeCrawlProgress(result.progress, progress))
            })
          : undefined
        const explicitPages = explicit?.items ?? []
        const progress = mergeExplicitPageProgress(result.progress, [...explicitPages, ...rejected])
        if (!reviewed && progress.succeeded === 0 && progress.failed > 0) {
          updateState(states, sourceId, progress, null, true)
          const reason = progress.failures?.[0]?.message
          throw new Error(
            `抓取失败：${progress.failed} 个页面均未成功${reason ? `（首个错误：${reason}）` : ''}`
          )
        }
        signal?.throwIfAborted()
        const committed = database.commitSourceCrawl(sourceId, {
          documents,
          deletedUrls,
          replaceAll,
          run: { id: runId, progress },
          explicitPages: explicitPages.length ? explicitPages : undefined,
          resolution: {
            firstUrl: result.resolution.firstUrl,
            mode: reviewed
              ? (explicit?.fetchMode ?? result.resolution.fetchMode)
              : result.resolution.fetchMode,
            iconUrl: reviewed
              ? (result.resolution.iconUrl ?? explicit?.iconUrl ?? null)
              : result.resolution.iconUrl,
            discovery: result.resolution.discovery,
            github: result.resolution.github
          }
        })
        if (!committed) throw new Error('任务已取消，未提交抓取结果')
        updateState(states, sourceId, progress, null, false)
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
        database.finishCrawlRun(
          runId,
          signal?.aborted ? 'cancelled' : 'failed',
          current?.progress,
          message
        )
        signal?.throwIfAborted()
        throw error
      }
    } finally {
      lock.release()
    }
  }

  return run
}

/** 旧审查库沿用本地的收录决定，普通更新只取已保存的页面。 */
async function refreshStoredReviewPages(
  options: Parameters<typeof fetchSourceExplicitPages>[0],
  documents: StoredDocument[],
  deletedUrls: string[]
): Promise<SourceCrawlResult> {
  const result = options.urls.length ? await fetchSourceExplicitPages(options) : undefined
  for (const item of result?.items ?? []) {
    if (item.document) documents.push({ ...item.document, sourceId: options.source.id })
    if (item.status === 'missing') deletedUrls.push(item.url)
  }
  return {
    progress: explicitPageProgress(result?.items ?? []),
    resolution: {
      firstUrl: options.source.firstUrl,
      hostname: options.source.hostname,
      discovery: 'pages',
      fetchMode: result?.fetchMode ?? (options.source.fetchMode === 'browser' ? 'browser' : 'http'),
      iconUrl: result?.iconUrl ?? null
    }
  }
}

function updateState(
  states: Map<string, LocalCrawlState>,
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
