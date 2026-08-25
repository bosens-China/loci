import {
  classifyExplicitPageUrls,
  fetchExplicitPages,
  type CrawlProgress,
  type ExplicitPageResult
} from '@loci/core'
import type { LocalBrowserCrawler, BrowserInstallPrompt } from './browser-crawler.js'
import type { LociDatabase } from './database.js'
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
  signal?: AbortSignal
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
  if (!urls.length) return { items: invalid, progress: targetProgress(invalid) }
  const requestedAt = new Date().toISOString()
  options.database.registerExplicitPageTargets(sourceId, urls)
  const fetched = await acquireAndFetch(
    options,
    sourceId,
    urls,
    requestedAt,
    onBrowserMissing,
    signal
  )
  if (!invalid.length) return fetched
  const byUrl = new Map([...fetched.items, ...invalid].map((item) => [item.url, item]))
  const items = checked.flatMap((item) => {
    const result = byUrl.get(item.url)
    return result ? [result] : []
  })
  return {
    ...fetched,
    items,
    progress: addInvalidProgress(fetched.progress, invalid.length)
  }
}

async function acquireAndFetch(
  options: ExplicitPageServiceOptions,
  sourceId: string,
  urls: readonly string[],
  requestedAt: string,
  onBrowserMissing?: BrowserInstallPrompt,
  signal?: AbortSignal
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
    if (covered) return covered
    return acquireAndFetch(options, sourceId, urls, requestedAt, onBrowserMissing, signal)
  }

  const runId = options.database.startCrawlRun(sourceId)
  const initial: CrawlProgress = {
    queued: urls.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    limitReached: false
  }
  options.database.updateCrawlRunProgress(runId, initial)
  try {
    const source = options.database.getSourceConfig(sourceId)
    const settings = options.database.getSettings()
    const result = await fetchExplicitPages({
      urls,
      hostname: source.hostname,
      excludePathPattern: source.excludePathPattern,
      fetchMode: source.fetchMode,
      concurrency:
        source.fetchMode === 'browser'
          ? (source.browserConcurrency ?? settings.browserConcurrency)
          : (source.httpConcurrency ?? settings.httpConcurrency),
      maxRetries: settings.maxRetries,
      signal,
      crawler: { fetchPage: (url, request) => options.browser.fetchPage(url, request) },
      beforeBrowserCrawl: () => options.browser.ensureInstalled(onBrowserMissing)
    })
    const items = options.database.commitExplicitPageResults(
      sourceId,
      result.items,
      result.fetchMode,
      result.iconUrl
    )
    const progress = toProgress(result.items)
    options.database.finishCrawlRun(runId, 'completed', progress, null)
    return { runId, items, progress }
  } catch (error) {
    const message = error instanceof Error ? error.message : '指定页面抓取失败'
    if (!signal?.aborted) options.database.markExplicitPageTargetsFailed(sourceId, urls, message)
    options.database.finishCrawlRun(runId, 'failed', initial, message)
    throw error
  } finally {
    lock.release()
  }
}

function toProgress(items: readonly ExplicitPageResult[]): CrawlProgress {
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
  if (!pages.length) return progress
  const failures = pages.flatMap((page) => (page.failure ? [page.failure] : []))
  return {
    queued: progress.queued + pages.length,
    processed: progress.processed + pages.length,
    succeeded: progress.succeeded + pages.filter((page) => page.status === 'fetched').length,
    failed: progress.failed + pages.filter((page) => page.status !== 'fetched').length,
    limitReached: progress.limitReached,
    ...(progress.failures?.length || failures.length
      ? { failures: [...(progress.failures ?? []), ...failures] }
      : {})
  }
}
