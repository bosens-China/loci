import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { localhostHostValidation, localhostOriginValidation } from '@modelcontextprotocol/node'
import type { LocalRuntime } from './local-runtime.js'
import { handleLocalApi, type LocalApiOptions } from './local-http-api.js'
import { createLocalHttpEvents } from './local-http-events.js'
import { json } from './local-http-response.js'

export interface LocalHttpServer {
  port: number
  endpoint: string
  close: () => Promise<void>
}

export interface LocalHttpServerOptions extends LocalApiOptions {
  port?: number
  assetsDir?: string
  /** 仅供集成测试缩短 SSE revision 的持久化检查间隔。 */
  revisionEventIntervalMs?: number
}

/** 本机 Web transport：只绑定回环地址，写请求额外校验 Origin。 */
export async function startLocalHttpServer(
  runtime: LocalRuntime,
  options: LocalHttpServerOptions
): Promise<LocalHttpServer> {
  const validateHost = localhostHostValidation()
  const validateOrigin = localhostOriginValidation()
  const events = createLocalHttpEvents(runtime, options.revisionEventIntervalMs)
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
        service: 'loci-local-web',
        pid: process.pid
      })
      return
    }
    if (url.pathname.startsWith('/api/')) {
      if (request.method !== 'GET' && !validateOrigin(request, response)) return
      if (events.handle(request, response, url)) return
      await handleLocalApi(runtime, request, response, url, options)
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
    close: async () => {
      events.close()
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
<body><main><h1>Loci Web 服务已启动</h1><p>Web UI 资源尚未安装，请重新安装或构建 Loci CLI。</p></main></body></html>`
