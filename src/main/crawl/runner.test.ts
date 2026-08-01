import { describe, expect, it } from 'vitest'
import type { ParsedPage } from './content'
import { runCrawlQueue } from './runner'

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
})
