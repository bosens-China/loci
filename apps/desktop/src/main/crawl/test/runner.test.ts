import { describe, expect, it, vi } from 'vitest'
import { runCrawlQueue, type ParsedPage } from '@loci/core'

const page: ParsedPage = {
  title: 'Docs',
  language: 'en-US',
  markdown: '# Docs',
  links: []
}

describe('runCrawlQueue', () => {
  it('keeps the first node identity when the first page redirects', async () => {
    const nodes: Array<{ id: string; url: string }> = []
    await runCrawlQueue({
      firstUrl: 'https://docs.example.com/start',
      firstNodeId: 'https://example.com/docs',
      hostname: 'docs.example.com',
      pageLimit: 1,
      concurrency: 1,
      fetchMode: 'http',
      seedPage: { url: 'https://docs.example.com/start', status: 200, page },
      fetchPage: async () => ({ url: 'https://docs.example.com/start', status: 200, page }),
      onDocument: () => undefined,
      onProgress: (progress) => {
        if (progress.node) nodes.push(progress.node)
      }
    })

    expect(nodes).toEqual([
      {
        id: 'https://example.com/docs',
        url: 'https://docs.example.com/start',
        title: 'https://docs.example.com/start',
        status: 'running'
      },
      {
        id: 'https://example.com/docs',
        url: 'https://docs.example.com/start',
        title: 'Docs',
        status: 'success'
      }
    ])
  })

  it('marks only 404 and 410 responses as missing', async () => {
    const missing: Array<boolean | undefined> = []
    for (const status of [500, 404, 410]) {
      await runCrawlQueue({
        firstUrl: `https://docs.example.com/${status}`,
        hostname: 'docs.example.com',
        pageLimit: 1,
        concurrency: 1,
        fetchMode: 'browser',
        seedPage: { url: `https://docs.example.com/${status}`, status },
        fetchPage: async () => ({ url: `https://docs.example.com/${status}`, status }),
        onDocument: () => undefined,
        onError: (error) => {
          missing.push(error.missing)
        }
      })
    }

    expect(missing).toEqual([undefined, true, true])
  })

  it('returns actionable failure details', async () => {
    const progress = await runCrawlQueue({
      firstUrl: 'https://docs.example.com/start',
      hostname: 'docs.example.com',
      pageLimit: 1,
      concurrency: 1,
      fetchMode: 'http',
      seedPage: { url: 'https://other.example.com/login', status: 302 },
      fetchPage: async () => ({ url: 'https://other.example.com/login', status: 302 }),
      onDocument: () => undefined
    })

    expect(progress.failures).toEqual([
      {
        url: 'https://docs.example.com/start',
        reason: 'out_of_scope_redirect',
        message: '页面跳转到了文档库范围之外',
        retryable: false,
        redirectUrl: 'https://other.example.com/login'
      }
    ])
  })

  it('不保存跳转后命中排除规则的页面', async () => {
    const onDocument = vi.fn()
    const progress = await runCrawlQueue({
      firstUrl: 'https://docs.example.com/start',
      hostname: 'docs.example.com',
      excludePathPattern: '^/zh(?:/|$)',
      pageLimit: 1,
      concurrency: 1,
      fetchMode: 'http',
      fetchPage: async () => ({
        url: 'https://docs.example.com/zh/start',
        status: 200,
        page
      }),
      onDocument
    })

    expect(onDocument).not.toHaveBeenCalled()
    expect(progress.failures).toMatchObject([
      { reason: 'out_of_scope_redirect', redirectUrl: 'https://docs.example.com/zh/start' }
    ])
  })

  it('末尾斜杠变体各抓一次，正文相同时只提交一份', async () => {
    const fetchPage = vi.fn(async (url: string) => ({ url, status: 200, page }))
    const documents: string[] = []
    const duplicates: Array<{ url: string; duplicateOf: string }> = []

    const progress = await runCrawlQueue({
      firstUrl: 'https://docs.example.com/guide',
      hostname: 'docs.example.com',
      pageLimit: 2,
      initialUrls: ['https://docs.example.com/guide/'],
      concurrency: 2,
      fetchMode: 'http',
      fetchPage,
      onDocument: (document) => {
        documents.push(document.url)
      },
      onDuplicate: (duplicate) => {
        duplicates.push(duplicate)
      }
    })

    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(documents).toHaveLength(1)
    expect(duplicates).toHaveLength(1)
    expect(progress).toMatchObject({ queued: 2, processed: 2, succeeded: 2 })
  })

  it('末尾斜杠变体正文不同时分别提交', async () => {
    const documents: string[] = []
    await runCrawlQueue({
      firstUrl: 'https://docs.example.com/guide',
      hostname: 'docs.example.com',
      pageLimit: 2,
      initialUrls: ['https://docs.example.com/guide/'],
      concurrency: 2,
      fetchMode: 'http',
      fetchPage: async (url) => ({
        url,
        status: 200,
        page: { ...page, markdown: url.endsWith('/') ? '# Slash' : '# No slash' }
      }),
      onDocument: (document) => {
        documents.push(document.url)
      }
    })

    expect(documents.sort()).toEqual([
      'https://docs.example.com/guide',
      'https://docs.example.com/guide/'
    ])
  })

  it('斜杠探测和排除路径都遵守同一个页面上限', async () => {
    const fetchPage = vi.fn(async (url: string) => ({ url, status: 200, page }))
    const progress = await runCrawlQueue({
      firstUrl: 'https://docs.example.com/guide',
      hostname: 'docs.example.com',
      excludePathPattern: '^/zh(?:/|$)',
      pageLimit: 1,
      initialUrls: ['https://docs.example.com/zh/guide', 'https://docs.example.com/guide/'],
      concurrency: 2,
      fetchMode: 'http',
      fetchPage,
      onDocument: () => undefined
    })

    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(progress).toMatchObject({ queued: 1, processed: 1, limitReached: true })
  })

  it('pauses before the next batch and waits between batches', async () => {
    let resume = (): void => undefined
    let waitCount = 0
    const paused = new Promise<void>((resolve) => {
      resume = resolve
    })
    const sleep = vi.fn(async () => undefined)
    const fetchPage = vi.fn(async (url: string) => ({
      url,
      status: 200,
      page: {
        ...page,
        links:
          url === 'https://docs.example.com/start'
            ? ['https://docs.example.com/a', 'https://docs.example.com/b']
            : []
      }
    }))
    const task = runCrawlQueue({
      firstUrl: 'https://docs.example.com/start',
      hostname: 'docs.example.com',
      pageLimit: 3,
      concurrency: 1,
      fetchMode: 'http',
      batchIntervalMs: 100_000,
      sleep,
      waitIfPaused: async () => {
        waitCount += 1
        if (waitCount === 2) await paused
      },
      fetchPage,
      onDocument: () => undefined
    })

    await vi.waitFor(() => expect(waitCount).toBe(2))
    expect(fetchPage).toHaveBeenCalledTimes(1)
    resume()
    await task

    expect(fetchPage).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(100_000)
  })
})
