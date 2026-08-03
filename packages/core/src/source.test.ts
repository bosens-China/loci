import { describe, expect, it, vi } from 'vitest'
import { crawlSource } from './source.js'
import type { CrawledDocument, CrawledPage } from './types.js'

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
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
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
      firstUrl: 'https://docs.example.com/start',
      hostname: 'docs.example.com',
      pageLimit: 10,
      fetchMode: 'auto',
      fetch: fetchImpl,
      crawler: { fetchPage },
      onDocument: (document) => {
        documents.push(document)
      }
    })

    expect(result.resolution.discovery).toBe('llms')
    expect(fetchPage).not.toHaveBeenCalled()
    expect(documents[0]?.markdown).toBe('# Guide')
  })

  it('自动模式允许 HTTP 失败后继续使用浏览器结果', async () => {
    const documents: CrawledDocument[] = []
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/llms.txt') || url.endsWith('/sitemap.xml')) {
        return new Response('', { status: 404 })
      }
      throw new Error('HTTP unavailable')
    })
    const fetchPage = vi.fn(async () => renderedPage('# Browser docs'))

    const result = await crawlSource({
      firstUrl: 'https://docs.example.com/guide',
      hostname: 'docs.example.com',
      pageLimit: 10,
      fetchMode: 'auto',
      fetch: fetchImpl,
      crawler: { fetchPage },
      sleep: async () => undefined,
      onDocument: (document) => {
        documents.push(document)
      }
    })

    expect(result.resolution.fetchMode).toBe('browser')
    expect(documents[0]).toMatchObject({ markdown: '# Browser docs', fetchMode: 'browser' })
  })

  it('双路均失败时保留各自的底层原因', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
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
})
