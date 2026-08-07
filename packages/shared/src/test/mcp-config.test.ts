import { describe, expect, it } from 'vitest'
import { createCursorMcpConfig, createMcpClientConfig } from '../mcp-config.js'

const httpConnection = { type: 'http', endpoint: 'http://127.0.0.1:37373/mcp' } as const
const stdioConnection = { type: 'stdio', command: 'loci', args: ['mcp', 'stdio'] } as const

describe('Cursor 风格 MCP 配置', () => {
  it('生成可复制的 stdio 配置', () => {
    expect(JSON.parse(createCursorMcpConfig(stdioConnection))).toEqual({
      mcpServers: {
        loci: { command: 'loci', args: ['mcp', 'stdio'] }
      }
    })
  })

  it('生成可复制的 HTTP 配置', () => {
    expect(JSON.parse(createCursorMcpConfig(httpConnection))).toEqual({
      mcpServers: {
        loci: { url: 'http://127.0.0.1:37373/mcp' }
      }
    })
  })
})

describe('具名 MCP 客户端配置', () => {
  it('生成 Codex TOML 的 HTTP 与 stdio 配置', () => {
    expect(createMcpClientConfig('codex', httpConnection)).toBe(
      '[mcp_servers.loci]\nurl = "http://127.0.0.1:37373/mcp"'
    )
    expect(createMcpClientConfig('codex', stdioConnection)).toBe(
      '[mcp_servers.loci]\ncommand = "loci"\nargs = ["mcp", "stdio"]'
    )
  })

  it('按 VS Code 与 Claude Code 的字段生成配置', () => {
    expect(JSON.parse(createMcpClientConfig('vscode', httpConnection))).toEqual({
      servers: { loci: { type: 'http', url: httpConnection.endpoint } }
    })
    expect(JSON.parse(createMcpClientConfig('claude-code', stdioConnection))).toEqual({
      mcpServers: {
        loci: { type: 'stdio', command: 'loci', args: ['mcp', 'stdio'] }
      }
    })
  })

  it('生成 Google Antigravity HTTP 配置并拒绝 stdio', () => {
    expect(JSON.parse(createMcpClientConfig('antigravity', httpConnection))).toEqual({
      mcpServers: { loci: { serverUrl: httpConnection.endpoint } }
    })
    expect(() => createMcpClientConfig('antigravity', stdioConnection)).toThrow(
      'Google Antigravity 不支持 stdio 传输'
    )
  })

  it('保留 generic 的 Cursor 风格兼容输出', () => {
    expect(createMcpClientConfig('generic', stdioConnection)).toBe(
      createCursorMcpConfig(stdioConnection)
    )
  })
})
