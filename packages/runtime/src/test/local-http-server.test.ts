import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startLocalHttpServer } from '../local-http-server.js'
import { acquireCrawlRuntimeLock } from '../runtime-lock.js'
import { createLocalRuntime } from '../local-runtime.js'

const cleanups: Array<() => Promise<void> | void> = []
const skillResourceDir = fileURLToPath(
  new URL('../../../../.agents/skills/use-loci/', import.meta.url)
)

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
  vi.unstubAllEnvs()
})

describe('本机 HTTP 服务', () => {
  it('POST 复用同身份库并只更新显式配置', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'loci-upsert-'))
    const runtime = createLocalRuntime({ dataDir: dir, cacheDir: dir })
    const server = await startLocalHttpServer(runtime)
    cleanups.push(async () => {
      await server.close()
      await runtime.close()
      rmSync(dir, { recursive: true, force: true })
    })
    const first = runtime.createSource({
      name: 'Original',
      url: 'https://example.test/guide',
      mode: 'http',
      browserConcurrency: 3,
      pageLimit: 10
    })
    const lock = acquireCrawlRuntimeLock(dir, first.id, '测试抓取')
    try {
      const locked = await fetch(`${server.endpoint}/api/libraries`, {
        method: 'POST',
        body: JSON.stringify({
          name: '变更',
          category: '事务测试',
          version: 'latest',
          url: first.url
        })
      })
      expect(locked.status).toBe(409)
      expect(runtime.listCategories().some((row) => row.name === '事务测试')).toBe(false)
      expect(runtime.database.getSource(first.id)).toMatchObject({
        name: 'Original',
        version: 'latest'
      })
    } finally {
      lock.release()
    }
    const result = await fetch(`${server.endpoint}/api/libraries`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Second',
        category: ' 工具/团队 ',
        version: ' latest ',
        url: 'https://example.test/api',
        httpConcurrency: 4
      })
    })
    expect(result.status).toBe(201)
    expect(await result.json()).toMatchObject({
      id: first.id,
      name: 'Second',
      category: '工具/团队',
      version: 'latest',
      url: first.url,
      httpConcurrency: 4,
      browserConcurrency: 3,
      mode: 'http',
      pageLimit: 10
    })
    const endpoint = `${server.endpoint}/api/categories`
    const categories = await (await fetch(endpoint)).json()
    expect(categories).toContainEqual(
      expect.objectContaining({ name: '工具/团队', libraryCount: 1 })
    )
    const created = await (
      await fetch(endpoint, { method: 'POST', body: JSON.stringify({ name: '工具/团队' }) })
    ).json()
    expect(categories).toContainEqual(created)
    const updated = await fetch(`${server.endpoint}/api/libraries/${first.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'Second', url: first.url, category: '新/类别', version: 'v2' })
    })
    expect(await updated.json()).toMatchObject({ category: '新/类别', version: 'v2' })
    const params = new URLSearchParams({ query: 'Second', category: '新/类别', version: 'v2' })
    expect(await (await fetch(`${server.endpoint}/api/libraries?${params}`)).json()).toMatchObject([
      { id: first.id }
    ])
    for (const deleted of [true, false]) {
      const response = await fetch(`${endpoint}/${encodeURIComponent('新/类别')}`, {
        method: 'DELETE'
      })
      expect(await response.json()).toEqual({ deleted })
    }
    expect(runtime.database.getSource(first.id)).toMatchObject({
      category: '未分类',
      version: 'v2'
    })
    const denied = await fetch(`${endpoint}/${encodeURIComponent('未分类')}`, { method: 'DELETE' })
    expect(denied.status).toBe(400)
    expect(await denied.json()).toMatchObject({ error: expect.stringContaining('未分类') })
  })

  it('修改已抓取 GitHub 库的分类时保留已解析的抓取方式和提交', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'loci-github-category-'))
    const runtime = createLocalRuntime({ dataDir: dir, cacheDir: dir })
    const server = await startLocalHttpServer(runtime)
    cleanups.push(async () => {
      await server.close()
      await runtime.close()
      rmSync(dir, { recursive: true, force: true })
    })
    const { id, name, url } = runtime.createSource({ url: 'https://github.com/owner/repo' })
    runtime.database.updateResolvedSource(
      id,
      url,
      'http',
      null,
      { defaultBranch: 'main', revision: 'resolved-commit' },
      'github'
    )
    const response = await fetch(`${server.endpoint}/api/libraries`, {
      method: 'POST',
      body: JSON.stringify({ name, url, category: '工具与其他' })
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      id,
      category: '工具与其他',
      resolvedDiscovery: 'github',
      mode: 'http'
    })
    expect(runtime.database.getSourceConfig(id).githubRevision).toBe('resolved-commit')
  })

  it('通过 ZIP 备份恢复本地库', async () => {
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
      httpConcurrency: null,
      browserConcurrency: null
    })
    const server = await startLocalHttpServer(runtime)
    cleanups.push(async () => {
      await server.close()
      await runtime.close()
      rmSync(root, { recursive: true, force: true })
    })
    const headers = { origin: server.endpoint, 'content-type': 'application/zip' }

    const exported = await fetch(
      `${server.endpoint}/api/data/export?category=${encodeURIComponent('其他')}&category=${encodeURIComponent('未分类')}`
    )
    expect(exported.headers.get('content-disposition')).toContain('loci-backup-')
    expect(exported.headers.get('content-type')).toBe('application/zip')
    const backup = Buffer.from(await exported.arrayBuffer())
    runtime.deleteLibrary(source.id)
    expect(runtime.database.listSources()).toHaveLength(0)

    const invalid = await fetch(`${server.endpoint}/api/data/import?mode=typo`, {
      method: 'POST',
      headers,
      body: backup
    })
    expect(invalid.status).toBe(400)
    const imported = await fetch(`${server.endpoint}/api/data/import`, {
      method: 'POST',
      headers,
      body: backup
    })
    expect(await imported.json()).toMatchObject({
      mode: 'merge',
      sources: 1,
      documents: 0
    })
    expect(runtime.database.listSources()[0]?.name).toBe('Local docs')
  })

  it('通过受 Origin 保护的本机接口管理 Agent 全局接入', async () => {
    const root = mkdtempSync(join(tmpdir(), 'loci-http-agent-'))
    vi.stubEnv('PI_CODING_AGENT_DIR', undefined)
    const runtime = createLocalRuntime({
      dataDir: join(root, 'data'),
      cacheDir: join(root, 'cache'),
      agentIntegration: {
        homeDir: join(root, 'home'),
        packageVersion: '1.13.0',
        skillResourceDir
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
    expect(await listed.json()).toContainEqual(expect.objectContaining({ client: 'pi' }))

    const rejected = await fetch(`${server.endpoint}/api/agents/pi/setup`, {
      method: 'POST',
      headers: { origin: 'https://example.com' }
    })
    expect(rejected.status).toBe(403)

    const setupResponse = await fetch(`${server.endpoint}/api/agents/pi/setup`, {
      method: 'POST',
      headers: { origin: server.endpoint }
    })
    expect(await setupResponse.json()).toMatchObject({ status: { client: 'pi', overall: 'ready' } })
  })
})
