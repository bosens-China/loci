import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CloudAdminSession, CloudLibrary, CloudSyncJob } from '@loci/shared'
import { startLocalHttpServer } from '../local-http-server.js'
import { createLocalRuntime } from '../local-runtime.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})

describe('本机 Admin API', () => {
  it('代理登录、文档库和同步任务且不返回远程 Token', async () => {
    const root = mkdtempSync(join(tmpdir(), 'loci-http-admin-'))
    const runtime = createLocalRuntime({
      dataDir: join(root, 'data'),
      cacheDir: join(root, 'cache')
    })
    const server = await startLocalHttpServer(runtime, {})
    cleanups.push(async () => {
      await server.close()
      await runtime.close()
      rmSync(root, { recursive: true, force: true })
    })
    const session: CloudAdminSession = {
      serverUrl: 'https://loci.example.com',
      username: 'admin',
      expiresAt: '2026-08-22T00:00:00.000Z'
    }
    const library = cloudLibrary()
    const job = cloudJob()
    vi.spyOn(runtime.admin, 'login').mockResolvedValue(session)
    vi.spyOn(runtime.admin, 'getSession').mockReturnValue(session)
    vi.spyOn(runtime.admin, 'listLibraries').mockResolvedValue([library])
    vi.spyOn(runtime.admin, 'createLibrary').mockResolvedValue(library)
    vi.spyOn(runtime.admin, 'updateLibrary').mockResolvedValue(library)
    vi.spyOn(runtime.admin, 'deleteLibrary').mockResolvedValue()
    vi.spyOn(runtime.admin, 'syncLibraries').mockResolvedValue([job])
    vi.spyOn(runtime.admin, 'listSyncJobs').mockResolvedValue([job])
    vi.spyOn(runtime.admin, 'cancelSyncJob').mockResolvedValue({ ...job, status: 'canceling' })
    vi.spyOn(runtime.admin, 'logout').mockResolvedValue()

    const headers = { origin: server.endpoint, 'content-type': 'application/json' }
    const login = await fetch(`${server.endpoint}/api/admin/login`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ username: 'admin', password: 'secret' })
    })
    expect(await login.json()).toEqual(session)
    expect(
      JSON.stringify(await (await fetch(`${server.endpoint}/api/admin/session`)).json())
    ).not.toContain('token')
    expect(await (await fetch(`${server.endpoint}/api/admin/libraries`)).json()).toEqual([library])

    const input = {
      name: library.name,
      url: library.url,
      scopePath: library.scopePath,
      pageLimit: library.pageLimit,
      schedule: library.schedule
    }
    expect(await requestJson(server.endpoint, '/api/admin/libraries', 'POST', input)).toEqual(
      library
    )
    expect(
      await requestJson(server.endpoint, `/api/admin/libraries/${library.id}`, 'PUT', input)
    ).toEqual(library)

    const sync = await fetch(`${server.endpoint}/api/admin/libraries/sync`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ libraryIds: [library.id] })
    })
    expect(sync.status).toBe(202)
    expect(await sync.json()).toEqual([job])
    expect(await (await fetch(`${server.endpoint}/api/admin/jobs`)).json()).toEqual([job])
    expect(await requestJson(server.endpoint, `/api/admin/jobs/${job.id}/cancel`, 'POST')).toEqual({
      ...job,
      status: 'canceling'
    })
    expect(
      await requestJson(server.endpoint, `/api/admin/libraries/${library.id}`, 'DELETE')
    ).toEqual({ deleted: true })
    expect(await requestJson(server.endpoint, '/api/admin/logout', 'POST')).toEqual({
      authenticated: false
    })
  })

  it('切换 Server 地址时清除旧管理员会话', async () => {
    const root = mkdtempSync(join(tmpdir(), 'loci-http-admin-settings-'))
    const runtime = createLocalRuntime({
      dataDir: join(root, 'data'),
      cacheDir: join(root, 'cache')
    })
    const logout = vi.spyOn(runtime.admin, 'logout').mockResolvedValue()
    const server = await startLocalHttpServer(runtime, {})
    cleanups.push(async () => {
      await server.close()
      await runtime.close()
      rmSync(root, { recursive: true, force: true })
    })

    const settings = runtime.database.getSettings()
    const saved = await requestJson(server.endpoint, '/api/settings', 'PUT', {
      ...settings,
      serverUrl: 'https://next.loci.example.com'
    })

    expect(saved).toMatchObject({ serverUrl: 'https://next.loci.example.com' })
    expect(logout).toHaveBeenCalledOnce()
  })
})

async function requestJson(
  endpoint: string,
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: unknown
): Promise<unknown> {
  const response = await fetch(`${endpoint}${path}`, {
    method,
    headers: { origin: endpoint, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  return response.json()
}

function cloudLibrary(): CloudLibrary {
  return {
    id: 'library-1',
    name: 'Hono',
    url: 'https://hono.dev/docs',
    hostname: 'hono.dev',
    scopePath: '/docs',
    pageLimit: 1000,
    schedule: null,
    pages: 12,
    lastCrawledAt: null,
    lastError: null,
    revision: null,
    publishedAt: null
  }
}

function cloudJob(): CloudSyncJob {
  return {
    id: 'job-1',
    libraryId: 'library-1',
    status: 'queued',
    createdAt: '2026-08-21T00:00:00.000Z',
    finishedAt: null,
    progress: null,
    failures: [],
    error: null
  }
}
