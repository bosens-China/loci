import { BrowserPool, PlaywrightPlugin, type BrowserPoolOptions } from '@crawlee/browser-pool'
import type { Browser, BrowserType, LaunchOptions, Page, Request } from 'playwright-core'
import { isAllowedNavigation, normalizeUrl, parsePage } from './crawl.js'
import { waitForStableContent, type RenderedCrawler, type RenderedPageRequest } from './rendered.js'
import type { CrawledPage } from './types.js'

interface BrowserCrawlerOptions {
  executablePath?: string
  endpoint?: string
  guardRequest?: (url: string, navigation: boolean, request: RenderedPageRequest) => Promise<void>
}

/** 远端连接沿用同一浏览器池生命周期，不另建抓取和重试实现。 */
class RemotePlaywrightPlugin extends PlaywrightPlugin {
  constructor(
    browserType: BrowserType,
    private readonly endpoint: string
  ) {
    super(browserType, { useIncognitoPages: true })
  }

  protected override _launch(): Promise<Browser> {
    return this.library.connect(this.endpoint, { timeout: 30_000 })
  }
}

/** 本机与 Server 共用页面隔离、稳定正文等待和 Crawlee 浏览器资源回收。 */
export class PooledBrowserCrawler implements RenderedCrawler {
  private poolPromise?: Promise<BrowserPool<BrowserPoolOptions<PlaywrightPlugin>>>

  constructor(private readonly options: BrowserCrawlerOptions = {}) {}

  private async createPool(): Promise<BrowserPool<BrowserPoolOptions<PlaywrightPlugin>>> {
    // Playwright 必须在运行时设置受管缓存目录之后加载，否则 registry 会锁定系统默认路径。
    const { chromium } = await import('playwright-core')
    const options = this.options
    const launchOptions: LaunchOptions = { headless: true, executablePath: options.executablePath }
    return new BrowserPool({
      browserPlugins: [
        options.endpoint
          ? new RemotePlaywrightPlugin(chromium, options.endpoint)
          : new PlaywrightPlugin(chromium, { useIncognitoPages: true, launchOptions })
      ],
      useFingerprints: false,
      maxOpenPagesPerBrowser: 5,
      retireBrowserAfterPageCount: 100,
      closeInactiveBrowserAfterSecs: 30
    })
  }

  async fetchPage(url: string, request: RenderedPageRequest = {}): Promise<CrawledPage> {
    request.signal?.throwIfAborted()
    await this.options.guardRequest?.(url, true, request)
    this.poolPromise ??= this.createPool()
    const pool = await this.poolPromise
    const page: Page = await pool.newPage({ pageOptions: { acceptDownloads: false } })
    const abort = (): void => {
      void page.close().catch(() => undefined)
    }
    request.signal?.addEventListener('abort', abort, { once: true })
    const pending = new Set<Request>()
    try {
      request.signal?.throwIfAborted()
      page.setDefaultTimeout(30_000)
      page.setDefaultNavigationTimeout(30_000)
      page.on('popup', (popup) => void popup.close())
      page.on('download', (download) => void download.cancel())
      page.on('request', (item) => {
        if (['document', 'script', 'fetch', 'xhr'].includes(item.resourceType())) pending.add(item)
      })
      page.on('requestfinished', (item) => pending.delete(item))
      page.on('requestfailed', (item) => pending.delete(item))
      await page.route('**/*', async (route) => {
        const current = route.request()
        const navigation = current.isNavigationRequest() && current.frame() === page.mainFrame()
        try {
          if (
            navigation &&
            !isAllowedNavigation(current.url(), request.hostname, request.scopePath)
          ) {
            throw new Error('页面导航超出了文档库范围')
          }
          await this.options.guardRequest?.(current.url(), current.isNavigationRequest(), request)
          await route.continue()
        } catch {
          await route.abort('blockedbyclient').catch(() => undefined)
        }
      })
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' })
      const status = response?.status() ?? 0
      if (status >= 200 && status < 300) {
        await waitForStableContent(() => page.evaluate(() => document.body?.innerText ?? ''), {
          isIdle: () => pending.size === 0,
          signal: request.signal
        })
      }
      request.signal?.throwIfAborted()
      const finalUrl = normalizeUrl(page.url() || url)
      return {
        url: finalUrl,
        status,
        retryAfter: (await response?.headerValue('retry-after')) ?? null,
        ...(status >= 200 && status < 300
          ? { page: parsePage(await page.content(), finalUrl) }
          : {})
      }
    } finally {
      request.signal?.removeEventListener('abort', abort)
      await page.close().catch(() => undefined)
    }
  }

  async close(): Promise<void> {
    const pool = await this.poolPromise
    await pool?.destroy()
  }
}
