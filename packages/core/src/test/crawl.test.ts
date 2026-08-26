import { describe, expect, it, vi } from 'vitest'
import { crawlHttpSource, isImmediateStaticHostname, parsePage } from '../crawl.js'

describe('页面候选链接', () => {
  it('保留可帮助 Agent 理解 URL 的链接标题及来源', () => {
    const page = parsePage(
      '<main><a href="/api" aria-label="API 参考"></a><a href="/components/button"></a></main>',
      'https://example.com/docs'
    )
    expect(page.linkCandidates).toEqual([
      { url: 'https://example.com/api', title: 'API 参考', titleSource: 'link_text' },
      {
        url: 'https://example.com/components/button',
        title: 'button',
        titleSource: 'pathname'
      }
    ])
  })
})

describe('静态 Pages 抓取', () => {
  it('只识别 GitHub Pages 与 GitLab Pages 的站点子域名', () => {
    expect(isImmediateStaticHostname('OWNER.GITHUB.IO.')).toBe(true)
    expect(isImmediateStaticHostname('GROUP.GITLAB.IO.')).toBe(true)
    expect(isImmediateStaticHostname('github.io')).toBe(false)
    expect(isImmediateStaticHostname('gitlab.io')).toBe(false)
    expect(isImmediateStaticHostname('ownergithub.io')).toBe(false)
    expect(isImmediateStaticHostname('group.gitlab.io.example.com')).toBe(false)
  })

  it('无 Sitemap 的 GitHub Pages 也立即抓取页面链接', async () => {
    const baseUrl = 'https://owner.github.io/project'
    const sleep = vi.fn(async () => undefined)
    const waitIfPaused = vi.fn(async () => undefined)
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/sitemap.xml')) return new Response('', { status: 404 })
      if (url.endsWith('/start')) {
        return new Response(
          '<main><a href="/project/one">One</a><a href="/project/two">Two</a></main>'
        )
      }
      return new Response('<html><title>Page</title><main>Body</main></html>')
    })

    const result = await crawlHttpSource({
      firstUrl: `${baseUrl}/start`,
      hostname: 'owner.github.io',
      scopePath: '/project',
      pageLimit: 3,
      concurrency: 1,
      batchIntervalMs: 100_000,
      fetch: fetchImpl,
      sleep,
      waitIfPaused,
      onDocument: () => undefined
    })

    expect(result).toMatchObject({ queued: 3, succeeded: 3, failed: 0 })
    expect(sleep).not.toHaveBeenCalled()
    expect(waitIfPaused).not.toHaveBeenCalled()
  })

  it('展开 Sitemap 索引并将页面清单作为权威发现来源', async () => {
    const fetched: string[] = []
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      fetched.push(url)
      if (url.endsWith('/sitemap.xml')) {
        return new Response(
          '<sitemapindex><sitemap><loc>https://docs.example.com/pages.xml</loc></sitemap></sitemapindex>'
        )
      }
      if (url.endsWith('/pages.xml')) {
        return new Response('<urlset><url><loc>/guide</loc></url></urlset>')
      }
      return new Response('<main><a href="/from-page">page link</a></main>')
    })
    const documents: string[] = []

    await crawlHttpSource({
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

    expect(documents).toEqual(['https://docs.example.com/start', 'https://docs.example.com/guide'])
    expect(fetched).toContain('https://docs.example.com/pages.xml')
    expect(fetched).not.toContain('https://docs.example.com/from-page')
  })
})

describe('Sitemap 权威清单抓取', () => {
  it('普通站点也按页面上限整批并发且跳过等待', async () => {
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const started: string[] = []
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/sitemap.xml')) {
        return new Response('<urlset><url><loc>/one</loc></url><url><loc>/two</loc></url></urlset>')
      }
      started.push(url)
      await gate
      return new Response('<html><title>Page</title><main>Body</main></html>')
    })
    const sleep = vi.fn(async () => undefined)
    const waitIfPaused = vi.fn(async () => undefined)

    const task = crawlHttpSource({
      firstUrl: 'https://docs.example.com/start',
      hostname: 'docs.example.com',
      pageLimit: 3,
      concurrency: 1,
      batchIntervalMs: 100_000,
      fetch: fetchImpl,
      sleep,
      waitIfPaused,
      onDocument: () => undefined
    })

    await vi.waitFor(() => expect(started).toHaveLength(3))
    release()
    await expect(task).resolves.toMatchObject({ queued: 3, succeeded: 3 })
    expect(sleep).not.toHaveBeenCalled()
    expect(waitIfPaused).not.toHaveBeenCalled()
  })
})
