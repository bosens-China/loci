import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { LocalBrowserCrawler } from '../browser-crawler.js'
import { createLocalRuntime } from '../local-runtime.js'

describe('本地自动抓取降级', () => {
  it('整库抓取全部失败时持久化首个具体原因与对应 URL', async () => {
    const root = mkdtempSync(join(tmpdir(), 'loci-all-failed-'))
    const server = createServer((request, response) => {
      if (request.url === '/llms.txt') response.end('- [Missing](/missing.md)')
      else response.writeHead(404).end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('无法读取测试服务地址')
    const runtime = createLocalRuntime({ dataDir: root, cacheDir: root })
    try {
      const url = `http://127.0.0.1:${address.port}`
      const source = runtime.createSource({ url, mode: 'http' })
      await expect(runtime.crawlSource(source.id)).rejects.toThrow(/首个错误/u)
      const status = runtime.getLibraryCrawlStatus(source.id)
      expect(status).toMatchObject({
        status: 'failed',
        failures: [{ url: url + '/missing.md', message: expect.stringMatching(/404/u) }]
      })
      expect(status?.error).toContain(status?.failures?.[0]?.message)
    } finally {
      await runtime.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(root, { recursive: true, force: true })
    }
  })

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
