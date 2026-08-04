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
