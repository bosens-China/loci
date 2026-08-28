import { describe, expect, it } from 'vitest'
import { AdminAuth } from '../auth.js'
import { createApp } from '../app.js'
import { ServerDatabase } from '../database.js'
import { SyncService } from '../sync-service.js'

describe('管理员 SSE 事件', () => {
  it('要求 Bearer 认证，并先发送当前持久 revision', async () => {
    const database = new ServerDatabase(':memory:')
    const sync = new SyncService(database)
    const auth = new AdminAuth('admin', 'secret')
    const app = createApp({ database, sync, auth })
    try {
      expect((await app.request('/api/v1/admin/events')).status).toBe(401)
      const token = auth.login('admin', 'secret')!
      const response = await app.request('/api/v1/admin/events', {
        headers: { Authorization: `Bearer ${token}` }
      })
      expect(response.headers.get('content-type')).toContain('text/event-stream')
      const reader = response.body?.getReader()
      if (!reader) throw new Error('未建立 Server SSE 响应体')
      const first = await reader.read()
      const frame = new TextDecoder().decode(first.value)
      expect(frame).toContain('event: revisions')
      expect(frame).toContain('"libraries":0')
      await reader.cancel()
    } finally {
      await sync.close()
      database.close()
    }
  })
})
