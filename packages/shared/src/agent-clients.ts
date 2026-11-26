interface AgentClientEntry {
  id: string
  label: string
  globalRulesPath: string
  globalRulesWrite: boolean
}

/**
 * Agent 客户端的单一能力目录，CLI 与运行时共同消费。
 */
export const AGENT_CLIENTS = [
  {
    id: 'codex',
    label: 'Codex',
    globalRulesPath: '~/.codex/AGENTS.md',
    globalRulesWrite: true
  },
  {
    id: 'cursor',
    label: 'Cursor',
    globalRulesPath: '~/.cursor/rules/loci.mdc',
    globalRulesWrite: true
  },
  {
    id: 'vscode',
    label: 'VS Code',
    globalRulesPath: '~/.copilot/instructions/loci.instructions.md',
    globalRulesWrite: true
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    globalRulesPath: '~/.claude/CLAUDE.md',
    globalRulesWrite: true
  },
  {
    id: 'antigravity',
    label: 'Google Antigravity',
    globalRulesPath: '~/.gemini/GEMINI.md',
    globalRulesWrite: true
  }
] as const satisfies readonly AgentClientEntry[]

export type AgentClientDefinition = (typeof AGENT_CLIENTS)[number]
export type AgentClient = AgentClientDefinition['id']
export type AgentGlobalRulesClient = Extract<
  AgentClientDefinition,
  { globalRulesWrite: true }
>['id']

export function listAgentClients(): readonly AgentClientDefinition[] {
  return AGENT_CLIENTS
}

export function isAgentClient(value: unknown): value is AgentClient {
  return typeof value === 'string' && AGENT_CLIENTS.some((client) => client.id === value)
}

export function isAgentGlobalRulesClient(value: unknown): value is AgentGlobalRulesClient {
  return isAgentClient(value) && getAgentClientDefinition(value).globalRulesWrite
}

export function getAgentClientDefinition(client: AgentClient): AgentClientDefinition {
  const definition = AGENT_CLIENTS.find((item) => item.id === client)
  if (!definition) throw new Error(`未知 Agent 客户端：${client}`)
  return definition
}
