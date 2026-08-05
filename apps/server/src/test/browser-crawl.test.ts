import { chromium } from 'playwright-core'
import type { Browser, BrowserContext } from 'playwright-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertAllowedBrowserRequest, createBrowserCrawler } from '../browser-crawl.js'

vi.mock('playwright-core', () => ({
  chromium: {
    connect: vi.fn(),
    launch: vi.fn()
  }
}))

const publicLookup = async (): Promise<Array<{ address: string; family: 4 }>> => [
  { address: '93.184.216.34', family: 4 }
]
const privateLookup = async (): Promise<Array<{ address: string; family: 4 }>> => [
  { address: '127.0.0.1', family: 4 }
]

beforeEach(() => vi.clearAllMocks())

describe('assertAllowedBrowserRequest', () => {
  it('允许公开子资源，但拒绝私网和跨站导航', async () => {
    await expect(
      assertAllowedBrowserRequest(
        'https://cdn.example.net/app.js',
        'docs.example.com',
        false,
        publicLookup
      )
    ).resolves.toBeUndefined()
    await expect(
      assertAllowedBrowserRequest(
        'https://internal.example/a',
        'docs.example.com',
        false,
        privateLookup
      )
    ).rejects.toThrow('不允许抓取')
    await expect(
      assertAllowedBrowserRequest('https://other.example/a', 'docs.example.com', true, publicLookup)
    ).rejects.toThrow('超出了文档库范围')
  })
})

describe('createBrowserCrawler', () => {
  it('本地模式直接启动 headless shell', async () => {
    const { browser } = mockBrowser()
    vi.mocked(chromium.launch).mockResolvedValue(browser)

    const crawler = createBrowserCrawler({ provider: 'local' })
    await crawler.withSession?.(async () => undefined)

    expect(chromium.launch).toHaveBeenCalledWith({ headless: true })
  })

  it('通过 Playwright 协议连接 Browserless', async () => {
    const { browser } = mockBrowser()
    vi.mocked(chromium.connect).mockResolvedValue(browser)

    const crawler = createBrowserCrawler({
      provider: 'browserless',
      endpoint: 'ws://browser:9222/'
    })
    await crawler.withSession?.(async () => undefined)

    expect(chromium.connect).toHaveBeenCalledWith('ws://browser:9222/', { timeout: 30_000 })
    expect(browser.newContext).toHaveBeenCalledWith({ acceptDownloads: false })
    expect(browser.close).toHaveBeenCalledOnce()
  })
})

function mockBrowser(): { browser: Browser; context: BrowserContext } {
  const context = { close: vi.fn(async () => undefined) } as unknown as BrowserContext
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined)
  } as unknown as Browser
  return { browser, context }
}
