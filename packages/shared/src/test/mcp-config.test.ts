import { describe, expect, it } from 'vitest'
import { createCursorMcpConfig } from '../mcp-config.js'

describe('Cursor 风格 MCP 配置', () => {
  it('生成可复制的 stdio 配置', () => {
    expect(
      JSON.parse(createCursorMcpConfig({ type: 'stdio', command: 'loci', args: ['mcp', 'stdio'] }))
    ).toEqual({
      mcpServers: {
        loci: { command: 'loci', args: ['mcp', 'stdio'] }
      }
    })
  })

  it('生成可复制的 HTTP 配置', () => {
    expect(
      JSON.parse(createCursorMcpConfig({ type: 'http', endpoint: 'http://127.0.0.1:37373/mcp' }))
    ).toEqual({
      mcpServers: {
        loci: { url: 'http://127.0.0.1:37373/mcp' }
      }
    })
  })
})
