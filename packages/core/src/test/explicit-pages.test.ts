import { describe, expect, it, vi } from 'vitest'
import { fetchExplicitPages, validateExplicitPageUrls } from '../explicit-pages.js'

describe('fetchExplicitPages', () => {
  it('auto 只探测第一个页面一次，并且不跟随页面链接', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      return new Response(
        `<html><title>${url.endsWith('/one') ? 'One' : 'Two'}</title><main><h1>HTTP page</h1><a href="/linked">linked</a></main></html>`,
        { status: 200 }
      )
    })
    const fetchPage = vi.fn(async (url: string) => ({
      url,
      status: 200,
      page: {
        title: url.endsWith('/one') ? 'One' : 'Two',
        language: 'en',
        markdown: '# HTTP page\n\n[linked](/linked)',
        links: []
      }
    }))
    const beforeBrowserCrawl = vi.fn(async () => undefined)

    const result = await fetchExplicitPages({
      urls: ['https://docs.example.com/one', 'https://docs.example.com/two'],
      hostname: 'docs.example.com',
      fetchMode: 'auto',
      concurrency: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      crawler: { fetchPage },
      beforeBrowserCrawl
    })

    expect(result.fetchMode).toBe('http')
    expect(result.items.map((item) => item.url)).toEqual([
      'https://docs.example.com/one',
      'https://docs.example.com/two'
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls.some(([url]) => String(url).endsWith('/linked'))).toBe(false)
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(beforeBrowserCrawl).toHaveBeenCalledOnce()
  })

  it('把 404 保留为 missing 结果', async () => {
    const result = await fetchExplicitPages({
      urls: ['https://docs.example.com/gone'],
      hostname: 'docs.example.com',
      fetchMode: 'http',
      concurrency: 1,
      fetchImpl: vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch
    })

    expect(result.items).toMatchObject([
      { status: 'missing', failure: { reason: 'not_found', statusCode: 404 } }
    ])
  })

  it('固定模式下单页请求失败不阻断其余页面', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/broken')) throw new Error('temporary failure')
      return new Response('<html><title>OK</title><main><h1>OK</h1></main></html>')
    })
    const result = await fetchExplicitPages({
      urls: ['https://docs.example.com/broken', 'https://docs.example.com/ok'],
      hostname: 'docs.example.com',
      fetchMode: 'http',
      concurrency: 2,
      maxRetries: 0,
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(result.items).toMatchObject([
      { status: 'failed', failure: { reason: 'request_error', retryable: true } },
      { status: 'fetched', document: { title: 'OK' } }
    ])
  })

  it('每完成一个指定页面就上报一次进度', async () => {
    const progress: Array<{ processed: number; url?: string; status?: string }> = []
    await fetchExplicitPages({
      urls: ['https://docs.example.com/one', 'https://docs.example.com/missing'],
      hostname: 'docs.example.com',
      fetchMode: 'http',
      concurrency: 1,
      fetchImpl: vi.fn(async (input: string | URL | Request) =>
        String(input).endsWith('/missing')
          ? new Response('', { status: 404 })
          : new Response('<html><title>One</title><main><h1>One</h1></main></html>')
      ) as unknown as typeof fetch,
      onProgress: (item) =>
        progress.push({
          processed: item.processed,
          url: item.node?.url,
          status: item.node?.status
        })
    })

    expect(progress).toEqual([
      { processed: 1, url: 'https://docs.example.com/one', status: 'success' },
      { processed: 2, url: 'https://docs.example.com/missing', status: 'failed' }
    ])
  })

  it('复用页面请求重试配置', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(
        new Response('<html><title>Recovered</title><main><h1>Recovered</h1></main></html>')
      )

    const result = await fetchExplicitPages({
      urls: ['https://docs.example.com/retry'],
      hostname: 'docs.example.com',
      fetchMode: 'http',
      concurrency: 1,
      maxRetries: 1,
      sleep: async () => undefined,
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(result.items[0]).toMatchObject({
      status: 'fetched',
      document: { title: 'Recovered' }
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('拒绝跨 hostname 与排除路径', () => {
    expect(() =>
      validateExplicitPageUrls({
        urls: ['https://other.example.com/page'],
        hostname: 'docs.example.com'
      })
    ).toThrow('必须属于')
    expect(() =>
      validateExplicitPageUrls({
        urls: ['https://docs.example.com/private/page'],
        hostname: 'docs.example.com',
        excludePathPattern: '^/private(?:/|$)'
      })
    ).toThrow('命中了排除路径')
  })
})
