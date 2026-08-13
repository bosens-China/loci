export type McpTransport = 'stdio' | 'http'

export type McpImportStrategy = 'codex-cli' | 'cursor-cli' | 'vscode-cli' | 'claude-cli' | 'manual'

interface McpClientEntry {
  id: string
  label: string
  configPath: string
  globalRulesPath: string
  globalRulesWrite: boolean
  transports: readonly McpTransport[]
  quickImport: boolean
  executable: string | null
  importStrategy: McpImportStrategy
}

/**
 * MCP 客户端的单一能力目录，桌面端、CLI 与运行时共同消费。
 */
export const MCP_CLIENTS = [
  {
    id: 'codex',
    label: 'Codex',
    configPath: '~/.codex/config.toml',
    globalRulesPath: '~/.codex/AGENTS.md',
    globalRulesWrite: true,
    transports: ['stdio', 'http'],
    quickImport: true,
    executable: 'codex',
    importStrategy: 'codex-cli'
  },
  {
    id: 'cursor',
    label: 'Cursor',
    configPath: '~/.cursor/mcp.json',
    globalRulesPath: 'Customize → Rules → User Rules',
    globalRulesWrite: false,
    transports: ['stdio', 'http'],
    quickImport: true,
    executable: 'cursor',
    importStrategy: 'cursor-cli'
  },
  {
    id: 'vscode',
    label: 'VS Code',
    configPath: '用户配置 mcp.json',
    globalRulesPath: '~/.copilot/instructions/loci.instructions.md',
    globalRulesWrite: true,
    transports: ['stdio', 'http'],
    quickImport: true,
    executable: 'code',
    importStrategy: 'vscode-cli'
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    configPath: '~/.claude.json',
    globalRulesPath: '~/.claude/CLAUDE.md',
    globalRulesWrite: true,
    transports: ['stdio', 'http'],
    quickImport: true,
    executable: 'claude',
    importStrategy: 'claude-cli'
  },
  {
    id: 'antigravity',
    label: 'Google Antigravity',
    configPath: '~/.gemini/config/mcp_config.json',
    globalRulesPath: '~/.gemini/GEMINI.md',
    globalRulesWrite: true,
    transports: ['http'],
    quickImport: false,
    executable: null,
    importStrategy: 'manual'
  }
] as const satisfies readonly McpClientEntry[]

export const GENERIC_MCP_CONFIG_TARGET = {
  id: 'generic',
  label: '其他 MCP 客户端',
  configPath: '客户端 MCP 配置文件',
  transports: ['stdio', 'http']
} as const

export type McpClientDefinition = (typeof MCP_CLIENTS)[number]
export type McpClient = McpClientDefinition['id']
export type AgentClient = McpClient
export type AgentGlobalRulesClient = Extract<McpClientDefinition, { globalRulesWrite: true }>['id']
export type McpConfigTarget = McpClient | typeof GENERIC_MCP_CONFIG_TARGET.id

export function listMcpClients(): readonly McpClientDefinition[] {
  return MCP_CLIENTS
}

export function listImportableAgentClients(): readonly McpClientDefinition[] {
  return MCP_CLIENTS
}

export function listAgentGlobalRulesClients(): ReadonlyArray<
  Extract<McpClientDefinition, { globalRulesWrite: true }>
> {
  return MCP_CLIENTS.filter(
    (client): client is Extract<McpClientDefinition, { globalRulesWrite: true }> =>
      client.globalRulesWrite
  )
}

export function isMcpClient(value: unknown): value is McpClient {
  return typeof value === 'string' && MCP_CLIENTS.some((client) => client.id === value)
}

export function isAgentClient(value: unknown): value is AgentClient {
  return isMcpClient(value)
}

export function isAgentGlobalRulesClient(value: unknown): value is AgentGlobalRulesClient {
  return isMcpClient(value) && getMcpClientDefinition(value).globalRulesWrite
}

export function getMcpClientDefinition(client: McpClient): McpClientDefinition {
  const definition = MCP_CLIENTS.find((item) => item.id === client)
  if (!definition) throw new Error(`未知 MCP 客户端：${client}`)
  return definition
}

export function supportsMcpTransport(client: McpClient, transport: McpTransport): boolean {
  return getMcpClientDefinition(client).transports.some((item) => item === transport)
}
