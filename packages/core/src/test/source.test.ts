import { describe, expect, it, vi, type Mock } from 'vitest'
import { crawlSource } from '../source.js'
import type { CrawledDocument, CrawledPage, CrawlProgress } from '../types.js'

type FetchMock = Mock<typeof fetch> & typeof fetch

function createFetchMock(
  implementation?: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>
): FetchMock {
  return vi.fn(implementation) as unknown as FetchMock
}

function renderedPage(markdown: string): CrawledPage {
  return {
    url: 'https://docs.example.com/guide',
    status: 200,
    page: {
      title: 'Docs',
      language: 'en',
      markdown,
      links: []
    }
  }
}

describe('crawlSource', () => {
  it('优先复用 llms.txt 流程，不启动浏览器', async () => {
    const documents: CrawledDocument[] = []
    const fetchPage = vi.fn(async () => renderedPage('browser'))
    const beforeBrowserCrawl = vi.fn(async () => undefined)
    const fetchImpl = createFetchMock(async (input) => {
      const url = String(input)
      if (url.endsWith('/llms.txt')) {
        return new Response('- [Guide](/guide.md)', { status: 200 })
      }
      return new Response('# Guide', {
        status: 200,
        headers: { 'content-type': 'text/markdown' }
      })
    })

    const result = await crawlSource({
      kind: 'web',
      firstUrl: 'https://docs.example.com/docs',
      hostname: 'docs.example.com',
      pageLimit: 10,
      fetchMode: 'auto',
      fetch: fetchImpl,
      crawler: { fetchPage },
      beforeBrowserCrawl,
      onDocument: (document) => {
        documents.push(document)
      },
      onSnapshot: (snapshot) => {
        documents.push(...snapshot)
      }
    })

    expect(result.resolution).toMatchObject({
      discovery: 'llms',
      iconUrl: 'https://docs.example.com/favicon.ico'
    })
    expect(beforeBrowserCrawl).not.toHaveBeenCalled()
    expect(fetchPage).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalledWith(
      'https://docs.example.com/openapi.json',
      expect.anything()
    )
    expect(documents[0]?.markdown).toBe('# Guide')
  })

  it('llms.txt 清单中的 404 只记为失败，不回退抓取 HTML', async () => {
    const fetchPage = vi.fn(async () => renderedPage('# Browser fallback'))
    const fetchImpl = createFetchMock(async (input) => {
      const url = String(input)
      if (url.endsWith('/llms.txt')) return new Response('- [Missing](/missing.md)')
      return new Response('', { status: 404 })
    })

    const result = await crawlSource({
      firstUrl: 'https://docs.example.com/docs',
      hostname: 'docs.example.com',
      pageLimit: 10,
      fetchMode: 'auto',
      fetch: fetchImpl,
      crawler: { fetchPage },
      onDocument: () => undefined
    })

    expect(result.resolution.discovery).toBe('llms')
    expect(result.progress).toMatchObject({ succeeded: 0, failed: 1 })
    expect(result.progress.failures).toMatchObject([
      { url: 'https://docs.example.com/missing.md', reason: 'not_found', retryable: false }
    ])
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('在 llms.txt 之后命中 OpenAPI，并跳过浏览器和网页发现', async () => {
    const documents: CrawledDocument[] = []
    const progressEvents: CrawlProgress[] = []
    const fetchPage = vi.fn(async () => renderedPage('browser'))
    const beforeBrowserCrawl = vi.fn(async () => undefined)
    const fetchImpl = createFetchMock(async (input) => {
      const url = String(input)
      if (url.endsWith('/llms.txt')) return new Response('', { status: 404 })
      if (url.endsWith('/openapi.json')) {
        return new Response(
          JSON.stringify({
            openapi: '3.1.0',
            info: { title: 'Ops API', version: '1.0.0' },
            paths: {
              '/health': {
                get: { summary: '健康检查', responses: { 200: { description: 'OK' } } }
              }
            }
          })
        )
      }
      return new Response('', { status: 404 })
    })

    const result = await crawlSource({
      firstUrl: 'https://api.example.com/docs',
      hostname: 'api.example.com',
      pageLimit: 10,
      fetchMode: 'auto',
      fetch: fetchImpl,
      crawler: { fetchPage },
      beforeBrowserCrawl,
      onDocument: (document) => {
        documents.push(document)
      },
      onProgress: (progress) => progressEvents.push(progress)
    })

    expect(result.resolution.discovery).toBe('openapi')
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.example.com/llms.txt')
    expect(fetchPage).not.toHaveBeenCalled()
    expect(beforeBrowserCrawl).not.toHaveBeenCalled()
    expect(fetchImpl.mock.calls.some(([input]) => String(input).endsWith('/sitemap.xml'))).toBe(
      false
    )
    expect(documents).toHaveLength(2)
    expect(documents[0]).toMatchObject({
      title: 'Ops API',
      relativePath: 'index.md',
      fetchMode: 'http'
    })
    expect(documents[1]).toMatchObject({
      title: '健康检查',
      relativePath: '未分组/GET-health.md',
      fetchMode: 'http'
    })
    expect(progressEvents[0]).toMatchObject({ queued: 0, processed: 0 })
    expect(progressEvents.some((progress) => progress.queued === 2 && progress.processed > 0)).toBe(
      true
    )
  })

  it('OpenAPI 候选未命中时继续普通网页流程', async () => {
    const documents: CrawledDocument[] = []
    const fetchImpl = createFetchMock(async (input) => {
      const url = String(input)
      if (url.endsWith('/llms.txt') || url.endsWith('/sitemap.xml')) {
        return new Response('', { status: 404 })
      }
      if (url === 'https://docs.example.com/docs') {
        return new Response('<html><title>Docs</title><main><h1>普通文档</h1></main></html>')
      }
      return new Response('', { status: 404 })
    })

    const result = await crawlSource({
      firstUrl: 'https://docs.example.com/docs',
      hostname: 'docs.example.com',
      pageLimit: 10,
      fetchMode: 'http',
      fetch: fetchImpl,
      onDocument: (document) => {
        documents.push(document)
      }
    })

    expect(result.resolution.discovery).toBe('pages')
    expect(documents[0]?.markdown).toBe('# 普通文档')
  })

  it('展开站点清单中的库级 llms.txt', async () => {
    const documents: CrawledDocument[] = []
    const fetchImpl = createFetchMock(async (input) => {
      const url = String(input)
      if (url === 'https://docs.example.com/llms.txt') {
        return new Response('- [Router](/router/latest/llms.txt)\n- [Other](/query/llms.txt)')
      }
      if (url === 'https://docs.example.com/router/latest/llms.txt') {
        return new Response(
          '- [Self](/router/latest/llms.txt)\n- [Overview](/router/latest/overview.md)\n- [Guide](/router/latest/guide.md)'
        )
      }
      return new Response(`# ${url.endsWith('overview.md') ? 'Overview' : 'Guide'}`, {
        headers: { 'content-type': 'text/markdown' }
      })
    })

    await crawlSource({
      firstUrl: 'https://docs.example.com/router/latest/start',
      hostname: 'docs.example.com',
      scopePath: '/router',
      pageLimit: 10,
      fetchMode: 'auto',
      fetch: fetchImpl,
      onDocument: (document) => {
        documents.push(document)
      }
    })

    expect(documents.map((document) => document.url)).toEqual([
      'https://docs.example.com/router/latest/overview.md',
      'https://docs.example.com/router/latest/guide.md'
    ])
    expect(documents.map((document) => document.markdown)).toEqual(['# Overview', '# Guide'])
  })

  it('把清单中的 HTML 页面继续转换为 Markdown', async () => {
    const documents: CrawledDocument[] = []
    const fetchImpl = createFetchMock(async (input) => {
      if (String(input).endsWith('/llms.txt')) return new Response('- [Home](/home)')
      return new Response(
        '<html lang="zh"><title>首页</title><main><h1>文档首页</h1></main></html>',
        {
          headers: { 'content-type': 'text/html; charset=utf-8' }
        }
      )
    })

    await crawlSource({
      firstUrl: 'https://docs.example.com/start',
      hostname: 'docs.example.com',
      pageLimit: 10,
      fetchMode: 'auto',
      fetch: fetchImpl,
      onDocument: (document) => {
        documents.push(document)
      }
    })

    expect(documents[0]).toMatchObject({
      title: '首页',
      language: 'zh',
      markdown: '# 文档首页'
    })
  })

  it('自动模式允许 HTTP 失败后继续使用浏览器结果', async () => {
    const documents: CrawledDocument[] = []
    const fetchImpl = createFetchMock(async (input) => {
      const url = String(input)
      if (url.endsWith('/llms.txt') || url.endsWith('/sitemap.xml')) {
        return new Response('', { status: 404 })
      }
      throw new Error('HTTP unavailable')
    })
    const fetchPage = vi.fn(async () => renderedPage('# Browser docs'))
    const beforeBrowserCrawl = vi.fn(async () => undefined)

    const result = await crawlSource({
      firstUrl: 'https://docs.example.com/guide',
      hostname: 'docs.example.com',
      pageLimit: 10,
      fetchMode: 'auto',
      fetch: fetchImpl,
      crawler: { fetchPage },
      beforeBrowserCrawl,
      sleep: async () => undefined,
      onDocument: (document) => {
        documents.push(document)
      }
    })

    expect(result.resolution.fetchMode).toBe('browser')
    expect(beforeBrowserCrawl).toHaveBeenCalledOnce()
    expect(documents[0]).toMatchObject({ markdown: '# Browser docs', fetchMode: 'browser' })
  })

  it('自动模式在运行环境没有浏览器能力时直接使用 HTTP', async () => {
    const documents: CrawledDocument[] = []
    const fetchPage = vi.fn(async () => renderedPage('# Browser docs'))
    const beforeBrowserCrawl = vi.fn(async () => false)
    const fetchImpl = createFetchMock(async (input) => {
      const url = String(input)
      if (url.endsWith('/llms.txt') || url.endsWith('/sitemap.xml')) {
        return new Response('', { status: 404 })
      }
      return new Response('<html><title>Docs</title><main><h1>HTTP docs</h1></main></html>')
    })

    const result = await crawlSource({
      firstUrl: 'https://docs.example.com/guide',
      hostname: 'docs.example.com',
      pageLimit: 1,
      fetchMode: 'auto',
      fetch: fetchImpl,
      crawler: { fetchPage },
      beforeBrowserCrawl,
      onDocument: (document) => {
        documents.push(document)
      }
    })

    expect(result.resolution.fetchMode).toBe('http')
    expect(beforeBrowserCrawl).toHaveBeenCalledOnce()
    expect(fetchPage).not.toHaveBeenCalled()
    expect(documents[0]).toMatchObject({ markdown: '# HTTP docs', fetchMode: 'http' })
  })

  it('浏览器模式在发起网络请求前检查浏览器运行时', async () => {
    const fetchImpl = createFetchMock()
    const beforeBrowserCrawl = vi.fn(async () => {
      throw new Error('Browser missing')
    })

    await expect(
      crawlSource({
        firstUrl: 'https://docs.example.com/guide',
        hostname: 'docs.example.com',
        pageLimit: 10,
        fetchMode: 'browser',
        fetch: fetchImpl,
        crawler: { fetchPage: async () => renderedPage('# Browser docs') },
        beforeBrowserCrawl,
        onDocument: () => undefined
      })
    ).rejects.toThrow('Browser missing')
    expect(beforeBrowserCrawl).toHaveBeenCalledOnce()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('双路均失败时保留各自的底层原因', async () => {
    const fetchImpl = createFetchMock(async (input) => {
      if (String(input).endsWith('/llms.txt')) return new Response('', { status: 404 })
      throw new Error('HTTP blocked')
    })

    await expect(
      crawlSource({
        firstUrl: 'https://docs.example.com/guide',
        hostname: 'docs.example.com',
        pageLimit: 10,
        fetchMode: 'auto',
        fetch: fetchImpl,
        crawler: {
          fetchPage: async () => {
            throw new Error('Browser blocked')
          }
        },
        sleep: async () => undefined,
        onDocument: () => undefined
      })
    ).rejects.toThrow('HTTP：HTTP blocked；浏览器：Browser blocked')
  })

  it('显式 GitHub 来源拒绝普通站点 URL', async () => {
    await expect(
      crawlSource({
        kind: 'github',
        firstUrl: 'https://docs.example.com/guide',
        hostname: 'docs.example.com',
        pageLimit: 10,
        fetchMode: 'auto',
        onDocument: () => undefined
      })
    ).rejects.toThrow('GitHub 文档源必须使用公开仓库首页 URL')
  })
})
