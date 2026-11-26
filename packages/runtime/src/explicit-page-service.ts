import {
  classifyExplicitPageUrls,
  fetchExplicitPages,
  type CrawlProgress,
  type ExplicitPageResult,
  type SourceFetchMode
} from '@loci/core'
import type { ForegroundCrawlState } from '@loci/shared'
import type { LocalBrowserCrawler, BrowserInstallPrompt } from './browser-crawler.js'
import { crawlRequestKey } from './crawl-task-coordinator.js'
import type { LociDatabase, SourceConfig } from './database.js'
import type { ExplicitPageWriteResult } from './explicit-page-database.js'
import { waitForCrawlLockRelease, waitForExternalCrawl } from './external-crawl.js'
import { CrawlCancelledError, RuntimeLockedError, acquireRunningCrawl } from './runtime-lock.js'

export interface ExplicitPageFetchResult {
  runId?: string
  items: ExplicitPageWriteResult[]
  progress: CrawlProgress
}

export interface ExplicitPageServiceOptions {
  database: LociDatabase
  browser: LocalBrowserCrawler
  dataDir: string
  owner: string
  detached?: boolean
  activePages?: Map<string, ForegroundCrawlState & { runId: string }>
}

/** 指定页面与整库同步共用文档源锁；冲突时先复用现有任务，再补抓未覆盖的页面。 */
export async function runExplicitPageFetch(
  options: ExplicitPageServiceOptions,
  sourceId: string,
  requestedUrls: readonly string[],
  onBrowserMissing?: BrowserInstallPrompt,
  signal?: AbortSignal,
  onProgress?: (progress: CrawlProgress) => void
): Promise<ExplicitPageFetchResult> {
  signal?.throwIfAborted()
  const source = options.database.getSourceConfig(sourceId)
  if (source.kind !== 'web') {
    throw new Error('指定页面抓取仅支持本地网页文档源')
  }
  const checked = classifyExplicitPageUrls({
    urls: requestedUrls,
    hostname: source.hostname,
    excludePathPattern: source.excludePathPattern
  })
  if (!checked.length) throw new Error('至少需要一个指定页面 URL')
  const urls = checked.filter((item) => !item.error).map((item) => item.url)
  const invalid = checked
    .filter((item) => item.error)
    .map((item): ExplicitPageWriteResult => ({
      url: item.url,
      status: 'failed',
      message: item.error
    }))
  const requestedAt = new Date().toISOString()
  const fetched = await acquireAndFetch(
    options,
    sourceId,
    urls,
    crawlRequestKey('pages', requestedUrls),
    requestedAt,
    onBrowserMissing,
    signal,
    invalid,
    onProgress
  )
  if (!invalid.length) return fetched
  const byUrl = new Map([...fetched.items, ...invalid].map((item) => [item.url, item]))
  const items = checked.flatMap((item) => {
    const result = byUrl.get(item.url)
    return result ? [result] : []
  })
  return {
    ...fetched,
    items
  }
}

async function acquireAndFetch(
  options: ExplicitPageServiceOptions,
  sourceId: string,
  urls: readonly string[],
  requestKey: string,
  requestedAt: string,
  onBrowserMissing?: BrowserInstallPrompt,
  signal?: AbortSignal,
  invalid: ExplicitPageWriteResult[] = [],
  onProgress?: (progress: CrawlProgress) => void
): Promise<ExplicitPageFetchResult> {
  const invalidCount = invalid.length
  // 只有可解析的页面地址写入失败页表，无效输入仍通过运行错误返回。
  const rejected = invalid.flatMap(({ url, message }) =>
    URL.canParse(url) && message
      ? [{ url, message, reason: 'request_error' as const, retryable: false }]
      : []
  )
  const withRejected = (progress: CrawlProgress): CrawlProgress =>
    rejected.length
      ? { ...progress, failures: [...rejected, ...(progress.failures ?? [])] }
      : progress
  let lock
  try {
    lock = acquireRunningCrawl(
      options.dataDir,
      sourceId,
      `${options.owner} 指定页面抓取`,
      signal,
      options.detached
    )
    signal = lock.signal
  } catch (error) {
    if (options.detached || !(error instanceof RuntimeLockedError)) throw error
    if (!error.record || error.key !== `crawl-${sourceId}`) throw error
    try {
      await waitForExternalCrawl(options.database, sourceId, onProgress, signal, {
        dataDir: options.dataDir,
        record: error.record
      })
    } catch (waitError) {
      if (signal?.aborted || waitError instanceof CrawlCancelledError) throw waitError
      // 现有整库任务失败也不应吞掉本次指定页面请求，锁释放后继续补抓。
    }
    await waitForCrawlLockRelease(options.dataDir, sourceId, signal)
    const covered =
      urls.length && resultFromRecentTargets(options.database, sourceId, urls, requestedAt)
    if (covered) {
      return invalidCount
        ? { ...covered, progress: addInvalidProgress(covered.progress, invalidCount) }
        : covered
    }
    return acquireAndFetch(
      options,
      sourceId,
      urls,
      requestKey,
      requestedAt,
      onBrowserMissing,
      signal,
      invalid,
      onProgress
    )
  }

  let runId: string | undefined
  const initial: CrawlProgress = {
    queued: urls.length + invalidCount,
    processed: 0,
    succeeded: 0,
    failed: 0,
    limitReached: false
  }
  let latestProgress = initial
  try {
    signal?.throwIfAborted()
    const activeRunId = options.database.startCrawlRun(sourceId, 'pages', lock.runId, requestKey)
    runId = activeRunId
    const persist = (progress: CrawlProgress) => {
      options.database.updateCrawlRunProgress(activeRunId, progress)
      latestProgress = progress
      options.activePages?.set(sourceId, {
        libraryId: sourceId,
        runId: activeRunId,
        kind: 'pages',
        status: 'running',
        error: null,
        progress
      })
    }
    persist(initial)
    if (options.detached) onProgress?.(initial)
    reportInvalidPages(invalid, initial.queued, (progress) => {
      persist(progress)
      onProgress?.(progress)
    })
    signal?.throwIfAborted()
    if (!urls.length) {
      const progress = withRejected(latestProgress)
      options.database.finishCrawlRun(
        activeRunId,
        'failed',
        progress,
        invalid[0]?.message ?? '没有可抓取的页面'
      )
      return { runId, items: [], progress }
    }
    const source = options.database.getSourceConfig(sourceId)
    const first = urls[0]!
    persist({ ...latestProgress, node: { id: first, url: first, title: first, status: 'running' } })
    const reportProgress = (progress: CrawlProgress): void => {
      persist(invalidCount ? addInvalidProgress(progress, invalidCount) : progress)
      onProgress?.(latestProgress)
    }
    const result = await fetchSourceExplicitPages({
      database: options.database,
      browser: options.browser,
      source,
      urls,
      signal,
      onProgress: reportProgress,
      onBrowserMissing
    })
    signal?.throwIfAborted()
    const fetchedProgress = explicitPageProgress(result.items)
    const progress = invalidCount
      ? withRejected(addInvalidProgress(fetchedProgress, invalidCount))
      : fetchedProgress
    const items = options.database.commitExplicitPageResults(
      sourceId,
      result.items,
      result.fetchMode,
      result.iconUrl,
      { id: runId, progress, error: invalid[0]?.message }
    )
    return { runId, items, progress }
  } catch (error) {
    const message = error instanceof Error ? error.message : '指定页面抓取失败'
    if (!signal?.aborted) options.database.markExplicitPageTargetsFailed(sourceId, urls, message)
    if (runId)
      options.database.finishCrawlRun(
        runId,
        signal?.aborted ? 'cancelled' : 'failed',
        withRejected(latestProgress),
        message
      )
    signal?.throwIfAborted()
    throw error
  } finally {
    options.activePages?.delete(sourceId)
    lock.release()
  }
}

function reportInvalidPages(
  items: readonly ExplicitPageWriteResult[],
  total: number,
  onProgress?: (progress: CrawlProgress) => void
): void {
  items.forEach((item, index) =>
    onProgress?.({
      queued: total,
      processed: index + 1,
      succeeded: 0,
      failed: index + 1,
      limitReached: false,
      node: { id: item.url, url: item.url, title: item.url, status: 'failed' }
    })
  )
}

export function explicitPageProgress(items: readonly ExplicitPageResult[]): CrawlProgress {
  const failures = items.flatMap((item) => (item.failure ? [item.failure] : []))
  return {
    queued: items.length,
    processed: items.length,
    succeeded: items.filter((item) => item.status === 'fetched').length,
    failed: items.filter((item) => item.status !== 'fetched').length,
    limitReached: false,
    ...(failures.length ? { failures } : {})
  }
}

function resultFromRecentTargets(
  database: LociDatabase,
  sourceId: string,
  urls: readonly string[],
  requestedAt: string
): ExplicitPageFetchResult | undefined {
  const targets = new Map(
    database.listExplicitPageTargets(sourceId).map((item) => [item.url, item])
  )
  const selected = urls.map((url) => targets.get(url))
  if (selected.some((target) => !target?.lastCrawledAt || target.lastCrawledAt < requestedAt)) {
    return undefined
  }
  const items: ExplicitPageWriteResult[] = selected.map((target, index) => ({
    url: urls[index] ?? '',
    status:
      target?.status === 'missing'
        ? 'missing'
        : target?.status === 'failed'
          ? 'failed'
          : 'unchanged',
    ...(target?.lastError ? { message: target.lastError } : {})
  }))
  return {
    runId: database.listCrawlHistory(sourceId)[0]?.id ?? '',
    items,
    progress: targetProgress(items)
  }
}

function targetProgress(items: readonly ExplicitPageWriteResult[]): CrawlProgress {
  return {
    queued: items.length,
    processed: items.length,
    succeeded: items.filter((item) => !['missing', 'failed'].includes(item.status)).length,
    failed: items.filter((item) => ['missing', 'failed'].includes(item.status)).length,
    limitReached: false
  }
}

function addInvalidProgress(progress: CrawlProgress, count: number): CrawlProgress {
  return {
    ...progress,
    queued: progress.queued + count,
    processed: progress.processed + count,
    failed: progress.failed + count
  }
}

export function mergeExplicitPageProgress(
  progress: CrawlProgress,
  pages: readonly ExplicitPageResult[]
): CrawlProgress {
  return pages.length ? mergeCrawlProgress(progress, explicitPageProgress(pages)) : progress
}

export function mergeCrawlProgress(first: CrawlProgress, second: CrawlProgress): CrawlProgress {
  const failures = [...(first.failures ?? []), ...(second.failures ?? [])]
  return {
    queued: first.queued + second.queued,
    processed: first.processed + second.processed,
    succeeded: first.succeeded + second.succeeded,
    failed: first.failed + second.failed,
    limitReached: first.limitReached || second.limitReached,
    ...(failures.length ? { failures } : {}),
    ...(second.node ? { node: second.node } : {})
  }
}

/** 三种入口共用指定页面的来源设置、浏览器和逐页进度适配。 */
export function fetchSourceExplicitPages(options: {
  database: LociDatabase
  browser: LocalBrowserCrawler
  source: SourceConfig
  urls: readonly string[]
  fetchMode?: SourceFetchMode
  onBrowserMissing?: BrowserInstallPrompt
  signal?: AbortSignal
  onProgress?: (progress: CrawlProgress) => void
}): ReturnType<typeof fetchExplicitPages> {
  const fetchMode = options.fetchMode ?? options.source.fetchMode
  const policy = options.database.getHostnameCrawlPolicy(options.source.hostname)
  const settings = options.database.getSettings()
  return fetchExplicitPages({
    urls: options.urls,
    hostname: options.source.hostname,
    excludePathPattern: options.source.excludePathPattern,
    fetchMode,
    concurrency:
      fetchMode === 'browser'
        ? (options.source.browserConcurrency ??
          policy?.browserConcurrency ??
          settings.browserConcurrency)
        : (options.source.httpConcurrency ?? policy?.httpConcurrency ?? settings.httpConcurrency),
    maxRetries: settings.maxRetries,
    signal: options.signal,
    onProgress: options.onProgress,
    crawler: {
      fetchPage: (url, request) => options.browser.fetchPage(url, request)
    },
    beforeBrowserCrawl: () => options.browser.ensureInstalled(options.onBrowserMissing)
  })
}
