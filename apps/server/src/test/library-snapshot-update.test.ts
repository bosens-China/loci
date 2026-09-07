import { afterEach, describe, expect, it } from 'vitest'
import { AdminAuth } from '../auth.js'
import { createApp } from '../app.js'
import { ServerDatabase } from '../database.js'
import { SyncService } from '../sync-service.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})

function fixture(urls: string[]) {
  const database = new ServerDatabase(':memory:')
  const sync = new SyncService(database)
  const auth = new AdminAuth('admin', 'secret')
  const app = createApp({ database, sync, auth })
  cleanup.push(async () => {
    await sync.close()
    database.close()
  })
  const input = {
    name: 'Docs',
    url: 'https://docs.example.com/docs',
    scopePath: '/',
    pageLimit: 10,
    schedule: null
  }
  const library = database.createLibrary(input)
  for (const url of urls) {
    database.saveDocument(library.id, {
      url,
      title: url,
      markdown: `# ${url}`,
      language: 'en',
      crawledAt: new Date().toISOString(),
      fetchMode: 'http'
    })
  }
  const headers = {
    Authorization: `Bearer ${auth.login('admin', 'secret')}`,
    'Content-Type': 'application/json'
  }
  return { database, app, input, library, headers }
}

describe('修改文档库后的公开快照', () => {
  it('缩小范围后目录、正文与下载快照一致，旧 ETag 不能命中且重试幂等', async () => {
    const kept = 'https://docs.example.com/docs/guide'
    const removed = 'https://docs.example.com/blog/post'
    const { database, app, input, library, headers } = fixture([kept, removed])
    database.publishSnapshot(library.id)
    const snapshotPath = `/api/v1/libraries/${library.id}/snapshot`
    const before = await app.request(snapshotPath)
    const oldEtag = before.headers.get('etag')!
    const update = () =>
      app.request(`/api/v1/admin/libraries/${library.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ ...input, scopePath: '/docs' })
      })

    expect((await update()).status).toBe(200)
    expect(database.listDocumentUrls(library.id)).toEqual([kept])
    const snapshot = await app.request(snapshotPath, { headers: { 'If-None-Match': oldEtag } })
    expect(snapshot.status).toBe(200)
    expect(snapshot.headers.get('etag')).not.toBe(oldEtag)
    expect(await snapshot.json()).toMatchObject({ documents: [{ url: kept }] })
    const files = await app.request(`/api/v1/libraries/${library.id}/files`)
    expect(await files.json()).toMatchObject({ total: 1, items: [{ url: kept }] })
    expect(await (await app.request('/api/v1/libraries')).json()).toMatchObject({
      libraries: [{ id: library.id, pages: 1 }]
    })

    expect((await update()).status).toBe(200)
    expect(
      (
        await app.request(snapshotPath, {
          headers: { 'If-None-Match': snapshot.headers.get('etag')! }
        })
      ).status
    ).toBe(304)
  })

  it.each(['scope', 'url'] as const)('通过 %s 清空正文后撤销公开快照', async (change) => {
    const { database, app, input, library, headers } = fixture([
      'https://docs.example.com/blog/post'
    ])
    database.publishSnapshot(library.id)
    const response = await app.request(`/api/v1/admin/libraries/${library.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(
        change === 'scope'
          ? { ...input, scopePath: '/docs' }
          : { ...input, url: 'https://other.example.com/docs' }
      )
    })

    expect(response.status).toBe(200)
    expect(database.listDocumentUrls(library.id)).toEqual([])
    expect((await app.request(`/api/v1/libraries/${library.id}/snapshot`)).status).toBe(404)
    expect(await (await app.request('/api/v1/libraries')).json()).toEqual({ libraries: [] })
  })

  it('未发布的工作文档不会因配置修改而自动发布', async () => {
    const { app, input, library, headers } = fixture(['https://docs.example.com/docs/guide'])
    expect(
      (
        await app.request(`/api/v1/admin/libraries/${library.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ ...input, scopePath: '/docs' })
        })
      ).status
    ).toBe(200)
    expect((await app.request(`/api/v1/libraries/${library.id}/snapshot`)).status).toBe(404)
  })
})
