import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { streamSSE } from 'hono/streaming'
import { AdminAuth, readBearerToken } from './auth.js'
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
      let finish: (() => void) | undefined
      const completed = new Promise<void>((resolve) => {
        finish = resolve
      })
      const release = sync.resourceEvents.subscribe((revisions) => {
        void stream.writeSSE({ event: 'revisions', data: JSON.stringify(revisions) })
      })
      const heartbeat = setInterval(() => {
        if (auth.verify(token)) {
          void stream.writeSSE({ event: 'heartbeat', data: '{}' })
          return
        }
        release()
        finish?.()
        void stream.close()
      }, 15_000)
      stream.onAbort(() => {
        release()
        finish?.()
      })
      await completed
      clearInterval(heartbeat)
      release()
    })
  }
}
