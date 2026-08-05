import { crawlHttpSource, fetchHttpPage, getHostname, normalizeUrl } from './crawl.js'
import { crawlLlmsSource, discoverLlmsEntries } from './llms.js'
import { selectFetchMode } from './mode.js'
import { crawlRenderedSource, fetchCrawledPageWithRetry, type RenderedCrawler } from './rendered.js'
import type { CrawledPage, CrawlProgress, HttpCrawlOptions } from './types.js'

export type SourceFetchMode = 'auto' | 'http' | 'browser'

export interface SourceResolution {
  firstUrl: string
  hostname: string
  fetchMode: Exclude<SourceFetchMode, 'auto'>
  iconUrl: string | null
  discovery: 'llms' | 'pages'
}

export interface SourceCrawlResult {
  progress: CrawlProgress
  resolution: SourceResolution
}

export interface SourceCrawlOptions extends Omit<HttpCrawlOptions, 'concurrency' | 'seedPage'> {
  fetchMode: SourceFetchMode
  httpConcurrency?: number
  browserConcurrency?: number
  crawler?: RenderedCrawler
  beforeBrowserCrawl?: () => Promise<void>
  onResolved?: (resolution: SourceResolution) => Promise<void> | void
}

/** 文档源抓取的通用编排；桌面端和服务端只注入不同的浏览器实现。 */
export async function crawlSource(options: SourceCrawlOptions): Promise<SourceCrawlResult> {
  const scopePath = options.scopePath ?? '/'
  if (options.fetchMode === 'browser') await options.beforeBrowserCrawl?.()
  const llmsEntries = await discoverLlmsEntries(
    options.firstUrl,
    options.hostname,
    scopePath,
    options.pageLimit,
    { fetchImpl: options.fetch }
  )
  if (llmsEntries.length) {
    const resolution: SourceResolution = {
      firstUrl: options.firstUrl,
      hostname: options.hostname,
      fetchMode: 'http',
      iconUrl: new URL('/favicon.ico', options.firstUrl).toString(),
      discovery: 'llms'
    }
    await options.onResolved?.(resolution)
    const progress = await crawlLlmsSource(
      toCrawlOptions(options, resolution, {
        concurrency: options.httpConcurrency ?? 9,
        firstNodeId: options.firstNodeId ?? options.firstUrl
      }),
      llmsEntries
    )
    return { progress, resolution }
  }

  const selected = await readFirstPage(options)
  const firstUrl = normalizeUrl(selected.firstPage.url || options.firstUrl)
  const resolution: SourceResolution = {
    firstUrl,
    hostname: getHostname(firstUrl),
    fetchMode: selected.fetchMode,
    iconUrl: selected.firstPage.page?.iconUrl ?? null,
    discovery: 'pages'
  }
  await options.onResolved?.(resolution)
  const crawlOptions = toCrawlOptions(options, resolution, {
    concurrency:
      selected.fetchMode === 'http'
        ? (options.httpConcurrency ?? 9)
        : (options.browserConcurrency ?? 5),
    firstNodeId: options.firstNodeId ?? options.firstUrl,
    seedPage: selected.firstPage
  })
  const progress =
    selected.fetchMode === 'http'
      ? await crawlHttpSource(crawlOptions)
      : await crawlRenderedSource({
          ...crawlOptions,
          crawler: requireCrawler(options),
          maxRetries: options.maxRetries
        })
  return { progress, resolution }
}

async function readFirstPage(options: SourceCrawlOptions): Promise<{
  fetchMode: SourceResolution['fetchMode']
  firstPage: CrawledPage
}> {
  if (options.fetchMode === 'http' || !options.crawler) {
    if (options.fetchMode === 'browser') throw new Error('当前环境没有可用的浏览器抓取器')
    return {
      fetchMode: 'http',
      firstPage: await fetchHttpPage(options.firstUrl, {
        fetchImpl: options.fetch,
        maxRetries: options.maxRetries,
        sleep: options.sleep
      })
    }
  }
  if (options.fetchMode === 'browser') {
    return {
      fetchMode: 'browser',
      firstPage: await fetchBrowserEntry(options)
    }
  }

  await options.beforeBrowserCrawl?.()
  const [httpResult, browserResult] = await Promise.allSettled([
    fetchHttpPage(options.firstUrl, {
      fetchImpl: options.fetch,
      maxRetries: options.maxRetries,
      sleep: options.sleep
    }),
    fetchBrowserEntry(options)
  ])
  return selectAutoResult(httpResult, browserResult)
}

function selectAutoResult(
  httpResult: PromiseSettledResult<CrawledPage>,
  browserResult: PromiseSettledResult<CrawledPage>
): { fetchMode: SourceResolution['fetchMode']; firstPage: CrawledPage } {
  const httpPage = httpResult.status === 'fulfilled' ? httpResult.value : undefined
  const browserPage = browserResult.status === 'fulfilled' ? browserResult.value : undefined
  if (httpPage?.page && browserPage?.page) {
    const fetchMode = selectFetchMode(httpPage.page, browserPage.page)
    return { fetchMode, firstPage: fetchMode === 'http' ? httpPage : browserPage }
  }
  if (httpPage?.page) return { fetchMode: 'http', firstPage: httpPage }
  if (browserPage?.page) return { fetchMode: 'browser', firstPage: browserPage }
  if (httpPage) return { fetchMode: 'http', firstPage: httpPage }
  if (browserPage) return { fetchMode: 'browser', firstPage: browserPage }
  throw new Error(
    `第一个页面的 HTTP 与浏览器抓取均失败：HTTP：${failureMessage(httpResult)}；浏览器：${failureMessage(browserResult)}`
  )
}

function failureMessage(result: PromiseSettledResult<CrawledPage>): string {
  if (result.status === 'fulfilled') return `页面返回 HTTP ${result.value.status}`
  return result.reason instanceof Error ? result.reason.message : '请求失败'
}

function fetchBrowserEntry(options: SourceCrawlOptions): Promise<CrawledPage> {
  return fetchCrawledPageWithRetry(
    requireCrawler(options),
    options.firstUrl,
    {},
    {
      maxRetries: options.maxRetries,
      sleep: options.sleep
    }
  )
}

function requireCrawler(options: SourceCrawlOptions): RenderedCrawler {
  if (!options.crawler) throw new Error('当前环境没有可用的浏览器抓取器')
  return options.crawler
}

function toCrawlOptions(
  options: SourceCrawlOptions,
  resolution: SourceResolution,
  overrides: Pick<HttpCrawlOptions, 'concurrency' | 'firstNodeId'> &
    Partial<Pick<HttpCrawlOptions, 'seedPage'>>
): HttpCrawlOptions {
  return {
    firstUrl: resolution.firstUrl,
    firstNodeId: overrides.firstNodeId,
    hostname: resolution.hostname,
    scopePath: options.scopePath,
    pageLimit: options.pageLimit,
    initialUrls: options.initialUrls,
    seedPage: overrides.seedPage,
    concurrency: overrides.concurrency,
    fetch: options.fetch,
    sleep: options.sleep,
    maxRetries: options.maxRetries,
    batchIntervalMs: options.batchIntervalMs,
    waitIfPaused: options.waitIfPaused,
    onDocument: options.onDocument,
    onError: options.onError,
    onProgress: options.onProgress
  }
}
