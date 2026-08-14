import { McpServer } from '@modelcontextprotocol/server'
import type { LociMcpServices } from './services.js'
import { createMcpToolRegistrar, registerLociTools } from './tool-registry.js'

export type { LociMcpServices } from './services.js'

// 所有入口共享同一组工具定义，MCP 层不维护第二份业务逻辑。
export function createLociMcpServer(services: LociMcpServices): McpServer {
  const server = new McpServer({ name: 'loci-mcp-server', version: '1.1.0' })
  registerLociTools(createMcpToolRegistrar(server), services)
  return server
}
