import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminAuth } from './auth.js'
import { createApp } from './app.js'
import { ServerDatabase } from './database.js'
import { SyncService } from './sync-service.js'

interface LoginResponse {
  token: string
}

interface LibraryResponse {
  library: { id: string }
}

interface JobResponse {
  job: { id: string }
}

describe('Loci Server API', () => {
  const cleanup: Array<() => void> = []

  afterEach(() => cleanup.splice(0).forEach((close) => close()))

  it('公开读取、管理员写入，并把抓取结果发布成可缓存快照', async () => {
    const database = new ServerDatabase(':memory:')
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/sitemap.xml')) return new Response('', { status: 404 })
      return new Response(
        '<html lang="en"><title>Docs</title><main><h1>Docs</h1><p>Hello</p></main></html>',
        { status: 200 }
      )
    })
    const sync = new SyncService(database, fetchImpl)
    const app = createApp({ database, sync, auth: new AdminAuth('admin', 'secret') })
    cleanup.push(() => {
      sync.close()
      database.close()
    })

    expect((await app.request('/api/v1/libraries')).status).toBe(200)
    expect((await app.request('/api/v1/admin/libraries', { method: 'GET' })).status).toBe(401)

    const login = await app.request('/api/v1/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'secret' })
    })
    const { token } = (await login.json()) as LoginResponse
    const authorization = `Bearer ${token}`

    const created = await app.request('/api/v1/admin/libraries', {
      method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Example Docs',
        url: 'https://docs.example.com/start',
        pageLimit: 10,
        schedule: null
      })
    })
    expect(created.status).toBe(201)
    const { library } = (await created.json()) as LibraryResponse

    const started = await app.request(`/api/v1/admin/libraries/${library.id}/sync`, {
      method: 'POST',
      headers: { Authorization: authorization }
    })
    expect(started.status).toBe(202)
    const { job } = (await started.json()) as JobResponse
    expect((await sync.wait(job.id))?.status).toBe('completed')

    const catalog = await app.request('/api/v1/libraries')
    const catalogBody = (await catalog.json()) as {
      libraries: Array<{ id: string; revision: string }>
    }
    expect(catalogBody.libraries).toHaveLength(1)

    const snapshot = await app.request(`/api/v1/libraries/${library.id}/snapshot`)
    expect(snapshot.status).toBe(200)
    expect(snapshot.headers.get('etag')).toContain('sha256:')
    expect(
      (
        (await snapshot.json()) as {
          documents: Array<{ markdown: string }>
        }
      ).documents[0]?.markdown
    ).toContain('Hello')

    expect(
      (
        await app.request(`/api/v1/libraries/${library.id}/snapshot`, {
          headers: { 'If-None-Match': snapshot.headers.get('etag') ?? '' }
        })
      ).status
    ).toBe(304)
  })
})
