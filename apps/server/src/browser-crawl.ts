import { lookup } from 'node:dns/promises'
import {
  discoverSitemapUrls,
  isSameHostname,
  normalizeUrl,
  parsePage,
  runCrawlQueue
} from '@loci/core'
import type { CrawledPage, CrawlProgress, HttpCrawlOptions } from '@loci/core'
import { chromium } from 'playwright-core'
import type { BrowserContext, Page, Route } from 'playwright-core'
import { assertPublicUrl } from './public-fetch.js'
import type { DnsLookup } from './public-fetch.js'

interface BrowserOptions {
  endpoint: string
  hostname: string
  lookup?: DnsLookup
}

interface BrowserCrawlOptions extends HttpCrawlOptions, BrowserOptions {}

/** 使用独立 Browserless 会话抓取一个渲染后的页面。 */
export async function fetchRenderedPage(
  url: string,
  options: BrowserOptions
): Promise<CrawledPage> {
  return withBrowser(options.endpoint, (context) => fetchPage(context, url, options))
}

/** 浏览器只负责渲染，队列、解析和失败处理继续复用共享核心包。 */
export async function crawlRenderedSource(options: BrowserCrawlOptions): Promise<CrawlProgress> {
  const sitemapUrls = await discoverSitemapUrls(
    options.firstUrl,
    options.hostname,
    options.pageLimit,
    { fetchImpl: options.fetch, sleep: options.sleep }
  )
  return withBrowser(options.endpoint, (context) =>
    runCrawlQueue({
      ...options,
      concurrency: options.concurrency ?? 2,
      fetchMode: 'browser',
      sitemapUrls,
      fetchPage: (url) => fetchPage(context, url, options)
    })
  )
}

export async function assertAllowedBrowserRequest(
  input: string,
  hostname: string,
  navigation: boolean,
  lookupImpl: DnsLookup = lookup
): Promise<void> {
  const url = new URL(input)
  if (!navigation && (url.protocol === 'data:' || url.protocol === 'blob:')) return
  await assertPublicUrl(url, lookupImpl)
  if (navigation && !isSameHostname(url.toString(), hostname)) {
    throw new Error('页面导航超出了文档库范围')
  }
}

async function withBrowser<T>(
  endpoint: string,
  action: (context: BrowserContext) => Promise<T>
): Promise<T> {
  const browser = await chromium.connect(endpoint, { timeout: 30_000 }).catch(() => {
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
  options: BrowserOptions
): Promise<CrawledPage> {
  await assertAllowedBrowserRequest(url, options.hostname, true, options.lookup)
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  page.on('popup', (popup) => void popup.close())
  page.on('download', (download) => void download.cancel())
  await page.route('**/*', (route) => guardRoute(route, options))

  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const finalUrl = normalizeUrl(page.url() || url)
    const status = response?.status() ?? 0
    if (status < 200 || status >= 300 || !isSameHostname(finalUrl, options.hostname)) {
      return { url: finalUrl, status }
    }
    await waitForStableContent(page)
    return { url: finalUrl, status, page: parsePage(await page.content(), finalUrl) }
  } finally {
    await page.close().catch(() => undefined)
  }
}

async function guardRoute(route: Route, options: BrowserOptions): Promise<void> {
  const request = route.request()
  try {
    await assertAllowedBrowserRequest(
      request.url(),
      options.hostname,
      request.isNavigationRequest(),
      options.lookup
    )
    await route.continue()
  } catch {
    await route.abort('blockedbyclient').catch(() => undefined)
  }
}

async function waitForStableContent(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let previous = ''
        let stableChecks = 0
        const deadline = Date.now() + 3_000
        const check = (): void => {
          const current = document.body?.innerText ?? ''
          stableChecks = current === previous ? stableChecks + 1 : 0
          previous = current
          if (stableChecks >= 2 || Date.now() >= deadline) resolve()
          else setTimeout(check, 250)
        }
        check()
      })
  )
}
