import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '@loci/shared'
import type { LociDatabase } from '@loci/runtime'
import { isLociMcpAvailable, startMcpHttpServer, type McpHttpServer } from '../http'
import { createMcpRuntime } from '../runtime'
import type { LociMcpServices } from '../server'

vi.mock('../http', () => ({
  startMcpHttpServer: vi.fn(),
  isLociMcpAvailable: vi.fn().mockResolvedValue(false)
}))

describe('MCP runtime', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not wait for the previous server to finish closing when saving a new port', async () => {
    let settings: AppSettings = {
      mcpPort: 3100,
      theme: 'auto',
      httpConcurrency: 9,
      browserConcurrency: 2,
      serverUrl: 'http://localhost:7001'
    }
    const previousClose = vi.fn(() => new Promise<void>(() => undefined))
    vi.mocked(startMcpHttpServer)
      .mockResolvedValueOnce(server(3100, previousClose))
      .mockResolvedValueOnce(server(3101))

    const database = {
      getSettings: () => settings,
      saveSettings: (next: AppSettings) => (settings = next)
    } as unknown as LociDatabase
    const runtime = createMcpRuntime(database, {} as unknown as LociMcpServices)

    await runtime.start()
    const result = await runtime.save({ ...settings, mcpPort: 3101 })

    expect(result.settings.mcpPort).toBe(3101)
    expect(previousClose).toHaveBeenCalledOnce()
  })

  it('recognizes an existing Loci MCP instead of reporting a port conflict', async () => {
    const settings: AppSettings = {
      mcpPort: 3100,
      theme: 'auto',
      httpConcurrency: 9,
      browserConcurrency: 2,
      serverUrl: 'http://localhost:7001'
    }
    vi.mocked(startMcpHttpServer).mockRejectedValueOnce(new Error('EADDRINUSE'))
    vi.mocked(isLociMcpAvailable).mockResolvedValueOnce(true)
    const database = {
      getSettings: () => settings,
      saveSettings: vi.fn()
    } as unknown as LociDatabase

    const runtime = createMcpRuntime(database, {} as unknown as LociMcpServices)
    await runtime.start()

    expect(runtime.getState().mcp).toMatchObject({ running: true, error: null })
    await expect(runtime.save({ ...settings, mcpPort: 3101 })).rejects.toThrow(
      '请先停止由 CLI 启动的 Loci MCP'
    )
  })
})

function server(port: number, close: () => Promise<void> = async () => undefined): McpHttpServer {
  return { port, endpoint: `http://127.0.0.1:${port}/mcp`, close }
}
