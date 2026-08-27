import { describe, expect, it, vi } from 'vitest'
import { CloudAdminClient } from '../cloud-admin-client.js'

describe('CloudAdminClient', () => {
  it('只向渲染进程返回脱敏会话，并为管理请求附加令牌', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ token: 'secret-token', expiresIn: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ libraries: [] }))
      .mockResolvedValueOnce(jsonResponse({ job: syncJob() }))
    const client = new CloudAdminClient(fetcher)

    const session = await client.login('https://docs.example.com/', {
      username: 'admin',
      password: 'password'
    })
    await client.listLibraries()
    expect((await client.getSyncJob('job-1')).status).toBe('running')

    expect(session).toEqual(
      expect.objectContaining({ serverUrl: 'https://docs.example.com', username: 'admin' })
    )
    expect(session).not.toHaveProperty('token')
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe(
      'Bearer secret-token'
    )
    expect(fetcher.mock.calls[2]?.[0]).toBe('https://docs.example.com/api/v1/admin/jobs/job-1')
  })

  it('收到 401 后清除管理员会话', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ token: 'secret-token', expiresIn: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ error: '管理员会话无效或已过期' }, 401))
    const client = new CloudAdminClient(fetcher)
    await client.login('http://localhost:3000', {
      username: 'admin',
      password: 'password'
    })

    await expect(client.listLibraries()).rejects.toThrow()
    expect(client.getSession()).toBeNull()
  })

  it('提交批量同步并支持任务列表与取消', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ token: 'secret-token', expiresIn: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ jobs: [syncJob()] }))
      .mockResolvedValueOnce(jsonResponse({ jobs: [syncJob()] }))
      .mockResolvedValueOnce(jsonResponse({ job: { ...syncJob(), status: 'canceling' } }))
    const client = new CloudAdminClient(fetcher)
    await client.login('https://docs.example.com', { username: 'admin', password: 'password' })

    expect(await client.syncLibraries(['library-1'])).toHaveLength(1)
    expect(await client.listSyncJobs()).toHaveLength(1)
    expect((await client.cancelSyncJob('job-1')).status).toBe('canceling')
    expect(fetcher.mock.calls[1]?.[0]).toBe('https://docs.example.com/api/v1/admin/libraries/sync')
    expect(fetcher.mock.calls[1]?.[1]?.body).toBe('{"libraryIds":["library-1"]}')
    expect(fetcher.mock.calls[3]?.[0]).toBe(
      'https://docs.example.com/api/v1/admin/jobs/job-1/cancel'
    )
  })

  it('拒绝非 HTTP 服务器地址', async () => {
    const client = new CloudAdminClient(vi.fn<typeof fetch>())
    await expect(
      client.login('file:///tmp/server', { username: 'admin', password: 'password' })
    ).rejects.toThrow()
  })
})

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function syncJob(): Record<string, unknown> {
  return {
    id: 'job-1',
    libraryId: 'library-1',
    hostname: 'docs.example.com',
    status: 'running',
    priority: 0,
    paused: false,
    pauseRequested: false,
    stopRequested: false,
    partial: false,
    contentBytes: 0,
    remainingCount: 0,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
    finishedAt: null,
    progress: null,
    failures: [],
    error: null
  }
}
