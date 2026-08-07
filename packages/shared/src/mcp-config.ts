import {
  GENERIC_MCP_CONFIG_TARGET,
  getMcpClientDefinition,
  supportsMcpTransport,
  type McpConfigTarget
} from './mcp-clients.js'

export type McpAgentConnection =
  { type: 'http'; endpoint: string } | { type: 'stdio'; command: string; args: readonly string[] }

/**
 * 生成 Cursor 风格的通用 MCP 配置，供没有内置导入能力的客户端手动接入。
 */
export function createCursorMcpConfig(connection: McpAgentConnection): string {
  const server =
    connection.type === 'http'
      ? { url: connection.endpoint }
      : { command: connection.command, args: [...connection.args] }

  return JSON.stringify({ mcpServers: { loci: server } }, null, 2)
}

/**
 * 按客户端实际约定生成可复制配置，不把通用 mcpServers JSON 误当作统一协议格式。
 */
export function createMcpClientConfig(
  target: McpConfigTarget,
  connection: McpAgentConnection
): string {
  if (target === GENERIC_MCP_CONFIG_TARGET.id) return createCursorMcpConfig(connection)

  const definition = getMcpClientDefinition(target)
  if (!supportsMcpTransport(target, connection.type)) {
    throw new Error(`${definition.label} 不支持 ${connection.type} 传输`)
  }

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
  if (connection.type === 'http') {
    return `[mcp_servers.loci]\nurl = ${JSON.stringify(connection.endpoint)}`
  }
  const args = connection.args.map((argument) => JSON.stringify(argument)).join(', ')
  return `[mcp_servers.loci]\ncommand = ${JSON.stringify(connection.command)}\nargs = [${args}]`
}

function createVsCodeConfig(connection: McpAgentConnection): string {
  const server =
    connection.type === 'http'
      ? { type: 'http', url: connection.endpoint }
      : { type: 'stdio', command: connection.command, args: [...connection.args] }
  return JSON.stringify({ servers: { loci: server } }, null, 2)
}

function createClaudeConfig(connection: McpAgentConnection): string {
  const server =
    connection.type === 'http'
      ? { type: 'http', url: connection.endpoint }
      : { type: 'stdio', command: connection.command, args: [...connection.args] }
  return JSON.stringify({ mcpServers: { loci: server } }, null, 2)
}

function createAntigravityConfig(connection: McpAgentConnection): string {
  if (connection.type !== 'http') throw new Error('Google Antigravity 不支持 stdio 传输')
  return JSON.stringify({ mcpServers: { loci: { serverUrl: connection.endpoint } } }, null, 2)
}
