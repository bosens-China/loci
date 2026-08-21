import {
  GENERIC_MCP_CONFIG_TARGET,
  getMcpClientDefinition,
  type McpConfigTarget
} from './mcp-clients.js'

export interface McpAgentConnection {
  type: 'stdio'
  command: string
  args: readonly string[]
}

/**
 * 生成 Cursor 风格的通用 MCP 配置，供没有内置导入能力的客户端手动接入。
 */
export function createCursorMcpConfig(connection: McpAgentConnection): string {
  return JSON.stringify(
    {
      mcpServers: {
        loci: { command: connection.command, args: [...connection.args] }
      }
    },
    null,
    2
  )
}

/**
 * 按客户端实际约定生成可复制配置，不把通用 mcpServers JSON 误当作统一协议格式。
 */
export function createMcpClientConfig(
  target: McpConfigTarget,
  connection: McpAgentConnection
): string {
  if (target === GENERIC_MCP_CONFIG_TARGET.id) return createCursorMcpConfig(connection)

  getMcpClientDefinition(target)

  switch (target) {
    case 'codex':
      return createCodexConfig(connection)
    case 'cursor':
      return createCursorMcpConfig(connection)
    case 'vscode':
      return createVsCodeConfig(connection)
    case 'claude-code':
      return createClaudeConfig(connection)
    case 'antigravity':
      return createAntigravityConfig(connection)
  }
}

function createCodexConfig(connection: McpAgentConnection): string {
  const args = connection.args.map((argument) => JSON.stringify(argument)).join(', ')
  return `[mcp_servers.loci]\ncommand = ${JSON.stringify(connection.command)}\nargs = [${args}]`
}

function createVsCodeConfig(connection: McpAgentConnection): string {
  const server = { type: 'stdio', command: connection.command, args: [...connection.args] }
  return JSON.stringify({ servers: { loci: server } }, null, 2)
}

function createClaudeConfig(connection: McpAgentConnection): string {
  const server = { type: 'stdio', command: connection.command, args: [...connection.args] }
  return JSON.stringify({ mcpServers: { loci: server } }, null, 2)
}

function createAntigravityConfig(connection: McpAgentConnection): string {
  return JSON.stringify(
    {
      mcpServers: {
        loci: { command: connection.command, args: [...connection.args] }
      }
    },
    null,
    2
  )
}
