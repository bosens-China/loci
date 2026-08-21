import { describe, expect, it } from 'vitest'
import {
  getMcpClientDefinition,
  isAgentGlobalRulesClient,
  isAgentClient,
  isMcpClient,
  listAgentGlobalRulesClients,
  listImportableAgentClients,
  listMcpClients
} from '../mcp-clients.js'

describe('MCP 客户端共享目录', () => {
  it('统一列出五个具名客户端和五个可自动写入客户端', () => {
    expect(listMcpClients().map((client) => client.id)).toEqual([
      'codex',
      'cursor',
      'vscode',
      'claude-code',
      'antigravity'
    ])
    expect(listImportableAgentClients().map((client) => client.id)).toEqual([
      'codex',
      'cursor',
      'vscode',
      'claude-code',
      'antigravity'
    ])
  })

  it('区分具名客户端和可自动写入客户端', () => {
    expect(isMcpClient('antigravity')).toBe(true)
    expect(isAgentClient('antigravity')).toBe(true)
    expect(isAgentClient('codex')).toBe(true)
    expect(isMcpClient('unknown')).toBe(false)
    expect(isMcpClient('gemini-cli')).toBe(false)
    expect(getMcpClientDefinition('codex').executable).toBe('codex')
    expect(listAgentGlobalRulesClients().map((client) => client.id)).toEqual([
      'codex',
      'vscode',
      'claude-code',
      'antigravity'
    ])
    expect(isAgentGlobalRulesClient('cursor')).toBe(false)
    expect(isAgentGlobalRulesClient('antigravity')).toBe(true)
  })
})
