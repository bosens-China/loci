import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '../../shared/api'
import type { LociDatabase } from '../database'
import { startMcpHttpServer, type McpHttpServer } from './http'
import { createMcpRuntime } from './runtime'
import type { LociMcpServices } from './server'

vi.mock('./http', () => ({ startMcpHttpServer: vi.fn() }))

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
})

function server(port: number, close: () => Promise<void> = async () => undefined): McpHttpServer {
  return { port, endpoint: `http://127.0.0.1:${port}/mcp`, close }
}
