import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CloudCatalogItem, CreateSourceInput } from '@loci/shared'
import { startLocalHttpServer } from '../local-http-server.js'
import { createLocalRuntime } from '../local-runtime.js'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

describe('本机 HTTP 服务', () => {
  it('直接开放回环 API，并继续保护跨来源写请求', async () => {
    const root = mkdtempSync(join(tmpdir(), 'loci-http-'))
    const runtime = createLocalRuntime({
      dataDir: join(root, 'data'),
      cacheDir: join(root, 'cache')
    })
    const startJobWorker = vi.fn(async () => undefined)
    const ensurePersistentBackground = vi.fn(async () => undefined)
    const server = await startLocalHttpServer(runtime, {
      startJobWorker,
      ensurePersistentBackground
    })
    cleanups.push(async () => {
      await server.close()
      await runtime.close()
      rmSync(root, { recursive: true, force: true })
    })

    const health = await fetch(`${server.endpoint}/health`)
    expect(await health.json()).toEqual({ service: 'loci-local-web', pid: process.pid })
    const sources = await fetch(`${server.endpoint}/api/sources`)
    expect(sources.status).toBe(200)
    expect(await sources.json()).toEqual([])

    const input: CreateSourceInput = {
      name: 'Example',
      url: 'https://example.com/docs',
      mode: 'auto',
      pageLimit: 10,
      scopePath: '/docs',
      schedule: '0 2 * * *',
      httpConcurrency: null,
      browserConcurrency: null
    }
    const rejected = await fetch(`${server.endpoint}/api/sources?sync=true`, {
      method: 'POST',
      headers: { origin: 'https://example.com', 'content-type': 'application/json' },
      body: JSON.stringify(input)
    })
    expect(rejected.status).toBe(403)

    const created = await fetch(`${server.endpoint}/api/sources?sync=true`, {
      method: 'POST',
      headers: { origin: server.endpoint, 'content-type': 'application/json' },
      body: JSON.stringify(input)
    })
    expect(created.status).toBe(201)
    const result = (await created.json()) as {
      source: { name: string }
      sync: { reused: boolean }
      workerError: string | null
    }
    expect(result.source.name).toBe('Example')
    expect(result.sync.reused).toBe(false)
    expect(result.workerError).toBeNull()
    expect(startJobWorker).toHaveBeenCalledOnce()
    expect(ensurePersistentBackground).toHaveBeenCalledOnce()
  })

  it('worker 启动失败时仍确认来源和任务已保存', async () => {
    const root = mkdtempSync(join(tmpdir(), 'loci-http-worker-error-'))
    const runtime = createLocalRuntime({
      dataDir: join(root, 'data'),
      cacheDir: join(root, 'cache')
    })
    const server = await startLocalHttpServer(runtime, {
      startJobWorker: async () => {
        throw new Error('worker unavailable')
      }
    })
    cleanups.push(async () => {
      await server.close()
      await runtime.close()
      rmSync(root, { recursive: true, force: true })
    })
    const response = await fetch(`${server.endpoint}/api/sources?sync=true`, {
      method: 'POST',
      headers: { origin: server.endpoint, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Saved source',
        url: 'https://example.com',
        mode: 'http',
        pageLimit: 1,
        scopePath: '/',
        schedule: null,
        httpConcurrency: null,
        browserConcurrency: null
      } satisfies CreateSourceInput)
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      source: { name: 'Saved source' },
      sync: { reused: false },
      workerError: 'worker unavailable'
    })
    expect(runtime.database.listSources()).toHaveLength(1)
    expect(runtime.database.listLocalJobs()).toHaveLength(1)
  })

  it('重复同步同一来源时复用活动任务', async () => {
    const root = mkdtempSync(join(tmpdir(), 'loci-http-job-'))
    const runtime = createLocalRuntime({
      dataDir: join(root, 'data'),
      cacheDir: join(root, 'cache')
    })
    const source = runtime.createSource({
      name: 'Example',
      url: 'https://example.com',
      mode: 'http',
      pageLimit: 1,
      schedule: null,
      httpConcurrency: null,
      browserConcurrency: null
    })
    const first = runtime.database.enqueueSourceSync(source.id, 'ui')
    const second = runtime.database.enqueueSourceSync(source.id, 'ui')
    expect(second.reused).toBe(true)
    expect(second.job.id).toBe(first.job.id)
    await runtime.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('提供云端目录并通过浏览器备份恢复本地库', async () => {
    const root = mkdtempSync(join(tmpdir(), 'loci-http-data-'))
    const runtime = createLocalRuntime({
      dataDir: join(root, 'data'),
      cacheDir: join(root, 'cache')
    })
    const source = runtime.createSource({
      name: 'Local docs',
      url: 'https://example.com/docs',
      mode: 'http',
      pageLimit: 10,
      schedule: '0 2 * * *',
      httpConcurrency: null,
      browserConcurrency: null
    })
    const cloudItem: CloudCatalogItem = {
      id: 'cloud-docs',
      name: 'Cloud docs',
      url: 'https://example.com/cloud',
      revision: 'rev-1',
      pages: 2,
      contentSize: 1024,
      lastCrawledAt: null,
      publishedAt: '2026-08-20T00:00:00.000Z',
      localSourceId: null,
      localRevision: null,
      autoSync: false,
      updateAvailable: false
    }
    vi.spyOn(runtime.cloud, 'listCatalog').mockResolvedValue([cloudItem])
    const server = await startLocalHttpServer(runtime, {
      runMaintenance: async (action) => action(),
      ensurePersistentBackground: async () => {
        throw new Error('persistent worker unavailable')
      }
    })
    cleanups.push(async () => {
      await server.close()
      await runtime.close()
      rmSync(root, { recursive: true, force: true })
    })
    const headers = { origin: server.endpoint, 'content-type': 'application/json' }

    const catalog = await fetch(`${server.endpoint}/api/cloud/catalog`)
    expect(await catalog.json()).toEqual([cloudItem])

    const exported = await fetch(`${server.endpoint}/api/data/export`)
    expect(exported.headers.get('content-disposition')).toContain('loci-backup-')
    const backup = await exported.json()
    runtime.deleteSource(source.id)
    expect(runtime.database.listSources()).toHaveLength(0)

    const imported = await fetch(`${server.endpoint}/api/data/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify(backup)
    })
    expect(await imported.json()).toEqual({
      sources: 1,
      documents: 0,
      backgroundError: 'persistent worker unavailable'
    })
    expect(runtime.database.listSources()[0]?.name).toBe('Local docs')
  })
})
