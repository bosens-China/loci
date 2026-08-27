import { describe, expect, it, vi } from 'vitest'
import {
  crawlRenderedSource,
  fetchCrawledPageWithRetry,
  waitForStableContent
} from '../rendered.js'

describe('fetchCrawledPageWithRetry', () => {
  it('按统一规则重试浏览器的临时错误', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        url: 'https://docs.example.com/',
        status: 429,
        retryAfter: '2'
      })
      .mockResolvedValueOnce({
        url: 'https://docs.example.com/',
        status: 200
      })
    const sleep = vi.fn(async () => undefined)

    await expect(
      fetchCrawledPageWithRetry(
        { fetchPage },
        'https://docs.example.com/',
        { hostname: 'docs.example.com' },
        { sleep }
      )
    ).resolves.toMatchObject({ status: 200 })
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(2_000)
  })
})

describe('waitForStableContent', () => {
  it('空正文不会被提前视为渲染完成', async () => {
    let now = 0
    await waitForStableContent(async () => (now < 30 ? '' : 'Rendered docs'), {
      timeoutMs: 100,
      minimumWaitMs: 20,
      intervalMs: 10,
      stableChecks: 2,
      minimumContentLength: 1,
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds
      }
    })

    expect(now).toBe(50)
  })

  it('一直为空时等待到截止时间', async () => {
    let now = 0
    await waitForStableContent(async () => '', {
      timeoutMs: 40,
      minimumWaitMs: 10,
      intervalMs: 10,
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds
      }
    })
    expect(now).toBe(40)
  })

  it('等待 Loading 占位被真实正文替换且网络空闲', async () => {
    let now = 0
    const readContent = vi.fn(async () => (now < 50 ? 'Loading...' : 'Rendered documentation'))
    await waitForStableContent(readContent, {
      timeoutMs: 120,
      minimumWaitMs: 20,
      shortContentWaitMs: 30,
      minimumContentLength: 10,
      intervalMs: 10,
      stableChecks: 2,
      isIdle: () => now >= 60,
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds
      }
    })

    expect(now).toBe(70)
  })
})

describe('crawlRenderedSource', () => {
  it('允许平台适配器为整次队列复用浏览器会话', async () => {
    const sessionFetch = vi.fn(async () => ({
      url: 'https://docs.example.com/',
      status: 200,
      page: { title: 'Docs', language: 'en', markdown: '# Docs', links: [] }
    }))
    const withSession = vi.fn(async (action) => action({ fetchPage: sessionFetch }))

    await crawlRenderedSource({
      firstUrl: 'https://docs.example.com/',
      hostname: 'docs.example.com',
      pageLimit: 10,
      crawler: {
        fetchPage: vi.fn(),
        withSession
      },
      fetch: async () => new Response('', { status: 404 }),
      onDocument: () => undefined
    })

    expect(withSession).toHaveBeenCalledOnce()
    expect(sessionFetch).toHaveBeenCalledOnce()
  })

  it('有效 Sitemap 存在时不递归浏览器页面链接', async () => {
    const fetchPage = vi.fn(async (url: string) => ({
      url,
      status: 200,
      page: {
        title: 'Docs',
        language: 'en',
        markdown: '# Docs',
        links: ['https://docs.example.com/from-page']
      }
    }))

    const progress = await crawlRenderedSource({
      firstUrl: 'https://docs.example.com/start',
      hostname: 'docs.example.com',
      pageLimit: 10,
      concurrency: 1,
      crawler: { fetchPage },
      fetch: async () => new Response('<urlset><url><loc>/from-map</loc></url></urlset>'),
      onDocument: () => undefined
    })

    expect(fetchPage.mock.calls.map(([url]) => url)).toEqual([
      'https://docs.example.com/start',
      'https://docs.example.com/from-map'
    ])
    expect(progress).toMatchObject({ queued: 2, succeeded: 2, failed: 0 })
  })

  it('有效 Sitemap 的浏览器页面整批并发且仍响应批次控制', async () => {
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const started: string[] = []
    const fetchPage = vi.fn(async (url: string) => {
      started.push(url)
      await gate
      return {
        url,
        status: 200,
        page: { title: 'Docs', language: 'en', markdown: '# Docs', links: [] }
      }
    })
    const sleep = vi.fn(async () => undefined)
    const waitIfPaused = vi.fn(async () => undefined)

    const task = crawlRenderedSource({
      firstUrl: 'https://docs.example.com/start',
      hostname: 'docs.example.com',
      pageLimit: 3,
      concurrency: 1,
      batchIntervalMs: 100_000,
      crawler: { fetchPage },
      fetch: async () =>
        new Response('<urlset><url><loc>/one</loc></url><url><loc>/two</loc></url></urlset>'),
      sleep,
      waitIfPaused,
      onDocument: () => undefined
    })

    await vi.waitFor(() => expect(started).toHaveLength(3))
    release()
    await expect(task).resolves.toMatchObject({ queued: 3, succeeded: 3 })
    expect(sleep).not.toHaveBeenCalled()
    expect(waitIfPaused).toHaveBeenCalledOnce()
  })
})
