import { describe, expect, it, vi } from 'vitest'
import { crawlRenderedSource, fetchCrawledPageWithRetry, waitForStableContent } from './rendered.js'

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
    const readContent = vi.fn(async () => (now < 30 ? '' : 'Rendered docs'))
    await waitForStableContent(readContent, {
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
    expect(readContent).toHaveBeenCalledTimes(6)
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
    expect(readContent).toHaveBeenLastCalledWith()
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
})
