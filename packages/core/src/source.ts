import {
  createPathExclusionMatcher,
  DOCUMENT_SOURCE_LIMITS,
  parseGithubRepositoryUrl,
  type ResolvedSourceDiscovery,
  type SourceKind
} from '@loci/shared'
import {
  crawlHttpSource,
  fetchHttpPage,
  getHostname,
  isImmediateStaticHostname,
  normalizeUrl
} from './crawl.js'
import { throwIfAborted } from './abort.js'
import { crawlLlmsSource, discoverLlmsEntries } from './llms.js'
import { crawlGithubSource } from './github-source.js'
import type { GithubBlockedState } from './github-limits.js'
import { selectFetchMode } from './mode.js'
import { crawlOpenApiSource, discoverOpenApiEntries } from './openapi.js'
import { crawlRenderedSource, fetchCrawledPageWithRetry, type RenderedCrawler } from './rendered.js'
import type { CrawledDocument, CrawledPage, CrawlProgress, HttpCrawlOptions } from './types.js'

export type SourceFetchMode = 'auto' | 'http' | 'browser'

export interface SourceResolution {
  firstUrl: string
  hostname: string
  fetchMode: Exclude<SourceFetchMode, 'auto'>
  iconUrl: string | null
  discovery: ResolvedSourceDiscovery
  github?: {
    defaultBranch: string
    revision: string
  }
}

export interface SourceCrawlResult {
  progress: CrawlProgress
  resolution: SourceResolution
}

export interface SourceCrawlOptions extends Omit<HttpCrawlOptions, 'concurrency' | 'seedPage'> {
  kind?: SourceKind
  fetchMode: SourceFetchMode
  httpConcurrency?: number
  browserConcurrency?: number
  crawler?: RenderedCrawler
  beforeBrowserCrawl?: () => Promise<void>
  onResolved?: (resolution: SourceResolution) => Promise<void> | void
  onSnapshot?: (documents: CrawledDocument[]) => Promise<void> | void
  githubArchiveLimitBytes?: number
  githubMarkdownLimitBytes?: number
  githubPreviousRevision?: string | null
  githubBlocked?: GithubBlockedState | null
}

/** 文档源抓取的通用编排；本地服务和远端 Server 只注入不同的浏览器实现。 */
export async function crawlSource(options: SourceCrawlOptions): Promise<SourceCrawlResult> {
  throwIfAborted(options.signal)
  const scopePath = options.scopePath ?? '/'
  const githubRepository = parseGithubRepositoryUrl(options.firstUrl)
  const kind = options.kind ?? (githubRepository ? 'github' : 'web')
  if (kind === 'github') {
    if (!githubRepository) throw new Error('GitHub 文档源必须使用公开仓库首页 URL')
    const result = await crawlGithubSource({
      repository: githubRepository,
      pageLimit: options.pageLimit,
      archiveLimitBytes: options.githubArchiveLimitBytes,
      markdownLimitBytes: options.githubMarkdownLimitBytes,
      previousRevision: options.githubPreviousRevision,
      blocked: options.githubBlocked,
      fetch: options.fetch,
      signal: options.signal,
      onProgress: options.onProgress
    })
    const resolution: SourceResolution = {
      firstUrl: githubRepository.url,
      hostname: 'github.com',
      fetchMode: 'http',
      iconUrl: 'https://github.com/favicon.ico',
      discovery: 'github',
      github: { defaultBranch: result.defaultBranch, revision: result.revision }
    }
    if (!result.unchanged) {
      throwIfAborted(options.signal)
      if (options.onSnapshot) await options.onSnapshot(result.documents)
      else for (const document of result.documents) await options.onDocument(document)
    }
    throwIfAborted(options.signal)
    await options.onResolved?.(resolution)
    return { progress: result.progress, resolution }
  }
  if (options.fetchMode === 'browser') await options.beforeBrowserCrawl?.()
  const llmsEntries = await discoverLlmsEntries(
    options.firstUrl,
    options.hostname,
    scopePath,
    options.excludePathPattern ? DOCUMENT_SOURCE_LIMITS.pageLimit.max : options.pageLimit,
    { fetchImpl: options.fetch, signal: options.signal }
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
      filterExcludedEntries(llmsEntries, options.excludePathPattern)
    )
    return { progress, resolution }
  }

  if (!isImmediateStaticHostname(options.hostname)) {
    const openApiEntries = await discoverOpenApiEntries(options.firstUrl, options.hostname, {
      fetchImpl: options.fetch,
      signal: options.signal
    })
    if (openApiEntries.length) {
      const resolution: SourceResolution = {
        firstUrl: options.firstUrl,
        hostname: options.hostname,
        fetchMode: 'http',
        iconUrl: new URL('/favicon.ico', options.firstUrl).toString(),
        discovery: 'openapi'
      }
      await options.onResolved?.(resolution)
      const progress = await crawlOpenApiSource(
        toCrawlOptions(options, resolution, {
          concurrency: options.httpConcurrency ?? 9,
          firstNodeId: options.firstNodeId ?? options.firstUrl
        }),
        filterExcludedEntries(openApiEntries, options.excludePathPattern)
      )
      return { progress, resolution }
    }
  }

  const selected = await probeSourcePage(options)
  throwIfAborted(options.signal)
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

/** 只探测一个页面的抓取方式，不执行 Sitemap、llms.txt 或链接发现。 */
export async function probeSourcePage(options: SourceCrawlOptions): Promise<{
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
        sleep: options.sleep,
        signal: options.signal
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
      sleep: options.sleep,
      signal: options.signal
    }),
    fetchBrowserEntry(options)
  ])
  throwIfAborted(options.signal)
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
      sleep: options.sleep,
      signal: options.signal
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
    excludePathPattern: options.excludePathPattern,
    seedPage: overrides.seedPage,
    concurrency: overrides.concurrency,
    fetch: options.fetch,
    sleep: options.sleep,
    maxRetries: options.maxRetries,
    batchIntervalMs: options.batchIntervalMs,
    signal: options.signal,
    waitIfPaused: options.waitIfPaused,
    getBatchPolicy: options.getBatchPolicy,
    onCheckpoint: options.onCheckpoint,
    onDocument: options.onDocument,
    onDuplicate: options.onDuplicate,
    onError: options.onError,
    onProgress: options.onProgress
  }
}

function filterExcludedEntries<T extends { url: string }>(
  entries: readonly T[],
  pattern?: string | null
): T[] {
  const isExcluded = createPathExclusionMatcher(pattern)
  return isExcluded ? entries.filter((entry) => !isExcluded(entry.url)) : [...entries]
}
