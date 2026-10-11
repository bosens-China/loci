import { parse } from 'node-html-parser'
import { setTimeout as wait } from 'node:timers/promises'
import { htmlToMarkdown } from 'mdream'
import {
  createPathExclusionMatcher,
  deriveUrlPathTitle,
  DOCUMENT_SOURCE_LIMITS
} from '@loci/shared'
import { abortableSleep, throwIfAborted } from './abort.js'
import { CRAWL_EXECUTION_DEFAULTS, executeCrawlTasks } from './crawl-executor.js'
import { fetchWithRetry, isRetryableStatus, retryAfterMs } from './retry.js'
export { fetchWithRetry, isRetryableStatus, retryAfterMs } from './retry.js'
import { discoverSitemapUrls } from './sitemap.js'
export { discoverSitemapUrls, parseSitemap } from './sitemap.js'
import { isUrlInScope } from './scope.js'
import type {
  CrawledDocument,
  CrawledPage,
  CrawlFailure,
  CrawlNode,
  CrawlProgress,
  FetchOptions,
  HttpCrawlOptions,
  ParsedPage
} from './types.js'
import { normalizeUrl } from './url.js'
export { getHostname, isAllowedNavigation, isSameHostname, normalizeUrl } from './url.js'

export type {
  CrawledDocument,
  CrawledPage,
  CrawlCheckpoint,
  CrawlDuplicate,
  CrawlFailure,
  CrawlNode,
  CrawlProgress,
  FetchOptions,
  HttpCrawlOptions,
  ParsedPage
} from './types.js'

interface CrawlRunnerOptions extends HttpCrawlOptions {
  concurrency: number
  fetchMode: CrawledDocument['fetchMode']
  sitemapUrls?: readonly string[]
  followPageLinks?: boolean
  fetchPage: (url: string) => Promise<CrawledPage>
}

interface QueueItem {
  id: string
  url: string
  parentId?: string
}

interface SlashContentCandidate {
  url: string
  markdown: string
  saved: Promise<void>
}

export function isImmediateStaticHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/u, '')
  return ['.github.io', '.gitlab.io'].some((suffix) => normalized.endsWith(suffix))
}

export function parsePage(html: string, pageUrl: string): ParsedPage {
  const root = parse(html)
  const title = root.querySelector('title')?.text.trim() || new URL(pageUrl).hostname
  const language = root.querySelector('html')?.getAttribute('lang')?.trim() || 'und'
  const iconHref = root
    .querySelectorAll('link')
    .find((link) => link.getAttribute('rel')?.toLowerCase().split(/\s+/).includes('icon'))
    ?.getAttribute('href')
  const iconUrl =
    (iconHref && resolveLink(iconHref, pageUrl)) ?? new URL('/favicon.ico', pageUrl).toString()
  const linkCandidates = root.querySelectorAll('a').flatMap((link) => {
    const href = link.getAttribute('href')
    const url = href ? resolveLink(href, pageUrl) : undefined
    if (!url) return []
    const label =
      link.getAttribute('aria-label')?.trim() ||
      link.getAttribute('title')?.trim() ||
      link.text.trim()
    return [
      {
        url,
        title: label || deriveUrlPathTitle(url),
        titleSource: label ? ('link_text' as const) : ('pathname' as const)
      }
    ]
  })
  const uniqueCandidates = [
    ...new Map(linkCandidates.map((candidate) => [candidate.url, candidate])).values()
  ]

  root
    .querySelectorAll('script, style, nav, footer, header, aside, noscript')
    .forEach((node) => node.remove())
  const content =
    root.querySelector('main') ??
    root.querySelector('article') ??
    root.querySelector('body') ??
    root
  return {
    title,
    language,
    markdown: htmlToMarkdown(content.innerHTML).trim(),
    links: uniqueCandidates.map((candidate) => candidate.url),
    linkCandidates: uniqueCandidates,
    iconUrl
  }
}

function resolveLink(href: string, baseUrl: string): string | undefined {
  try {
    return normalizeUrl(new URL(href, baseUrl).toString())
  } catch {
    return undefined
  }
}

export async function fetchHttpPage(
  url: string,
  options: Pick<FetchOptions, 'fetchImpl' | 'maxRetries' | 'sleep' | 'signal'> = {}
): Promise<CrawledPage> {
  const response = await fetchWithRetry(url, options)
  throwIfAborted(options.signal)
  const finalUrl = normalizeUrl(response.url || url)
  const body = response.ok ? await response.text() : undefined
  throwIfAborted(options.signal)
  return {
    url: finalUrl,
    status: response.status,
    retryAfter: response.headers.get('retry-after'),
    ...(body === undefined ? {} : { page: parsePage(body, finalUrl) })
  }
}

export async function crawlHttpSource(options: HttpCrawlOptions): Promise<CrawlProgress> {
  const sitemapDiscoveryLimit = options.excludePathPattern
    ? DOCUMENT_SOURCE_LIMITS.pageLimit.max
    : options.pageLimit
  const sitemapUrls = await discoverSitemapUrls(
    options.firstUrl,
    options.hostname,
    sitemapDiscoveryLimit,
    {
      fetchImpl: options.fetch,
      maxRetries: options.maxRetries,
      sleep: options.sleep,
      signal: options.signal
    },
    options.scopePath
  )
  return runCrawlQueue({
    ...options,
    concurrency: options.concurrency ?? CRAWL_EXECUTION_DEFAULTS.httpConcurrency,
    fetchMode: 'http',
    sitemapUrls,
    followPageLinks: sitemapUrls.length === 0,
    fetchPage: (url) =>
      fetchHttpPage(url, {
        fetchImpl: options.fetch,
        maxRetries: 0,
        sleep: options.sleep,
        signal: options.signal
      })
  })
}

export async function runCrawlQueue(options: CrawlRunnerOptions): Promise<CrawlProgress> {
  const firstUrl = normalizeUrl(options.firstUrl)
  const firstNodeId = options.firstNodeId ?? firstUrl
  const queue: QueueItem[] = []
  const seen = new Set<string>()
  const slashCandidates = new Map<string, SlashContentCandidate>()
  const isExcluded = createPathExclusionMatcher(options.excludePathPattern)
  let limitReached = false

  const enqueue = (input: string, parentId?: string, id?: string): QueueItem | undefined => {
    let url: string
    try {
      url = normalizeUrl(input)
      if (
        !isUrlInScope(url, options.hostname, options.scopePath) ||
        isExcluded?.(url) ||
        seen.has(url)
      ) {
        return undefined
      }
    } catch {
      return undefined
    }
    if (seen.size >= options.pageLimit) {
      limitReached = true
      return undefined
    }
    seen.add(url)
    const item = { id: id ?? url, url, ...(parentId ? { parentId } : {}) }
    queue.push(item)
    return item
  }

  if (isExcluded?.(firstUrl)) throw new Error('起始页面被排除路径正则命中')
  enqueue(firstUrl, undefined, firstNodeId)
  for (const url of options.sitemapUrls ?? []) enqueue(url, firstNodeId)
  for (const url of options.initialUrls ?? []) enqueue(url)

  const progress: CrawlProgress = {
    queued: queue.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    limitReached
  }
  const failures: CrawlFailure[] = []
  let seedPage = options.seedPage
  const processPage = async (
    item: QueueItem,
    addTask: (item: QueueItem) => Promise<void>
  ): Promise<void> => {
    throwIfAborted(options.signal)
    const node: CrawlNode = {
      id: item.id,
      url: item.url,
      title: item.url,
      status: 'running',
      ...(item.parentId ? { parentId: item.parentId } : {})
    }
    options.onProgress?.({ ...progress, node: { ...node } })

    let failure: (CrawlFailure & { missing?: boolean }) | undefined
    try {
      const result = seedPage?.url === item.url ? seedPage : await options.fetchPage(item.url)
      if (result === seedPage) seedPage = undefined
      const page = result.page
      if (isRetryableStatus(result.status)) {
        throw new PageRequestError(result.status, result.retryAfter)
      }
      node.url = normalizeUrl(result.url)
      if (!isUrlInScope(node.url, options.hostname, options.scopePath)) {
        failure = {
          url: item.url,
          reason: 'out_of_scope_redirect',
          message: '页面跳转到了文档库范围之外',
          retryable: false,
          redirectUrl: node.url
        }
      } else if (isExcluded?.(node.url)) {
        failure = {
          url: item.url,
          reason: 'out_of_scope_redirect',
          message: '页面跳转到了排除路径',
          retryable: false,
          redirectUrl: node.url
        }
      }
      if (!failure && (result.status === 404 || result.status === 410)) {
        failure = {
          url: item.url,
          reason: 'not_found',
          message: `页面返回 HTTP ${result.status}`,
          retryable: false,
          statusCode: result.status,
          missing: true
        }
      } else if (!failure && (result.status < 200 || result.status >= 300 || !page)) {
        failure = {
          url: item.url,
          reason: 'http_error',
          message: result.status ? `页面返回 HTTP ${result.status}` : '页面未返回可解析内容',
          retryable:
            result.status === 0 ||
            result.status === 408 ||
            result.status === 429 ||
            result.status >= 500,
          ...(result.status ? { statusCode: result.status } : {})
        }
      } else if (!failure && page) {
        throwIfAborted(options.signal)
        node.title = page.title
        const slashKey = trailingSlashGroup(item.url)
        const candidate = slashKey ? slashCandidates.get(slashKey) : undefined
        const duplicate = candidate?.markdown === page.markdown
        if (duplicate && candidate) {
          await candidate.saved
          await options.onDuplicate?.({ url: node.url, duplicateOf: candidate.url })
        } else {
          const saved = Promise.resolve().then(() =>
            options.onDocument({
              url: node.url,
              title: page.title,
              language: page.language,
              markdown: page.markdown,
              crawledAt: new Date().toISOString(),
              fetchMode: options.fetchMode
            })
          )
          if (slashKey && !candidate) {
            // 写入完成前占位，避免并行处理斜杠变体时同时保存相同正文。
            slashCandidates.set(slashKey, { url: node.url, markdown: page.markdown, saved })
          }
          try {
            await saved
          } catch (error) {
            if (slashKey && slashCandidates.get(slashKey)?.saved === saved)
              slashCandidates.delete(slashKey)
            throw error
          }
        }
        progress.succeeded += 1
        node.status = 'success'
        if (!duplicate && options.followPageLinks !== false) {
          for (const link of page.links) {
            const next = enqueue(link, item.id)
            if (next) {
              progress.queued = queue.length
              await addTask(next)
            }
          }
        }
      }
    } catch (error) {
      throwIfAborted(options.signal)
      throw error
    }

    try {
      throwIfAborted(options.signal)
      if (failure) {
        failures.push(failure)
        progress.failed += 1
        progress.processed += 1
        node.status = 'failed'
        await options.onError?.(failure)
      } else {
        progress.processed += 1
      }
    } finally {
      progress.limitReached = limitReached
      options.onProgress?.({ ...progress, node: { ...node } })
    }
  }

  await executeCrawlTasks({
    tasks: [...queue],
    concurrency: options.concurrency,
    maxRetries: options.maxRetries,
    signal: options.signal,
    beforeRequest: options.waitIfPaused,
    onCheckpoint: (pendingUrls) => options.onCheckpoint?.({ pendingUrls }),
    handle: processPage,
    onRetry: (error) =>
      abortableSleep(
        error instanceof PageRequestError ? retryAfterMs(error.retryAfter ?? null) : 0,
        options.signal,
        options.sleep ?? ((ms, signal) => wait(ms, undefined, { signal }))
      ),
    onFailure: async (item, error) => {
      const failure: CrawlFailure = {
        url: item.url,
        reason: error instanceof PageRequestError ? 'http_error' : 'request_error',
        message: error.message,
        retryable: true,
        ...(error instanceof PageRequestError ? { statusCode: error.status } : {})
      }
      failures.push(failure)
      progress.failed += 1
      progress.processed += 1
      progress.limitReached = limitReached
      await options.onError?.(failure)
      options.onProgress?.({
        ...progress,
        node: { ...item, title: item.url, status: 'failed' }
      })
    }
  })
  const completed = failures.length ? { ...progress, failures } : progress
  options.onProgress?.(completed)
  return completed
}

class PageRequestError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter?: string | null
  ) {
    super(`页面返回 HTTP ${status}`)
  }
}

function trailingSlashGroup(input: string): string | undefined {
  const url = new URL(input)
  if (url.pathname === '/') return undefined
  url.pathname = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname
  return url.toString()
}
