import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import type { CrawledPage } from '@loci/core'
import type { LocalBrowserCrawler } from '../browser-crawler.js'
import { createLocalRuntime } from '../local-runtime.js'

describe('explicit page service', () => {
  it('逐项拒绝跨 hostname 页面，同时写入合法页面', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-explicit-validation-'))
    const fetchPage = vi.fn(async (url: string) => page(url))
    const runtime = createLocalRuntime({ dataDir: directory, browser: fakeBrowser(fetchPage) })
    try {
      const source = runtime.createSource(sourceInput())
      const valid = 'https://docs.example.com/outside/new'
      const invalid = 'https://other.example.com/page'

      const result = await runtime.fetchPages(source.id, [valid, invalid])

      expect(result.items).toMatchObject([
        { url: valid, status: 'inserted' },
        { url: invalid, status: 'failed', message: expect.stringContaining('必须属于') }
      ])
      expect(fetchPage).toHaveBeenCalledOnce()
    } finally {
      await runtime.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('整库同步会同时刷新 scope 外的显式页面', async () => {
    const server = createServer((request, response) => {
      if (request.url === '/guide/start' || request.url === '/outside/new') {
        response.end(
          `<html><title>${request.url}</title><main><h1>${request.url}</h1></main></html>`
        )
        return
      }
      response.statusCode = 404
      response.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('测试服务器地址不可用')
    const directory = mkdtempSync(join(tmpdir(), 'loci-explicit-full-sync-'))
    const runtime = createLocalRuntime({ dataDir: directory })
    try {
      const origin = `http://127.0.0.1:${address.port}`
      const source = runtime.createSource({
        name: 'Docs',
        url: `${origin}/guide/start`,
        mode: 'http',
        pageLimit: 10,
        scopePath: '/guide',
        schedule: null,
        httpConcurrency: 1,
        browserConcurrency: null
      })
      runtime.database.registerExplicitPageTargets(source.id, [`${origin}/outside/new`])

      const progress = await runtime.crawlSource(source.id)

      expect(progress.succeeded).toBe(2)
      expect(
        runtime.database
          .listDocuments()
          .map((item) => item.url)
          .sort()
      ).toEqual([`${origin}/guide/start`, `${origin}/outside/new`].sort())
      expect(runtime.database.listExplicitPageTargets(source.id)).toMatchObject([
        { url: `${origin}/outside/new`, status: 'current' }
      ])
    } finally {
      await runtime.close()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('同一页面并发调用跨运行时复用一次抓取', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-explicit-single-flight-'))
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetchPage = vi.fn(async (url: string): Promise<CrawledPage> => {
      await gate
      return page(url)
    })
    const first = createLocalRuntime({ dataDir: directory, browser: fakeBrowser(fetchPage) })
    const second = createLocalRuntime({ dataDir: directory, browser: fakeBrowser(fetchPage) })
    try {
      const source = first.createSource(sourceInput())
      const url = 'https://docs.example.com/outside/new'
      const one = first.fetchPages(source.id, [url])
      await vi.waitFor(() => expect(fetchPage).toHaveBeenCalledOnce())
      const two = second.fetchPages(source.id, [url])
      release?.()
      const [firstResult, secondResult] = await Promise.all([one, two])

      expect(firstResult.items[0]?.status).toBe('inserted')
      expect(secondResult.items[0]?.status).toBe('unchanged')
      expect(fetchPage).toHaveBeenCalledOnce()
    } finally {
      release?.()
      await Promise.all([first.close(), second.close()])
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('等待其他运行时期间支持取消', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-explicit-cancel-'))
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetchPage = vi.fn(async (url: string): Promise<CrawledPage> => {
      await gate
      return page(url)
    })
    const first = createLocalRuntime({ dataDir: directory, browser: fakeBrowser(fetchPage) })
    const second = createLocalRuntime({ dataDir: directory, browser: fakeBrowser(fetchPage) })
    try {
      const source = first.createSource(sourceInput())
      const running = first.fetchPages(source.id, ['https://docs.example.com/outside/one'])
      await vi.waitFor(() => expect(fetchPage).toHaveBeenCalledOnce())
      const controller = new AbortController()
      const waiting = second.fetchPages(
        source.id,
        ['https://docs.example.com/outside/two'],
        undefined,
        controller.signal
      )
      controller.abort(new Error('已取消'))
      await expect(waiting).rejects.toThrow('已取消')
      release?.()
      await running
    } finally {
      release?.()
      await Promise.all([first.close(), second.close()])
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

function fakeBrowser(fetchPage: (url: string) => Promise<CrawledPage>): LocalBrowserCrawler {
  return {
    fetchPage,
    ensureInstalled: async () => undefined,
    close: async () => undefined
  } as unknown as LocalBrowserCrawler
}

function page(url: string): CrawledPage {
  return {
    url,
    status: 200,
    page: { title: 'Page', language: 'en', markdown: '# Page', links: [] }
  }
}

function sourceInput() {
  return {
    name: 'Docs',
    url: 'https://docs.example.com/guide/start',
    mode: 'browser' as const,
    pageLimit: 10,
    scopePath: '/guide',
    schedule: null,
    httpConcurrency: null,
    browserConcurrency: 1
  }
}
