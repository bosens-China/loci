import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  createRevisionEventStream,
  type BrowserOperationStatus,
  type ResourceRevisions,
  type ServerResourceRevisions
} from '@loci/shared'
import type { LocalRuntime } from './local-runtime.js'

interface LocalEventClient {
  response: ServerResponse
  close: () => void
}

export interface LocalHttpEvents {
  handle: (request: IncomingMessage, response: ServerResponse, url: URL) => boolean
  close: () => void
}

/**
 * 浏览器只连接本机 SSE；本地 revision 与远端管理员 revision 都由 Runtime 代理。
 * 远端 Token 从不写入 SSE 数据，也不进入浏览器。
 */
export function createLocalHttpEvents(runtime: LocalRuntime, intervalMs = 1_000): LocalHttpEvents {
  const clients = new Set<LocalEventClient>()
  const localEvents = createRevisionEventStream(
    () => runtime.database.getResourceRevisions(),
    intervalMs
  )
  let releaseLocal: (() => void) | undefined
  let remoteAbort: AbortController | undefined
  let closed = false

  let releaseBrowser: (() => void) | undefined

  const broadcast = (
    name: 'local-revisions' | 'admin-revisions' | 'browser-operation',
    data: unknown
  ): void => {
    const frame = `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
    for (const client of clients) {
      if (!client.response.destroyed) client.response.write(frame)
    }
  }
  const ensureStreams = (): void => {
    if (!releaseLocal) {
      releaseLocal = localEvents.subscribe((revisions: ResourceRevisions) =>
        broadcast('local-revisions', revisions)
      )
    }
    if (!releaseBrowser) {
      releaseBrowser = runtime.browserManager.subscribe((operation: BrowserOperationStatus) =>
        broadcast('browser-operation', operation)
      )
    }
    if (!remoteAbort && runtime.admin.getSession()) startRemoteStream()
  }
  const stopStreams = (): void => {
    releaseLocal?.()
    releaseLocal = undefined
    releaseBrowser?.()
    releaseBrowser = undefined
    remoteAbort?.abort()
    remoteAbort = undefined
  }
  const startRemoteStream = (): void => {
    const controller = new AbortController()
    remoteAbort = controller
    void followRemoteRevisions(runtime, controller.signal, (revisions) => {
      broadcast('admin-revisions', revisions)
    }).finally(() => {
      if (remoteAbort === controller) remoteAbort = undefined
    })
  }
  const removeClient = (client: LocalEventClient): void => {
    clients.delete(client)
    if (clients.size === 0) stopStreams()
  }

  return {
    handle: (request, response, url) => {
      if (request.method !== 'GET' || url.pathname !== '/api/events') return false
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive'
      })
      response.flushHeaders()
      const client: LocalEventClient = {
        response,
        close: () => response.end()
      }
      clients.add(client)
      response.once('close', () => removeClient(client))
      ensureStreams()
      return true
    },
    close: () => {
      if (closed) return
      closed = true
      stopStreams()
      localEvents.close()
      for (const client of clients) client.close()
      clients.clear()
    }
  }
}

async function followRemoteRevisions(
  runtime: LocalRuntime,
  signal: AbortSignal,
  onRevisions: (revisions: ServerResourceRevisions) => void
): Promise<void> {
  while (!signal.aborted && runtime.admin.getSession()) {
    try {
      await runtime.admin.streamResourceRevisions(signal, onRevisions)
    } catch {
      // 网络短暂断开时保持本机 SSE 可用，等待后由同一 Runtime 重新连接。
    }
    if (!signal.aborted && runtime.admin.getSession()) await waitForRetry(signal)
  }
}

function waitForRetry(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 1_000)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}
