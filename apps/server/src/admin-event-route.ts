import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { streamSSE } from 'hono/streaming'
import { AdminAuth, readBearerToken } from './auth.js'
import { createSerializedSseWriter } from './sse-writer.js'
import { SyncService } from './sync-service.js'

/** 管理事件只发送 revision；认证状态和 SSE 生命周期由此路由统一管理。 */
export function createAdminEventsHandler(
  sync: SyncService,
  auth: AdminAuth
): (context: Context) => Response {
  return (context) => {
    const token = readBearerToken(context.req.header('Authorization'))
    if (!token) throw new HTTPException(401, { message: '需要管理员登录' })
    return streamSSE(context, async (stream) => {
      let release = (): void => undefined
      let finished = false
      let finish: () => void = () => undefined
      const completed = new Promise<void>((resolve) => {
        finish = () => {
          if (finished) return
          finished = true
          release()
          resolve()
        }
      })
      const writer = createSerializedSseWriter(stream, finish)
      release = sync.resourceEvents.subscribe((revisions) => {
        writer.enqueue({ event: 'revisions', data: JSON.stringify(revisions) })
      })
      const heartbeat = setInterval(() => {
        if (auth.verify(token)) {
          writer.enqueue({ event: 'heartbeat', data: '{}' })
          return
        }
        finish()
      }, 15_000)
      stream.onAbort(finish)
      await completed
      clearInterval(heartbeat)
    })
  }
}
