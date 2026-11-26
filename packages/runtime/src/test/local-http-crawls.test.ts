import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createLocalRuntime } from '../local-runtime.js'
import { startLocalHttpServer } from '../local-http-server.js'
import { DOCUMENT_SOURCE_DEFAULTS } from '@loci/shared'

it('前台重复同步共享进度，取消保留上次正文，重试完成后原子替换', async () => {
  let hold = true
  let pageRequests = 0
  const site = createServer((req, res) => {
    if (req.url !== '/guide') {
      res.writeHead(404).end()
      return
    }
    pageRequests++
    if (!hold) res.end('<html><title>Guide</title><main>New revision</main></html>')
  })
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve))
  const address = site.address()
  if (!address || typeof address === 'string') throw new Error('测试端口不可用')
  const root = mkdtempSync(join(tmpdir(), 'loci-http-crawl-'))
  const runtime = createLocalRuntime({ dataDir: root, cacheDir: root })
  const server = await startLocalHttpServer(runtime)
  try {
    const url = `http://127.0.0.1:${address.port}/guide`
    const library = runtime.createSource({
      ...DOCUMENT_SOURCE_DEFAULTS,
      name: 'Guide',
      url,
      mode: 'http',
      pageLimit: 1
    })
    runtime.database.saveDocument({
      sourceId: library.id,
      url,
      title: 'Old',
      language: 'en',
      fetchMode: 'http',
      markdown: 'Previous revision',
      crawledAt: new Date().toISOString()
    })
    const path = `${server.endpoint}/api/libraries/${library.id}/`
    const post = (action: string) =>
      fetch(path + action, { method: 'POST', headers: { origin: server.endpoint } })
    const state = async () => (await fetch(path + 'crawl')).json()
    const starts = await Promise.all([post('sync'), post('sync')])
    expect(starts.map((r) => r.status)).toEqual([202, 202])
    await vi.waitFor(() => expect(pageRequests).toBe(1))
    expect(await state()).toMatchObject({ status: 'running', progress: { processed: 0 } })
    await post('crawl/cancel')
    await vi.waitFor(async () => expect(await state()).toMatchObject({ status: 'cancelled' }))
    const persisted = await (await fetch(path + 'crawl-status')).json()
    expect(persisted).toMatchObject({
      libraryId: library.id,
      status: 'cancelled',
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
      progress: { currentUrl: url },
      error: expect.any(String)
    })
    expect(await (await fetch(`${server.endpoint}/api/libraries/crawl-status`)).json()).toEqual([
      persisted
    ])
    expect(runtime.readDocuments({ libraryId: library.id, targets: '/guide' })[0]?.content).toBe(
      'Previous revision'
    )
    expect(runtime.database.listCrawlHistory(library.id)).toHaveLength(1)
    hold = false
    expect((await post('sync')).status).toBe(202)
    await vi.waitFor(async () =>
      expect(await state()).toMatchObject({ status: 'completed', progress: { succeeded: 1 } })
    )
    expect(
      runtime.readDocuments({ libraryId: library.id, targets: '/guide' })[0]?.content
    ).toContain('New revision')
  } finally {
    site.closeAllConnections()
    await server.close()
    await runtime.close()
    await new Promise<void>((resolve) => site.close(() => resolve()))
    rmSync(root, { recursive: true, force: true })
  }
})
