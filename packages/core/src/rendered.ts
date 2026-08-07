import { abortableSleep, throwIfAborted } from './abort.js'
import { discoverSitemapUrls, isRetryableStatus, retryAfterMs, runCrawlQueue } from './crawl.js'
import type { CrawledPage, CrawlProgress, FetchOptions, HttpCrawlOptions } from './types.js'

export interface RenderedPageRequest {
  hostname?: string
  scopePath?: string
  signal?: AbortSignal
}

/** 平台只需要实现单页渲染，重试、队列和页面发现由核心包负责。 */
export interface RenderedCrawler {
  fetchPage(url: string, request: RenderedPageRequest): Promise<CrawledPage>
  withSession?<T>(action: (crawler: RenderedCrawler) => Promise<T>): Promise<T>
}

export interface RenderedCrawlOptions extends HttpCrawlOptions {
  crawler: RenderedCrawler
  maxRetries?: number
}

export interface StableContentOptions {
  timeoutMs?: number
  minimumWaitMs?: number
  shortContentWaitMs?: number
  minimumContentLength?: number
  intervalMs?: number
  stableChecks?: number
  isIdle?: () => boolean | Promise<boolean>
  sleep?: (milliseconds: number) => Promise<void>
  now?: () => number
  signal?: AbortSignal
}

export async function fetchCrawledPageWithRetry(
  crawler: RenderedCrawler,
  url: string,
  request: RenderedPageRequest,
  options: Pick<FetchOptions, 'maxRetries' | 'sleep' | 'signal'> = {}
): Promise<CrawledPage> {
  const maxRetries = options.maxRetries ?? 3
  const sleep = options.sleep ?? defaultSleep

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    throwIfAborted(options.signal)
    try {
      const page = await crawler.fetchPage(url, { ...request, signal: options.signal })
      throwIfAborted(options.signal)
      if (!isRetryableStatus(page.status) || attempt === maxRetries) return page
      await abortableSleep(retryAfterMs(page.retryAfter ?? null), options.signal, sleep)
    } catch (error) {
      throwIfAborted(options.signal)
      if (attempt === maxRetries) throw error
      await abortableSleep(0, options.signal, sleep)
    }
  }
  throw new Error('浏览器抓取任务未返回结果')
}

export async function crawlRenderedSource(options: RenderedCrawlOptions): Promise<CrawlProgress> {
  const sitemapUrls = await discoverSitemapUrls(
    options.firstUrl,
    options.hostname,
    options.pageLimit,
    {
      fetchImpl: options.fetch,
      maxRetries: options.maxRetries,
      sleep: options.sleep,
      signal: options.signal
    },
    options.scopePath
  )
  const run = (crawler: RenderedCrawler): Promise<CrawlProgress> => {
    const request = {
      hostname: options.hostname,
      scopePath: options.scopePath,
      signal: options.signal
    }
    return runCrawlQueue({
      ...options,
      concurrency: options.concurrency ?? 5,
      fetchMode: 'browser',
      sitemapUrls,
      fetchPage: (url) =>
        fetchCrawledPageWithRetry(crawler, url, request, {
          maxRetries: options.maxRetries,
          sleep: options.sleep,
          signal: options.signal
        })
    })
  }
  return options.crawler.withSession ? options.crawler.withSession(run) : run(options.crawler)
}

/** 等待正文稳定；空正文不会被提前当成渲染完成。 */
export async function waitForStableContent(
  readContent: () => Promise<string>,
  options: StableContentOptions = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 8_000
  const minimumWaitMs = options.minimumWaitMs ?? 1_000
  const shortContentWaitMs = options.shortContentWaitMs ?? 3_000
  const minimumContentLength = options.minimumContentLength ?? 80
  const intervalMs = options.intervalMs ?? 250
  const requiredStableChecks = options.stableChecks ?? 3
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now
  const startedAt = now()
  let previous: string | undefined
  let stableChecks = 0

  while (true) {
    throwIfAborted(options.signal)
    const current = await readContent()
    const elapsed = now() - startedAt
    const normalized = current.replace(/\s+/gu, ' ').trim()
    const contentReady =
      normalized.length >= minimumContentLength ||
      (elapsed >= shortContentWaitMs && !isLoadingPlaceholder(normalized))
    const idle = (await options.isIdle?.()) ?? true
    stableChecks =
      previous !== undefined && current === previous && contentReady && idle ? stableChecks + 1 : 0
    previous = current
    if (elapsed >= minimumWaitMs && stableChecks >= requiredStableChecks) return
    if (elapsed >= timeoutMs) return
    await abortableSleep(Math.min(intervalMs, timeoutMs - elapsed), options.signal, sleep)
  }
}

function isLoadingPlaceholder(content: string): boolean {
  if (content.length > 200) return false
  return /^(?:loading|loading\.{1,3}|加载中|正在加载|请稍候|please wait)[.!…\s]*$/iu.test(content)
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
