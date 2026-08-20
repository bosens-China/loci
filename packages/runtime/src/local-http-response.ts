import type { IncomingMessage, ServerResponse } from 'node:http'

export async function readJson(request: IncomingMessage, maxBytes = 1_048_576): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new Error(`请求内容不能超过 ${formatMegabytes(maxBytes)} MB`)
    chunks.push(buffer)
  }
  if (chunks.length === 0) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new Error('请求 JSON 无效')
  }
}

export function json(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  response
    .writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers })
    .end(JSON.stringify(body))
}

export async function mutationJson(
  response: ServerResponse,
  status: number,
  action: () => unknown | Promise<unknown>
): Promise<void> {
  try {
    json(response, status, await action())
  } catch (error) {
    json(response, 400, { error: safeClientError(error) })
  }
}

export function safeClientError(error: unknown): string {
  const message = error instanceof Error ? error.message : '本地服务请求失败'
  return /SQLITE|database|ENOENT|EACCES|\/Users\//iu.test(message) ? '请求无法完成' : message
}

function formatMegabytes(bytes: number): number {
  return Math.ceil(bytes / 1024 / 1024)
}
