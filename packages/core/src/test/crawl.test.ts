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
})
