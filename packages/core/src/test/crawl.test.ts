import { describe, expect, it, vi } from 'vitest'
import { crawlHttpSource, isImmediateStaticHostname } from '../crawl.js'

describe('静态 Pages 抓取', () => {
  it('只识别 GitHub Pages 与 GitLab Pages 的站点子域名', () => {
    expect(isImmediateStaticHostname('OWNER.GITHUB.IO.')).toBe(true)
    expect(isImmediateStaticHostname('GROUP.GITLAB.IO.')).toBe(true)
    expect(isImmediateStaticHostname('github.io')).toBe(false)
    expect(isImmediateStaticHostname('gitlab.io')).toBe(false)
    expect(isImmediateStaticHostname('ownergithub.io')).toBe(false)
    expect(isImmediateStaticHostname('group.gitlab.io.example.com')).toBe(false)
  })

  it.each(['owner.github.io', 'group.gitlab.io'])(
    '%s 按页面上限整批并发且跳过批次等待',
    async (hostname) => {
      const baseUrl = `https://${hostname}/project`
      const pending = new Map<string, (response: Response) => void>()
      const fetchImpl = vi.fn<typeof fetch>((input) => {
        const url = String(input)
        if (url.endsWith('/sitemap.xml')) {
          return Promise.resolve(
            new Response(
              `<urlset><url><loc>${baseUrl}/one</loc></url><url><loc>${baseUrl}/two</loc></url></urlset>`
            )
          )
        }
        return new Promise<Response>((resolve) => pending.set(url, resolve))
      })
      const sleep = vi.fn(async () => undefined)
      const waitIfPaused = vi.fn(async () => undefined)
      const documents: string[] = []

      const crawlPromise = crawlHttpSource({
        firstUrl: `${baseUrl}/start`,
        hostname,
        scopePath: '/project',
        pageLimit: 3,
        concurrency: 1,
        batchIntervalMs: 100_000,
        fetch: fetchImpl,
        sleep,
        waitIfPaused,
        onDocument: (document) => {
          documents.push(document.url)
        }
      })

      await vi.waitFor(() => expect(pending.size).toBe(3))
      for (const resolve of pending.values()) {
        resolve(new Response('<html><title>Page</title><main>Body</main></html>'))
      }

      await expect(crawlPromise).resolves.toMatchObject({ queued: 3, succeeded: 3, failed: 0 })
      expect(documents).toHaveLength(3)
      expect(sleep).not.toHaveBeenCalled()
      expect(waitIfPaused).not.toHaveBeenCalled()
    }
  )

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
