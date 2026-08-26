import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalRuntime } from '../local-runtime.js'

const temporaryDirectories: string[] = []

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function requestUrl(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
}

function createReviewSource(runtime: ReturnType<typeof createLocalRuntime>) {
  return runtime.createSource({
    name: 'Example',
    url: 'https://example.com/docs',
    mode: 'http',
    pageLimit: 10,
    schedule: null,
    httpConcurrency: 1,
    browserConcurrency: null,
    discoveryMode: 'agent_review',
    reviewGoal: '只收录 API 文档'
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true })
})

describe('UrlReviewService', () => {
  it('逐批排除 URL，并在无 Agent 同步时只刷新已收录页面', async () => {
    const pages = new Map<string, { status: number; body: string }>([
      [
        'https://example.com/docs',
        {
          status: 200,
          body: '<html><title>Docs</title><main><a href="/api">API Reference</a><a href="/blog">News</a></main></html>'
        }
      ],
      [
        'https://example.com/api',
        {
          status: 200,
          body: '<html><title>API</title><main><a href="/api/types">Types</a></main></html>'
        }
      ],
      [
        'https://example.com/api/types',
        { status: 200, body: '<html><title>Types</title><main>Type body</main></html>' }
      ]
    ])
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const page = pages.get(url)
      return new Response(page?.body ?? '', { status: page?.status ?? 404 })
    })
    const directory = mkdtempSync(join(tmpdir(), 'loci-url-review-'))
    temporaryDirectories.push(directory)
    const runtime = createLocalRuntime({ dataDir: directory, cacheDir: join(directory, 'cache') })
    try {
      const source = runtime.createSource({
        name: 'Example',
        url: 'https://example.com/docs',
        mode: 'http',
        pageLimit: 10,
        schedule: null,
        httpConcurrency: 2,
        browserConcurrency: null,
        discoveryMode: 'agent_review',
        reviewGoal: '只收录 API 文档'
      })
      const first = await runtime.urlReviews.start(source.id)
      expect(first.run.status).toBe('awaiting_review')
      expect(first.candidates).toEqual([
        expect.objectContaining({ title: 'API Reference', url: 'https://example.com/api' }),
        expect.objectContaining({ title: 'News', url: 'https://example.com/blog' })
      ])

      const second = await runtime.urlReviews.submit(first.run.id, first.batchId!, [
        'https://example.com/blog'
      ])
      expect(second).toMatchObject({
        run: { status: 'awaiting_review' },
        candidates: [{ title: 'Types', url: 'https://example.com/api/types' }]
      })
      const completed = await runtime.urlReviews.submit(first.run.id, second.batchId!, [])
      expect(completed.run.status).toBe('completed')
      expect(runtime.database.listDocumentCandidates(source.id)).toEqual([
        { url: 'https://example.com/docs', title: 'Docs' },
        { url: 'https://example.com/api', title: 'API' },
        { url: 'https://example.com/api/types', title: 'Types' }
      ])

      pages.set('https://example.com/docs', {
        status: 200,
        body: '<html><title>Docs 2</title><main><a href="/new">New</a></main></html>'
      })
      pages.set('https://example.com/api', { status: 404, body: '' })
      await runtime.crawlSource(source.id)
      expect(runtime.database.listDocumentCandidates(source.id)).toEqual(
        expect.arrayContaining([
          { url: 'https://example.com/docs', title: 'Docs 2' },
          { url: 'https://example.com/api/types', title: 'Types' }
        ])
      )
      expect(runtime.database.listDocumentUrls(source.id)).not.toContain('https://example.com/new')
    } finally {
      await runtime.close()
    }
  })

  it('等待状态可在运行时重启后恢复，且不会默认批准', async () => {
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const body =
        url === 'https://example.com/docs'
          ? '<html><title>Docs</title><main><a href="/api">API</a></main></html>'
          : ''
      return new Response(body, { status: body ? 200 : 404 })
    })
    const directory = mkdtempSync(join(tmpdir(), 'loci-url-resume-'))
    temporaryDirectories.push(directory)
    const create = () =>
      createLocalRuntime({ dataDir: directory, cacheDir: join(directory, 'cache') })
    const firstRuntime = create()
    const source = firstRuntime.createSource({
      name: 'Example',
      url: 'https://example.com/docs',
      mode: 'http',
      pageLimit: 10,
      schedule: null,
      httpConcurrency: 1,
      browserConcurrency: null,
      discoveryMode: 'agent_review',
      reviewGoal: '只收录 API'
    })
    const waiting = await firstRuntime.urlReviews.start(source.id)
    await firstRuntime.close()

    const secondRuntime = create()
    try {
      expect(secondRuntime.urlReviews.get(waiting.run.id)).toMatchObject({
        run: { status: 'awaiting_review' },
        batchId: waiting.batchId
      })
      expect(secondRuntime.isCrawling(source.id)).toBe(true)
      await expect(secondRuntime.crawlSource(source.id)).rejects.toThrow('等待 Agent URL 审查')
      expect(secondRuntime.database.listDocumentUrls(source.id)).toEqual([])
    } finally {
      await secondRuntime.close()
    }
  })

  it('发现请求返回前取消后不再写入候选或覆盖取消终态', async () => {
    const request = deferred<Response>()
    const entered = deferred<void>()
    vi.stubGlobal('fetch', () => {
      entered.resolve()
      return request.promise
    })
    const directory = mkdtempSync(join(tmpdir(), 'loci-url-cancel-discovery-'))
    temporaryDirectories.push(directory)
    const runtime = createLocalRuntime({ dataDir: directory, cacheDir: join(directory, 'cache') })
    try {
      const source = createReviewSource(runtime)
      const pending = runtime.urlReviews.start(source.id)
      await entered.promise
      const active = runtime.urlReviews.getActive(source.id)
      expect(active?.run.status).toBe('discovering')
      expect(runtime.urlReviews.cancel(active!.run.id)).toBe(true)

      request.resolve(
        new Response('- [Late API](https://example.com/late)', {
          status: 200,
          headers: { 'content-type': 'text/markdown' }
        })
      )
      await expect(pending).resolves.toMatchObject({
        run: { status: 'cancelled', discovery: 'new' },
        discoveredCount: 0,
        processedCount: 0
      })
    } finally {
      await runtime.close()
    }
  })

  it('页面请求返回前取消后不写入页面结果或新链接', async () => {
    const pageRequest = deferred<Response>()
    const entered = deferred<void>()
    let blockApi = false
    vi.stubGlobal('fetch', (input: string | URL | Request) => {
      const url = requestUrl(input)
      if (blockApi && url === 'https://example.com/api') {
        entered.resolve()
        return pageRequest.promise
      }
      const body =
        url === 'https://example.com/docs'
          ? '<html><title>Docs</title><main><a href="/api">API</a></main></html>'
          : ''
      return Promise.resolve(new Response(body, { status: body ? 200 : 404 }))
    })
    const directory = mkdtempSync(join(tmpdir(), 'loci-url-cancel-page-'))
    temporaryDirectories.push(directory)
    const runtime = createLocalRuntime({ dataDir: directory, cacheDir: join(directory, 'cache') })
    try {
      const source = createReviewSource(runtime)
      const waiting = await runtime.urlReviews.start(source.id)
      blockApi = true
      const pending = runtime.urlReviews.submit(waiting.run.id, waiting.batchId!, [])
      await entered.promise
      expect(runtime.urlReviews.cancel(waiting.run.id)).toBe(true)

      pageRequest.resolve(
        new Response('<html><title>API</title><main><a href="/late">Late</a></main></html>', {
          status: 200
        })
      )
      await expect(pending).resolves.toMatchObject({
        run: { status: 'cancelled' },
        discoveredCount: 2,
        processedCount: 1
      })
      expect(runtime.database.listUrlReviewDocuments(waiting.run.id)).toEqual([])
    } finally {
      await runtime.close()
    }
  })

  it('取消与页面错误竞争时保留 cancelled，而不是改写为 failed', async () => {
    const pageRequest = deferred<Response>()
    const entered = deferred<void>()
    let blockApi = false
    vi.stubGlobal('fetch', (input: string | URL | Request) => {
      const url = requestUrl(input)
      if (blockApi && url === 'https://example.com/api') {
        entered.resolve()
        return pageRequest.promise
      }
      const body =
        url === 'https://example.com/docs'
          ? '<html><title>Docs</title><main><a href="/api">API</a></main></html>'
          : ''
      return Promise.resolve(new Response(body, { status: body ? 200 : 404 }))
    })
    const directory = mkdtempSync(join(tmpdir(), 'loci-url-cancel-error-'))
    temporaryDirectories.push(directory)
    const runtime = createLocalRuntime({ dataDir: directory, cacheDir: join(directory, 'cache') })
    try {
      runtime.database.saveSettings({ ...runtime.database.getSettings(), maxRetries: 0 })
      const source = createReviewSource(runtime)
      const waiting = await runtime.urlReviews.start(source.id)
      blockApi = true
      const pending = runtime.urlReviews.submit(waiting.run.id, waiting.batchId!, [])
      await entered.promise
      expect(runtime.urlReviews.cancel(waiting.run.id)).toBe(true)

      pageRequest.reject(new Error('late request failure'))
      await expect(pending).resolves.toMatchObject({
        run: { status: 'cancelled', error: null },
        failedCount: 0
      })
    } finally {
      await runtime.close()
    }
  })

  it('另一个 runtime 在 owner 请求中断后继续推进同一活动运行', async () => {
    const firstRequest = deferred<Response>()
    const entered = deferred<void>()
    let firstCall = true
    vi.stubGlobal('fetch', (input: string | URL | Request) => {
      if (firstCall) {
        firstCall = false
        entered.resolve()
        return firstRequest.promise
      }
      const url = requestUrl(input)
      const body =
        url === 'https://example.com/docs'
          ? '<html><title>Docs</title><main><a href="/api">API</a></main></html>'
          : ''
      return Promise.resolve(new Response(body, { status: body ? 200 : 404 }))
    })
    const directory = mkdtempSync(join(tmpdir(), 'loci-url-cross-runtime-'))
    temporaryDirectories.push(directory)
    const create = () =>
      createLocalRuntime({ dataDir: directory, cacheDir: join(directory, 'cache') })
    const firstRuntime = create()
    const source = createReviewSource(firstRuntime)
    const controller = new AbortController()
    const first = firstRuntime.urlReviews.start(source.id, undefined, undefined, controller.signal)
    await entered.promise

    const secondRuntime = create()
    try {
      const second = secondRuntime.urlReviews.start(source.id)
      const reason = new DOMException('request cancelled', 'AbortError')
      controller.abort(reason)
      firstRequest.reject(reason)

      await expect(first).rejects.toBe(reason)
      await expect(second).resolves.toMatchObject({
        run: {
          id: firstRuntime.urlReviews.getActive(source.id)?.run.id,
          status: 'awaiting_review'
        },
        candidates: [{ url: 'https://example.com/api' }]
      })
    } finally {
      await secondRuntime.close()
      await firstRuntime.close()
    }
  })
})
