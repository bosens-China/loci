import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDatabase } from '@loci/runtime'
import { runSourceCrawl } from '../source'

vi.mock('../browser', () => ({ fetchRenderedPage: vi.fn() }))

afterEach(() => vi.unstubAllGlobals())

describe('runSourceCrawl', () => {
  it('优先使用 llms.txt，跳过入口页双通道检测', async () => {
    const database = createDatabase(':memory:')
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/llms.txt')) {
        return new Response('- [Introduction](/guide/introduction.md)', { status: 200 })
      }
      return new Response('# Introduction\n\nRaw Markdown', {
        status: 200,
        headers: { 'content-type': 'text/markdown' }
      })
    })
    vi.stubGlobal('fetch', fetchImpl)
    try {
      const source = database.createSource({
        name: 'Docs',
        url: 'https://docs.example.com/guide/start',
        mode: 'auto',
        pageLimit: 10,
        scopePath: '/guide',
        schedule: null,
        httpConcurrency: null,
        browserConcurrency: null
      })
      await runSourceCrawl(database, source.id)

      expect(fetchImpl).toHaveBeenCalledTimes(2)
      expect(fetchImpl.mock.calls.map(([input]) => String(input))).toEqual([
        'https://docs.example.com/llms.txt',
        'https://docs.example.com/guide/introduction.md'
      ])
      expect(database.listDocuments()[0]).toMatchObject({
        title: 'Introduction',
        content: '# Introduction\n\nRaw Markdown'
      })
      expect(database.getSourceConfig(source.id).fetchMode).toBe('http')
    } finally {
      database.close()
    }
  })

  it('成功同步后移除正文相同的末尾斜杠旧记录', async () => {
    const database = createDatabase(':memory:')
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/llms.txt')) return new Response('', { status: 404 })
      if (url.endsWith('/sitemap.xml')) {
        return new Response(
          '<urlset><url><loc>/guide</loc></url><url><loc>/guide/</loc></url></urlset>'
        )
      }
      if (url === 'https://docs.example.com/guide' || url === 'https://docs.example.com/guide/') {
        return new Response('<html><title>Guide</title><main>same</main></html>')
      }
      return new Response('', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchImpl)
    try {
      const source = database.createSource({
        name: 'Docs',
        url: 'https://docs.example.com/guide',
        mode: 'http',
        pageLimit: 2,
        scopePath: '/',
        schedule: null,
        httpConcurrency: null,
        browserConcurrency: null
      })
      for (const url of ['https://docs.example.com/guide', 'https://docs.example.com/guide/']) {
        database.saveDocument({
          sourceId: source.id,
          url,
          title: 'Old',
          markdown: 'old',
          language: 'en',
          fetchMode: 'http',
          crawledAt: new Date().toISOString()
        })
      }

      const progress = await runSourceCrawl(database, source.id)

      expect(progress).toMatchObject({ queued: 2, processed: 2, succeeded: 2 })
      expect(database.listDocumentUrls(source.id)).toHaveLength(1)
    } finally {
      database.close()
    }
  })
})
