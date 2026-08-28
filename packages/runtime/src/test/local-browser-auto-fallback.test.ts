import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { LocalBrowserCrawler } from '../browser-crawler.js'
import { createLocalRuntime } from '../local-runtime.js'

describe('本地自动抓取降级', () => {
  it('浏览器未安装时直接使用 HTTP 且不触发安装提示', async () => {
    const root = mkdtempSync(join(tmpdir(), 'loci-auto-http-'))
    const server = createServer((request, response) => {
      if (request.url === '/guide') {
        response.setHeader('content-type', 'text/html; charset=utf-8')
        response.end('<html><title>Docs</title><main><h1>HTTP docs</h1></main></html>')
        return
      }
      response.statusCode = 404
      response.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('无法读取测试服务地址')

    const fetchPage = vi.fn()
    const ensureInstalled = vi.fn(async () => undefined)
    const onBrowserMissing = vi.fn(async () => undefined)
    const browser = {
      isInstalled: () => false,
      fetchPage,
      ensureInstalled,
      close: async () => undefined
    } as unknown as LocalBrowserCrawler
    const runtime = createLocalRuntime({
      dataDir: join(root, 'data'),
      cacheDir: join(root, 'cache'),
      browser
    })

    try {
      const source = runtime.createSource({
        name: 'Docs',
        url: `http://127.0.0.1:${address.port}/guide`,
        mode: 'auto',
        pageLimit: 1,
        scopePath: '/',
        schedule: null,
        httpConcurrency: 1,
        browserConcurrency: 1
      })

      await expect(
        runtime.crawlSource(source.id, undefined, onBrowserMissing)
      ).resolves.toMatchObject({ succeeded: 1, failed: 0 })
      expect(runtime.database.getSourceConfig(source.id).fetchMode).toBe('http')
      expect(fetchPage).not.toHaveBeenCalled()
      expect(ensureInstalled).not.toHaveBeenCalled()
      expect(onBrowserMissing).not.toHaveBeenCalled()
    } finally {
      await runtime.close()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
      rmSync(root, { recursive: true, force: true })
    }
  })
})
