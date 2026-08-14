import { describe, expect, it, vi } from 'vitest'
import { crawlHttpSource } from '@loci/core'

describe('crawlHttpSource', () => {
  it('follows same-host links until the page limit', async () => {
    const responses = new Map([
      [
        'https://docs.example.com/start',
        '<html><title>Start</title><body><main><a href="/next">Next</a><a href="https://other.example.com/no">No</a></main></body></html>'
      ],
      [
        'https://docs.example.com/next',
        '<html><title>Next</title><body><main><p>Done</p></main></body></html>'
      ]
    ])
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith('/sitemap.xml')) return new Response('', { status: 404 })
      return new Response(responses.get(String(input)) ?? '', { status: 200 })
    })
    const documents: string[] = []
    const nodes: string[] = []
    const snapshots: Array<{ processed: number; succeeded: number; failed: number }> = []

    const progress = await crawlHttpSource({
      firstUrl: 'https://docs.example.com/start#top',
      hostname: 'docs.example.com',
      pageLimit: 2,
      fetch: fetchImpl,
      onDocument: (document) => {
        documents.push(document.url)
      },
      concurrency: 1,
      onProgress: (event) => {
        if (event.node) nodes.push(`${event.node.title}:${event.node.status}`)
        snapshots.push(event)
      },
      sleep: async () => undefined
    })

    expect(documents.sort()).toEqual([
      'https://docs.example.com/next',
      'https://docs.example.com/start'
    ])
    expect(progress).toMatchObject({ queued: 2, processed: 2, succeeded: 2, failed: 0 })
    expect(nodes).toEqual([
      'https://docs.example.com/start:running',
      'Start:success',
      'https://docs.example.com/next:running',
      'Next:success'
    ])
    expect(snapshots.every((item) => item.processed === item.succeeded + item.failed)).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('重新同步时历史 URL 也受页面上限约束', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/sitemap.xml')) return new Response('', { status: 404 })
      if (url.endsWith('/start')) {
        return new Response('<main><a href="/new">new</a></main>', { status: 200 })
      }
      return new Response('<main>stored</main>', { status: 200 })
    })
    const documents: string[] = []

    const progress = await crawlHttpSource({
      firstUrl: 'https://docs.example.com/start',
      hostname: 'docs.example.com',
      pageLimit: 1,
      initialUrls: ['https://docs.example.com/orphan'],
      concurrency: 2,
      fetch: fetchImpl,
      sleep: async () => undefined,
      onDocument: (document) => {
        documents.push(document.url)
      }
    })

    expect(documents).toEqual(['https://docs.example.com/start'])
    expect(progress).toMatchObject({ queued: 1, processed: 1, limitReached: true })
    expect(fetchImpl).not.toHaveBeenCalledWith('https://docs.example.com/orphan', expect.anything())
    expect(fetchImpl).not.toHaveBeenCalledWith('https://docs.example.com/new', expect.anything())
  })

  it('keeps the requested concurrency after link discovery', async () => {
    let active = 0
    let maxActive = 0
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/sitemap.xml')) return new Response('', { status: 404 })
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      const body = url.endsWith('/start')
        ? '<main><a href="/a">a</a><a href="/b">b</a></main>'
        : '<main>done</main>'
      return new Response(body, { status: 200 })
    })

    await crawlHttpSource({
      firstUrl: 'https://docs.example.com/start',
      hostname: 'docs.example.com',
      pageLimit: 3,
      concurrency: 2,
      fetch: fetchImpl,
      sleep: async () => undefined,
      onDocument: () => undefined
    })

    expect(maxActive).toBe(2)
  })

  it('有效 Sitemap 只入队清单中位于收录路径内的页面', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/sitemap.xml')) {
        return new Response(
          '<urlset><url><loc>/guide/from-map</loc></url><url><loc>/api/from-map</loc></url></urlset>',
          { status: 200 }
        )
      }
      return new Response(
        '<main><a href="/guide/from-link">yes</a><a href="/api/no">no</a></main>',
        {
          status: 200
        }
      )
    })
    const documents: string[] = []
    await crawlHttpSource({
      firstUrl: 'https://docs.example.com/guide/start',
      hostname: 'docs.example.com',
      scopePath: '/guide',
      pageLimit: 10,
      initialUrls: ['https://docs.example.com/api/stored'],
      concurrency: 1,
      fetch: fetchImpl,
      sleep: async () => undefined,
      onDocument: (document) => {
        documents.push(document.url)
      }
    })
    expect(documents).toEqual([
      'https://docs.example.com/guide/start',
      'https://docs.example.com/guide/from-map'
    ])
    expect(fetchImpl).not.toHaveBeenCalledWith(
      'https://docs.example.com/guide/from-link',
      expect.anything()
    )
  })

  it('有效 Sitemap 优先于历史 URL 占用剩余页面额度', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/sitemap.xml')) {
        return new Response('<urlset><url><loc>/current</loc></url></urlset>')
      }
      return new Response('<main>done</main>')
    })
    const documents: string[] = []

    const progress = await crawlHttpSource({
      firstUrl: 'https://docs.example.com/start',
      hostname: 'docs.example.com',
      pageLimit: 2,
      initialUrls: ['https://docs.example.com/old'],
      concurrency: 1,
      fetch: fetchImpl,
      sleep: async () => undefined,
      onDocument: (document) => {
        documents.push(document.url)
      }
    })

    expect(documents).toEqual([
      'https://docs.example.com/start',
      'https://docs.example.com/current'
    ])
    expect(progress).toMatchObject({ queued: 2, processed: 2, limitReached: true })
    expect(fetchImpl).not.toHaveBeenCalledWith('https://docs.example.com/old', expect.anything())
  })

  it.each([
    ['格式无效', '<html>Not a sitemap</html>'],
    ['没有范围内 URL', '<urlset><url><loc>https://other.example.com/outside</loc></url></urlset>']
  ])('Sitemap %s时继续递归页面链接', async (_reason, sitemap) => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/sitemap.xml')) return new Response(sitemap)
      const body = url.endsWith('/start')
        ? '<main><a href="/next">next</a></main>'
        : '<main>done</main>'
      return new Response(body)
    })
    const documents: string[] = []

    const progress = await crawlHttpSource({
      firstUrl: 'https://docs.example.com/start',
      hostname: 'docs.example.com',
      pageLimit: 10,
      concurrency: 1,
      fetch: fetchImpl,
      sleep: async () => undefined,
      onDocument: (document) => {
        documents.push(document.url)
      }
    })

    expect(documents).toEqual(['https://docs.example.com/start', 'https://docs.example.com/next'])
    expect(progress).toMatchObject({ queued: 2, succeeded: 2, failed: 0 })
  })
})
