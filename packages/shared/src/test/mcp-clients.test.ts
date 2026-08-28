import { describe, expect, it } from 'vitest'
import { getMcpClientDefinition, isAgentGlobalRulesClient, isMcpClient } from '../mcp-clients.js'

describe('MCP 客户端共享目录', () => {
  it('区分受支持客户端与可写全局规则的客户端', () => {
    expect(isMcpClient('codex')).toBe(true)
    expect(isMcpClient('unknown')).toBe(false)
    expect(getMcpClientDefinition('codex')).toMatchObject({
      id: 'codex',
      globalRulesWrite: true,
      importStrategy: 'codex-cli'
    })
    expect(getMcpClientDefinition('cursor')).toMatchObject({
      globalRulesPath: '~/.cursor/rules/loci.mdc',
      globalRulesWrite: true
    })
    expect(isAgentGlobalRulesClient('cursor')).toBe(true)
    expect(isAgentGlobalRulesClient('codex')).toBe(true)
  })
})
