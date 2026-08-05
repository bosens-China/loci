import { describe, expect, it } from 'vitest'
import {
  createAgentImportCommand,
  createHttpMcpConnection,
  LOCI_CLI_STDIO_CONNECTION,
  resolvePreferredMcpConnection
} from '../agent-import.js'

describe('Agent MCP 导入命令', () => {
  it('为五种客户端生成本机 HTTP 配置', () => {
    const endpoint = 'http://127.0.0.1:37373/mcp'
    const connection = createHttpMcpConnection(endpoint)

    expect(createAgentImportCommand('codex', connection)).toMatchObject({
      command: 'codex',
      args: ['mcp', 'add', 'loci', '--url', endpoint]
    })
    expect(createAgentImportCommand('vscode', connection).args[1]).toBe(
      JSON.stringify({ name: 'loci', type: 'http', url: endpoint })
    )
    expect(createAgentImportCommand('cursor', connection).command).toBe('cursor')
    expect(createAgentImportCommand('claude-code', connection).args).toContain('--scope')
    expect(createAgentImportCommand('gemini-cli', connection).args).toContain('--transport')
    expect(() => createAgentImportCommand('unknown', connection)).toThrow('不支持')
    expect(() =>
      createAgentImportCommand('codex', createHttpMcpConnection('https://example.com/mcp'))
    ).toThrow('本机地址')
  })

  it('为五种客户端生成同名 loci 的 CLI stdio 配置', () => {
    expect(createAgentImportCommand('codex', LOCI_CLI_STDIO_CONNECTION).args).toEqual([
      'mcp',
      'add',
      'loci',
      '--',
      'loci',
      'mcp',
      'stdio'
    ])
    expect(createAgentImportCommand('cursor', LOCI_CLI_STDIO_CONNECTION).args[1]).toBe(
      JSON.stringify({
        name: 'loci',
        type: 'stdio',
        command: 'loci',
        args: ['mcp', 'stdio']
      })
    )
    expect(createAgentImportCommand('vscode', LOCI_CLI_STDIO_CONNECTION).args[1]).toContain(
      '"type":"stdio"'
    )
    expect(createAgentImportCommand('claude-code', LOCI_CLI_STDIO_CONNECTION).args).toEqual([
      'mcp',
      'add',
      '--transport',
      'stdio',
      '--scope',
      'user',
      'loci',
      '--',
      'loci',
      'mcp',
      'stdio'
    ])
    expect(createAgentImportCommand('gemini-cli', LOCI_CLI_STDIO_CONNECTION).args).toEqual([
      'mcp',
      'add',
      '--transport',
      'stdio',
      '--scope',
      'user',
      'loci',
      'loci',
      'mcp',
      'stdio'
    ])
  })

  it('桌面端检测到 CLI 时优先 stdio，否则使用桌面 HTTP', async () => {
    const endpoint = 'http://127.0.0.1:37373/mcp'

    await expect(
      resolvePreferredMcpConnection(endpoint, async () => '/usr/local/bin/loci')
    ).resolves.toEqual({
      type: 'stdio',
      command: '/usr/local/bin/loci',
      args: ['mcp', 'stdio']
    })
    await expect(resolvePreferredMcpConnection(endpoint, async () => null)).resolves.toEqual({
      type: 'http',
      endpoint
    })
  })
})
