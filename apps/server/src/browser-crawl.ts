import { lookup } from 'node:dns/promises'
import { isAllowedNavigation, normalizeUrl, parsePage, waitForStableContent } from '@loci/core'
import type { CrawledPage, RenderedCrawler, RenderedPageRequest } from '@loci/core'
import { chromium } from 'playwright-core'
import type { BrowserContext, Request, Route } from 'playwright-core'
import type { BrowserConfig } from './browser-config.js'
import { assertPublicUrl } from './public-fetch.js'
import type { DnsLookup } from './public-fetch.js'

interface BrowserOptions {
  lookup?: DnsLookup
}

/** 浏览器适配器复用一个抓取会话，核心包负责模式选择、重试和队列。 */
export function createBrowserCrawler(
  config: BrowserConfig,
  lookupImpl: DnsLookup = lookup
): RenderedCrawler {
  const options = { lookup: lookupImpl }
  const sessionCrawler = (context: BrowserContext): RenderedCrawler => ({
    fetchPage: (url, request) => fetchPage(context, url, request, options)
  })
  return {
    fetchPage: (url, request) =>
      withBrowser(config, (context) => fetchPage(context, url, request, options)),
    withSession: (action) => withBrowser(config, (context) => action(sessionCrawler(context)))
  }
}

export async function assertAllowedBrowserRequest(
  input: string,
  hostname: string | undefined,
  navigation: boolean,
  lookupImpl: DnsLookup = lookup,
  scopePath = '/'
): Promise<void> {
  const url = new URL(input)
  if (!navigation && (url.protocol === 'data:' || url.protocol === 'blob:')) return
  await assertPublicUrl(url, lookupImpl)
  if (navigation && hostname && !isAllowedNavigation(url.toString(), hostname, scopePath)) {
    throw new Error('页面导航超出了文档库范围')
  }
}

async function withBrowser<T>(
  config: BrowserConfig,
  action: (context: BrowserContext) => Promise<T>
): Promise<T> {
  const connection =
    config.provider === 'local'
      ? chromium.launch({ headless: true })
      : chromium.connect(config.endpoint, { timeout: 30_000 })
  const browser = await connection.catch(() => {
    throw new Error('无法连接浏览器服务')
  })
  const context = await browser.newContext({ acceptDownloads: false })
  try {
    return await action(context)
  } finally {
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
}

async function fetchPage(
  context: BrowserContext,
  url: string,
  request: RenderedPageRequest,
  options: BrowserOptions
): Promise<CrawledPage> {
  request.signal?.throwIfAborted()
  await assertAllowedBrowserRequest(url, request.hostname, true, options.lookup, request.scopePath)
  const page = await context.newPage()
  const abort = (): void => {
    void page.close().catch(() => undefined)
  }
  request.signal?.addEventListener('abort', abort, { once: true })
  const pendingRequests = new Set<Request>()
  page.on('request', (item) => {
    if (tracksContentRequest(item)) pendingRequests.add(item)
  })
  page.on('requestfinished', (item) => pendingRequests.delete(item))
  page.on('requestfailed', (item) => pendingRequests.delete(item))
  page.setDefaultTimeout(30_000)
  page.on('popup', (popup) => void popup.close())
  page.on('download', (download) => void download.cancel())
  await page.route('**/*', (route) => guardRoute(route, request, options))

  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const finalUrl = normalizeUrl(page.url() || url)
    const status = response?.status() ?? 0
    const retryAfter = (await response?.headerValue('retry-after')) ?? null
    if (
      status < 200 ||
      status >= 300 ||
      (request.hostname && !isAllowedNavigation(finalUrl, request.hostname, request.scopePath))
    ) {
      return { url: finalUrl, status, retryAfter }
    }
    await waitForStableContent(() => page.evaluate(() => document.body?.innerText ?? ''), {
      isIdle: () => pendingRequests.size === 0,
      signal: request.signal
    })
    request.signal?.throwIfAborted()
    return {
      url: finalUrl,
      status,
      retryAfter,
      page: parsePage(await page.content(), finalUrl)
    }
  } finally {
    request.signal?.removeEventListener('abort', abort)
    await page.close().catch(() => undefined)
  }
}

function tracksContentRequest(request: Request): boolean {
  return ['document', 'script', 'fetch', 'xhr'].includes(request.resourceType())
}

async function guardRoute(
  route: Route,
  requestOptions: RenderedPageRequest,
  options: BrowserOptions
): Promise<void> {
  const request = route.request()
  try {
    await assertAllowedBrowserRequest(
      request.url(),
      requestOptions.hostname,
      request.isNavigationRequest(),
      options.lookup,
      requestOptions.scopePath
    )
    await route.continue()
  } catch {
    await route.abort('blockedbyclient').catch(() => undefined)
  }
}
