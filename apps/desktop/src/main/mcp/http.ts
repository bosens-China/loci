import { createServer, type Server } from 'node:http'
import { createMcpHandler } from '@modelcontextprotocol/server'
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler
} from '@modelcontextprotocol/node'
import { createLociMcpServer, type LociMcpServices } from './server'

export interface McpHttpServer {
  port: number
  endpoint: string
  close: () => Promise<void>
}

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
    if (request.url?.split('?')[0] !== '/mcp') {
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
