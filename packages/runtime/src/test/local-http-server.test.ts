import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CloudCatalogItem, CreateSourceInput, ResourceRevisions } from '@loci/shared'
import { startLocalHttpServer } from '../local-http-server.js'
import { createLocalRuntime } from '../local-runtime.js'

const cleanups: Array<() => Promise<void> | void> = []
const skillResourceDir = fileURLToPath(
  new URL('../../../../.agents/skills/use-loci/', import.meta.url)
)

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

describe('本机 HTTP 服务', () => {
  it('文档列表只返回元数据，并在选中时按 ID 读取正文', async () => {
    const root = mkdtempSync(join(tmpdir(), 'loci-http-documents-'))
    const runtime = createLocalRuntime({
      dataDir: join(root, 'data'),
      cacheDir: join(root, 'cache')
    })
    const firstSource = runtime.createSource({
      name: 'First docs',
      url: 'https://first.example.com',
      mode: 'http',
      pageLimit: 1,
      schedule: null,
      httpConcurrency: null,
      browserConcurrency: null
    })
    const secondSource = runtime.createSource({
      name: 'Second docs',
      url: 'https://second.example.com',
      mode: 'http',
      pageLimit: 1,
      schedule: null,
      httpConcurrency: null,
      browserConcurrency: null
    })
    runtime.database.saveDocument({
      sourceId: firstSource.id,
      url: 'https://first.example.com/guide',
      title: 'First guide',
      markdown: '# First body',
      language: 'en',
      fetchMode: 'http',
      crawledAt: '2026-08-22T00:00:00.000Z'
    })
    runtime.database.saveDocument({
      sourceId: secondSource.id,
      url: 'https://second.example.com/guide',
      title: 'Second guide',
      markdown: '# Second body',
      language: 'en',
      fetchMode: 'http',
      crawledAt: '2026-08-22T00:00:00.000Z'
    })
    const server = await startLocalHttpServer(runtime, {})
    cleanups.push(async () => {
      await server.close()
      await runtime.close()
      rmSync(root, { recursive: true, force: true })
    })

    const list = await fetch(
      `${server.endpoint}/api/documents?source=${encodeURIComponent(firstSource.id)}`
    )
    expect(list.status).toBe(200)
    const summaries = (await list.json()) as Array<Record<string, unknown>>
    expect(summaries).toEqual([
      expect.objectContaining({ sourceId: firstSource.id, title: 'First guide' })
    ])
    expect(summaries[0]).not.toHaveProperty('content')

    const documentId = summaries[0]?.id
    expect(typeof documentId).toBe('string')
    if (typeof documentId !== 'string') throw new Error('文档列表未返回文档 ID')
    const document = await fetch(`${server.endpoint}/api/documents/${documentId}`)
    expect(await document.json()).toMatchObject({
      sourceId: firstSource.id,
      content: '# First body'
    })
    expect((await fetch(`${server.endpoint}/api/documents/missing`)).status).toBe(404)
  })

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
    const initialRevisions = (await (
      await fetch(`${server.endpoint}/api/revisions`)
    ).json()) as ResourceRevisions

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
    const revisions = (await (
      await fetch(`${server.endpoint}/api/revisions`)
    ).json()) as ResourceRevisions
    expect(revisions.sources).toBeGreaterThan(initialRevisions.sources)
    expect(revisions.jobs).toBeGreaterThan(initialRevisions.jobs)
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
      workerError: expect.any(String)
    })
    expect(runtime.database.listSources()).toHaveLength(1)
    expect(runtime.database.listLocalJobs()).toHaveLength(1)
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
    const headers = { origin: server.endpoint, 'content-type': 'application/zip' }

    const catalog = await fetch(`${server.endpoint}/api/cloud/catalog`)
    expect(await catalog.json()).toEqual([cloudItem])

    const exported = await fetch(`${server.endpoint}/api/data/export`)
    expect(exported.headers.get('content-disposition')).toContain('loci-backup-')
    expect(exported.headers.get('content-type')).toBe('application/zip')
    const backup = Buffer.from(await exported.arrayBuffer())
    runtime.deleteSource(source.id)
    expect(runtime.database.listSources()).toHaveLength(0)

    const imported = await fetch(`${server.endpoint}/api/data/import`, {
      method: 'POST',
      headers,
      body: backup
    })
    expect(await imported.json()).toEqual({
      sources: 1,
      documents: 0,
      backgroundError: 'persistent worker unavailable'
    })
    expect(runtime.database.listSources()[0]?.name).toBe('Local docs')
  })

  it('通过受 Origin 保护的本机接口管理 Agent 全局接入', async () => {
    const root = mkdtempSync(join(tmpdir(), 'loci-http-agent-'))
    const runtime = createLocalRuntime({
      dataDir: join(root, 'data'),
      cacheDir: join(root, 'cache'),
      agentIntegration: {
        homeDir: join(root, 'home'),
        packageVersion: '1.13.0',
        skillResourceDir,
        setupMcp: async (client, options) => {
          const { writeAgentMcpConfigFile } = await import('../agent-mcp-config.js')
          const { LOCI_CLI_STDIO_CONNECTION } = await import('../agent-import.js')
          writeAgentMcpConfigFile(client, LOCI_CLI_STDIO_CONNECTION, options)
        }
      }
    })
    const server = await startLocalHttpServer(runtime, {})
    cleanups.push(async () => {
      await server.close()
      await runtime.close()
      rmSync(root, { recursive: true, force: true })
    })

    const listed = await fetch(`${server.endpoint}/api/agents`)
    expect(listed.status).toBe(200)
    expect(await listed.json()).toHaveLength(5)

    const rejected = await fetch(`${server.endpoint}/api/agents/antigravity/setup`, {
      method: 'POST',
      headers: { origin: 'https://example.com' }
    })
    expect(rejected.status).toBe(403)

    const setupResponse = await fetch(`${server.endpoint}/api/agents/antigravity/setup`, {
      method: 'POST',
      headers: { origin: server.endpoint }
    })
    expect(await setupResponse.json()).toMatchObject({ status: { overall: 'ready' } })
  })
})
