import {
  classifyExplicitPageUrls,
  fetchExplicitPages,
  type CrawlProgress,
  type ExplicitPageResult,
  type SourceFetchMode
} from '@loci/core'
import type { LocalBrowserCrawler, BrowserInstallPrompt } from './browser-crawler.js'
import type { LociDatabase, SourceConfig } from './database.js'
import type { ExplicitPageWriteResult } from './explicit-page-database.js'
import { waitForCrawlLockRelease, waitForExternalCrawl } from './external-crawl.js'
import { RuntimeLockedError, acquireCrawlRuntimeLock, readRuntimeLock } from './runtime-lock.js'

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
  reportInvalidPages(invalid, checked.length, onProgress)
  if (!urls.length) return { items: invalid, progress: targetProgress(invalid) }
  const requestedAt = new Date().toISOString()
  options.database.registerExplicitPageTargets(sourceId, urls)
  const fetched = await acquireAndFetch(
    options,
    sourceId,
    urls,
    requestedAt,
    onBrowserMissing,
    signal,
    invalid.length,
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
  requestedAt: string,
  onBrowserMissing?: BrowserInstallPrompt,
  signal?: AbortSignal,
  invalidCount = 0,
  onProgress?: (progress: CrawlProgress) => void
): Promise<ExplicitPageFetchResult> {
  let lock
  try {
    lock = acquireCrawlRuntimeLock(options.dataDir, sourceId, `${options.owner} 指定页面抓取`)
  } catch (error) {
    if (!(error instanceof RuntimeLockedError)) throw error
    if (!readRuntimeLock(options.dataDir, `crawl-${sourceId}`)) throw error
    try {
      await waitForExternalCrawl(options.database, sourceId, undefined, signal)
    } catch (waitError) {
      if (signal?.aborted) throw waitError
      // 现有整库任务失败也不应吞掉本次指定页面请求，锁释放后继续补抓。
    }
    await waitForCrawlLockRelease(options.dataDir, sourceId, signal)
    const covered = resultFromRecentTargets(options.database, sourceId, urls, requestedAt)
    if (covered) {
      return invalidCount
        ? { ...covered, progress: addInvalidProgress(covered.progress, invalidCount) }
        : covered
    }
    return acquireAndFetch(
      options,
      sourceId,
      urls,
      requestedAt,
      onBrowserMissing,
      signal,
      invalidCount,
      onProgress
    )
  }

  const runId = options.database.startCrawlRun(sourceId)
  const initial: CrawlProgress = {
    queued: urls.length + invalidCount,
    processed: invalidCount,
    succeeded: 0,
    failed: invalidCount,
    limitReached: false
  }
  let latestProgress = initial
  options.database.updateCrawlRunProgress(runId, initial)
  try {
    const source = options.database.getSourceConfig(sourceId)
    const reportProgress = (progress: CrawlProgress): void => {
      latestProgress = invalidCount ? addInvalidProgress(progress, invalidCount) : progress
      options.database.updateCrawlRunProgress(runId, latestProgress)
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
    const items = options.database.commitExplicitPageResults(
      sourceId,
      result.items,
      result.fetchMode,
      result.iconUrl
    )
    const fetchedProgress = explicitPageProgress(result.items)
    const progress = invalidCount
      ? addInvalidProgress(fetchedProgress, invalidCount)
      : fetchedProgress
    options.database.finishCrawlRun(runId, 'completed', progress, null)
    return { runId, items, progress }
  } catch (error) {
    const message = error instanceof Error ? error.message : '指定页面抓取失败'
    if (!signal?.aborted) options.database.markExplicitPageTargetsFailed(sourceId, urls, message)
    options.database.finishCrawlRun(runId, 'failed', latestProgress, message)
    throw error
  } finally {
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
  const settings = options.database.getSettings()
  const fetchMode = options.fetchMode ?? options.source.fetchMode
  return fetchExplicitPages({
    urls: options.urls,
    hostname: options.source.hostname,
    excludePathPattern: options.source.excludePathPattern,
    fetchMode,
    concurrency:
      fetchMode === 'browser'
        ? (options.source.browserConcurrency ?? settings.browserConcurrency)
        : (options.source.httpConcurrency ?? settings.httpConcurrency),
    maxRetries: settings.maxRetries,
    signal: options.signal,
    onProgress: options.onProgress,
    crawler: {
      fetchPage: (url, request) => options.browser.fetchPage(url, request)
    },
    beforeBrowserCrawl: () => options.browser.ensureInstalled(options.onBrowserMissing)
  })
}
