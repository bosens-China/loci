import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createZipArchive } from '@loci/core'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { startLocalHttpServer } from '../local-http-server.js'
import { createLocalRuntime, type LocalRuntime } from '../local-runtime.js'
import { acquireCrawlRuntimeLock, readRuntimeLock } from '../runtime-lock.js'

let dir: string, runtime: LocalRuntime
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'loci-clear-data-'))
  runtime = createLocalRuntime({ dataDir: dir, cacheDir: dir })
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await runtime.close()
  rmSync(dir, { recursive: true, force: true })
})

it('本机 API 按范围清理数据及索引，保留设置并允许重新收录相同 GitHub 提交', async () => {
  const realFetch = globalThis.fetch
  const repository = runtime.createSource({
    url: 'https://github.com/owner/repo',
    category: '参考',
    version: 'v1'
  })
  const archive = await createZipArchive(
    [{ path: 'repo-same/README.md', buffer: Buffer.from('# GitHub\n\nsnapshottoken') }],
    4096,
    '测试归档超限'
  )
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.hostname === 'api.github.com') {
      return Response.json(
        url.pathname.endsWith('/branches/main')
          ? { commit: { sha: 'same' } }
          : { private: false, default_branch: 'main' }
      )
    }
    if (url.hostname === 'codeload.github.com') return new Response(Uint8Array.from(archive))
    return realFetch(input, init)
  })
  await runtime.crawlSource(repository.id)
  const web = runtime.createSource({ url: 'https://docs.test' })
  runtime.database.registerExplicitPageTargets(web.id, ['https://docs.test/guide'])
  runtime.patchAppSettings({ theme: 'dark' })
  const server = await startLocalHttpServer(runtime)
  const clear = (scope: string) =>
    realFetch(server.endpoint + '/api/data/clear', {
      method: 'POST',
      body: JSON.stringify({ scope })
    })
  try {
    const counts = await realFetch(server.endpoint + '/api/data/counts')
    expect(await counts.json()).toEqual({ libraries: 2, documents: 1 })
    expect((await clear('wrong')).status).toBe(400)
    const busy = acquireCrawlRuntimeLock(dir, repository.id, '抓取')
    try {
      expect((await clear('sources')).status).toBe(409)
    } finally {
      busy.release()
    }
    expect(runtime.searchDocuments({ queries: 'snapshottoken' }).total).toBe(1)

    const documents = await clear('documents')
    expect(documents.status).toBe(200)
    expect(await documents.json()).toEqual({ scope: 'documents', libraries: 0, documents: 1 })
    expect(runtime.searchDocuments({ queries: 'snapshottoken' }).total).toBe(0)
    expect(runtime.listLibraries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: repository.id, category: '参考', version: 'v1' })
      ])
    )
    expect(runtime.database.listExplicitPageTargets(web.id)).toHaveLength(1)
    expect(await runtime.crawlSource(repository.id)).toMatchObject({ succeeded: 1 })
    expect(
      runtime.readDocuments({ libraryId: repository.id, targets: '/README.md' })[0]?.content
    ).toContain('snapshottoken')

    const sources = await clear('sources')
    expect(sources.status).toBe(200)
    expect(await sources.json()).toEqual({ scope: 'sources', libraries: 2, documents: 1 })
    expect(runtime.listLibraries()).toEqual([])
    expect(runtime.database.listCrawlHistory()).toEqual([])
    expect(runtime.database.listExplicitPageTargets(web.id)).toEqual([])
    expect(runtime.database.getSettings().theme).toBe('dark')
    expect(runtime.listCategories()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: '参考' })])
    )
  } finally {
    await server.close()
  }
})

it('清库失败整笔回滚，释放锁后可以重试', async () => {
  const library = runtime.createSource({ url: 'https://clear.test' })
  runtime.createDocument(library.id, { title: 'Guide', path: '/guide', content: 'rollbacktoken' })
  const sqlite = new DatabaseSync(join(dir, 'loci.sqlite'))
  try {
    sqlite.exec(`CREATE TRIGGER test_reject_clear BEFORE DELETE ON document_sources
      BEGIN SELECT RAISE(ABORT, 'test rollback'); END`)
    await expect(runtime.clearData('sources')).rejects.toThrow()
    expect(runtime.getClearDataCounts()).toEqual({ libraries: 1, documents: 1 })
    expect(runtime.searchDocuments({ queries: 'rollbacktoken' }).total).toBe(1)
    sqlite.exec('DROP TRIGGER test_reject_clear')
    await expect(runtime.clearData('sources')).resolves.toMatchObject({
      libraries: 1,
      documents: 1
    })
  } finally {
    sqlite.close()
  }
})

it('跨进程清库共享结果，取消等待者与冲突范围不会影响原操作', async () => {
  const library = runtime.createSource({ url: 'https://clear.test' })
  runtime.createDocument(library.id, { title: 'Guide', path: '/guide', content: 'doc' })
  const script = `
    import { createLocalRuntime } from './src/local-runtime.ts'
    const runtime = createLocalRuntime({ dataDir: process.argv[1], cacheDir: process.argv[1] })
    process.send('ready')
    process.once('message', async () => {
      try { process.send(await runtime.clearData('sources')) }
      finally { await runtime.close(); process.disconnect() }
    })
  `
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', script, dir],
    { cwd: new URL('../../', import.meta.url), stdio: ['ignore', 'ignore', 'inherit', 'ipc'] }
  )
  const closed = once(child, 'close')
  const sqlite = new DatabaseSync(join(dir, 'loci.sqlite'))
  try {
    expect((await Promise.race([once(child, 'message'), closed]))[0]).toBe('ready')
    const reply = once(child, 'message')
    sqlite.exec('BEGIN IMMEDIATE')
    child.send('clear')
    await vi.waitFor(() =>
      expect(readRuntimeLock(dir, 'maintenance')?.maintenanceOperation?.hash).toBe('clear:sources')
    )
    await expect(runtime.clearData('documents')).rejects.toMatchObject({
      name: 'RuntimeLockedError'
    })
    const abort = new AbortController()
    const canceled = runtime.clearData('sources', abort.signal)
    abort.abort()
    await expect(canceled).rejects.toMatchObject({ name: 'AbortError' })
    const follower = runtime.clearData('sources')
    sqlite.exec('COMMIT')
    const summary = { scope: 'sources', libraries: 1, documents: 1 }
    expect((await Promise.race([reply, closed]))[0]).toEqual(summary)
    await expect(follower).resolves.toEqual(summary)
    await expect(runtime.clearData('sources')).resolves.toMatchObject({
      libraries: 0,
      documents: 0
    })
  } finally {
    sqlite.close()
    child.kill()
    await closed
  }
}, 15000)
