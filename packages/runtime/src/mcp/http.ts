import { createServer, type Server } from 'node:http'
import { createMcpHandler } from '@modelcontextprotocol/server'
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler
} from '@modelcontextprotocol/node'
import { createLociMcpServer, type LociMcpServices } from './server.js'

export interface McpHttpServer {
  port: number
  endpoint: string
  close: () => Promise<void>
}

const MCP_HEALTH_SERVICE = 'loci-mcp'

// 服务只绑定回环地址，并在进入 MCP handler 前拦截非本机 Host 与 Origin。
export async function startMcpHttpServer(
  requestedPort: number,
  services: LociMcpServices
): Promise<McpHttpServer> {
  const handler = createMcpHandler(() => createLociMcpServer(services))
  const handleMcp = toNodeHandler(handler, {
    onerror: (error) => console.error('MCP 请求处理失败', error)
  })
  const validateHost = localhostHostValidation()
  const validateOrigin = localhostOriginValidation()
  const server = createServer((request, response) => {
    const path = request.url?.split('?')[0]
    if (path === '/health') {
      if (!validateHost(request, response)) return
      response
        .writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        .end(JSON.stringify({ service: MCP_HEALTH_SERVICE }))
      return
    }
    if (path !== '/mcp') {
      response.writeHead(404).end()
      return
    }
    if (!validateHost(request, response) || !validateOrigin(request, response)) return
    void handleMcp(request, response)
  })

  await listen(server, requestedPort)
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : requestedPort
  return {
    port,
    endpoint: `http://127.0.0.1:${port}/mcp`,
    close: async () => {
      await handler.close()
      await close(server)
    }
  }
}

export async function isLociMcpAvailable(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(800)
    })
    if (!response.ok) return false
    const body = (await response.json()) as unknown
    return Boolean(
      body && typeof body === 'object' && 'service' in body && body.service === MCP_HEALTH_SERVICE
    )
  } catch {
    return false
  }
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function close(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
}
