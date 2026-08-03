import { describe, expect, it } from 'vitest'
import { createAgentImportCommand } from './agent-import'

describe('Agent MCP 导入命令', () => {
  it('只为受支持的客户端生成本机 HTTP 配置', () => {
    const endpoint = 'http://127.0.0.1:37373/mcp'

    expect(createAgentImportCommand('codex', endpoint)).toMatchObject({
      command: 'codex',
      args: ['mcp', 'add', 'loci', '--url', endpoint]
    })
    expect(createAgentImportCommand('vscode', endpoint).args[1]).toBe(
      JSON.stringify({ name: 'loci', type: 'http', url: endpoint })
    )
    expect(createAgentImportCommand('cursor', endpoint).command).toBe('cursor')
    expect(createAgentImportCommand('claude-code', endpoint).args).toContain('--scope')
    expect(createAgentImportCommand('gemini-cli', endpoint).args).toContain('--transport')
    expect(() => createAgentImportCommand('unknown', endpoint)).toThrow('不支持')
    expect(() => createAgentImportCommand('codex', 'https://example.com/mcp')).toThrow('本机地址')
  })
})
