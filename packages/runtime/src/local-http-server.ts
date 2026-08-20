import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { localhostHostValidation, localhostOriginValidation } from '@modelcontextprotocol/node'
import type { LocalJob } from './local-job-database.js'
import type { LocalRuntime } from './local-runtime.js'
import { handleLocalApi, type LocalApiOptions } from './local-http-api.js'
import { json } from './local-http-response.js'

export interface LocalHttpServer {
  port: number
  endpoint: string
  publishJob: (job: LocalJob) => void
  close: () => Promise<void>
}

export interface LocalHttpServerOptions extends LocalApiOptions {
  port?: number
  controlToken: string
  assetsDir?: string
}

const SESSION_COOKIE = 'loci_session'
const TOKEN_TTL_MS = 60_000

/** 本机 Web transport：静态页面可公开加载，读取和写入 API 都要求进程内会话。 */
export async function startLocalHttpServer(
  runtime: LocalRuntime,
  options: LocalHttpServerOptions
): Promise<LocalHttpServer> {
  const validateHost = localhostHostValidation()
  const validateOrigin = localhostOriginValidation()
  const webTokens = new Map<string, number>()
  const sessions = new Set<string>()
  const events = new Set<ServerResponse>()
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      console.error('本地 Web 请求处理失败', error)
      if (response.headersSent) {
        response.end()
        return
      }
      json(response, 500, { error: '本地服务处理请求失败' })
    })
  })

  const handleRequest = async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> => {
    if (!validateHost(request, response)) return
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'GET' && url.pathname === '/health') {
      json(response, 200, {
        service: 'loci-local-service',
        pid: process.pid
      })
      return
    }
    if (request.method === 'POST' && url.pathname === '/control/session') {
      if (!matchesBearer(request, options.controlToken)) {
        json(response, 401, { error: '控制凭据无效' })
        return
      }
      const token = randomToken()
      webTokens.set(token, Date.now() + TOKEN_TTL_MS)
      json(response, 200, { token })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/session') {
      const token = readBearer(request)
      const expiresAt = token ? webTokens.get(token) : undefined
      if (!token || !expiresAt || expiresAt < Date.now()) {
        json(response, 401, { error: '启动会话已失效，请重新运行 loci ui' })
        return
      }
      webTokens.delete(token)
      const session = randomToken()
      sessions.add(session)
      response.setHeader(
        'set-cookie',
        `${SESSION_COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`
      )
      json(response, 200, { authenticated: true })
      return
    }
    if (url.pathname.startsWith('/api/')) {
      if (!hasSession(request, sessions)) {
        json(response, 401, { error: '请通过 loci ui 打开页面' })
        return
      }
      if (request.method !== 'GET' && !validateOrigin(request, response)) return
      await handleLocalApi(runtime, request, response, url, events, options)
      return
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end()
      return
    }
    serveAsset(response, url.pathname, options.assetsDir, request.method === 'HEAD')
  }

  await listen(server, options.port ?? 0)
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : (options.port ?? 0)
  return {
    port,
    endpoint: `http://127.0.0.1:${port}`,
    publishJob: (job) => {
      const payload = `event: job\ndata: ${JSON.stringify(job)}\n\n`
      for (const response of events) response.write(payload)
    },
    close: async () => {
      for (const response of events) response.end()
      events.clear()
      await close(server)
    }
  }
}

function serveAsset(
  response: ServerResponse,
  pathname: string,
  assetsDir: string | undefined,
  headOnly: boolean
): void {
  if (!assetsDir) {
    const body = fallbackHtml
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(body)
    })
    response.end(headOnly ? undefined : body)
    return
  }
  const root = resolve(assetsDir)
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1))
  let file = resolve(root, requested)
  if (file !== root && !file.startsWith(`${root}${sep}`)) {
    response.writeHead(404).end()
    return
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html')
  if (!existsSync(file)) {
    response.writeHead(404).end()
    return
  }
  const stat = statSync(file)
  response.writeHead(200, {
    'content-type': contentType(file),
    'content-length': stat.size,
    'cache-control': file.endsWith('index.html')
      ? 'no-cache'
      : 'public, max-age=31536000, immutable'
  })
  if (headOnly) response.end()
  else createReadStream(file).pipe(response)
}

function hasSession(request: IncomingMessage, sessions: Set<string>): boolean {
  const cookie = request.headers.cookie ?? ''
  const value = cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1)
  return Boolean(value && sessions.has(value))
}

function matchesBearer(request: IncomingMessage, expected: string): boolean {
  const actual = readBearer(request)
  if (!actual) return false
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  )
}

function readBearer(request: IncomingMessage): string | null {
  const header = request.headers.authorization
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
}

function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

function contentType(path: string): string {
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
      '.json': 'application/json; charset=utf-8'
    }[extname(path)] ?? 'application/octet-stream'
  )
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolvePromise()
    })
  })
}

function close(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise()))
  )
}

const fallbackHtml = `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><title>Loci</title>
<body><main><h1>Loci 后台服务已启动</h1><p>Web UI 资源尚未安装，请重新安装或构建 Loci CLI。</p></main></body></html>`
