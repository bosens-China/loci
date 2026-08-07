import { describe, expect, it } from 'vitest'
import {
  getMcpClientDefinition,
  isAgentGlobalRulesClient,
  isAgentClient,
  isMcpClient,
  listAgentGlobalRulesClients,
  listImportableAgentClients,
  listMcpClients,
  supportsMcpTransport
} from '../mcp-clients.js'

describe('MCP 客户端共享目录', () => {
  it('统一列出五个具名客户端和四个可自动写入客户端', () => {
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
      'claude-code'
    ])
  })

  it('区分具名客户端、可自动写入客户端和传输能力', () => {
    expect(isMcpClient('antigravity')).toBe(true)
    expect(isAgentClient('antigravity')).toBe(false)
    expect(isAgentClient('codex')).toBe(true)
    expect(isMcpClient('unknown')).toBe(false)
    expect(isMcpClient('gemini-cli')).toBe(false)
    expect(supportsMcpTransport('antigravity', 'http')).toBe(true)
    expect(supportsMcpTransport('antigravity', 'stdio')).toBe(false)
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
