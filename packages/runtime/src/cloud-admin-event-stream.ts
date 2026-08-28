import { z } from 'zod'
import type { ServerResourceRevisions } from '@loci/shared'

const errorResponseSchema = z.object({ error: z.string() })
const revisionsSchema = z.object({
  libraries: z.number().int().nonnegative(),
  jobs: z.number().int().nonnegative(),
  hostnamePolicies: z.number().int().nonnegative(),
  crawlSettings: z.number().int().nonnegative(),
  auditLogs: z.number().int().nonnegative()
})

export interface CloudAdminEventSession {
  serverUrl: string
  token: string
}

/** Runtime 使用管理员 Token 读取远端事件流，浏览器不会接触此连接。 */
export async function streamServerResourceRevisions(
  fetcher: typeof fetch,
  session: CloudAdminEventSession,
  signal: AbortSignal,
  onRevisions: (revisions: ServerResourceRevisions) => void
): Promise<'unauthorized' | void> {
  let response: Response
  try {
    response = await fetcher(`${session.serverUrl}/api/v1/admin/events`, {
      headers: { Authorization: `Bearer ${session.token}` },
      signal
    })
  } catch {
    if (signal.aborted) return
    throw new Error('无法连接云端服务器，请检查地址和网络')
  }
  if (!response.ok) {
    if (response.status === 401) return 'unauthorized'
    const body: unknown = await response.json().catch(() => null)
    const parsed = errorResponseSchema.safeParse(body)
    throw new Error(parsed.success ? parsed.data.error : `服务器请求失败（${response.status}）`)
  }
  if (!response.body) throw new Error('云端服务器未返回事件流')
  await readRevisions(response.body, signal, onRevisions)
}

async function readRevisions(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onRevisions: (revisions: ServerResourceRevisions) => void
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  try {
    while (!signal.aborted) {
      const chunk = await reader.read()
      if (chunk.done) break
      pending += decoder.decode(chunk.value, { stream: true })
      let boundary = pending.search(/\r?\n\r?\n/u)
      while (boundary >= 0) {
        const frame = pending.slice(0, boundary)
        pending = pending.slice(boundary).replace(/^\r?\n\r?\n/u, '')
        const event = readEvent(frame)
        if (event?.name === 'revisions') {
          try {
            const parsed = revisionsSchema.safeParse(JSON.parse(event.data))
            if (parsed.success) onRevisions(parsed.data)
          } catch {
            // 断帧或异常 Server 数据不可影响本机已有 SSE 连接。
          }
        }
        boundary = pending.search(/\r?\n\r?\n/u)
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function readEvent(frame: string): { name: string; data: string } | null {
  const lines = frame.split(/\r?\n/u)
  const name = lines
    .find((line) => line.startsWith('event:'))
    ?.slice('event:'.length)
    .trim()
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart())
    .join('\n')
  return name && data ? { name, data } : null
}
