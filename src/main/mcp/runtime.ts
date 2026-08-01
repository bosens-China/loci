import type { AppSettings, AppSettingsState } from '../../shared/api'
import type { DocHubDatabase } from '../database'
import { startMcpHttpServer, type McpHttpServer } from './http'
import type { DocHubMcpServices } from './server'

export interface McpRuntime {
  start: () => Promise<void>
  getState: () => AppSettingsState
  save: (settings: AppSettings) => Promise<AppSettingsState>
  close: () => Promise<void>
}

export function createMcpRuntime(
  database: DocHubDatabase,
  services: DocHubMcpServices
): McpRuntime {
  let server: McpHttpServer | undefined
  let error: string | null = null

  const getState = (): AppSettingsState => {
    const settings = database.getSettings()
    return {
      settings,
      mcp: {
        running: Boolean(server),
        endpoint: `http://127.0.0.1:${settings.mcpPort}/mcp`,
        error
      }
    }
  }

  return {
    start: async () => {
      const port = database.getSettings().mcpPort
      try {
        server = await startMcpHttpServer(port, services)
        error = null
      } catch (startError) {
        error = `MCP 服务无法监听端口 ${port}：${errorMessage(startError)}`
        console.error(error)
      }
    },
    getState,
    save: async (settings) => {
      const previousSettings = database.getSettings()
      const shouldRestart = !server || settings.mcpPort !== previousSettings.mcpPort
      let candidate: McpHttpServer | undefined
      if (shouldRestart) {
        try {
          candidate = await startMcpHttpServer(settings.mcpPort, services)
        } catch (startError) {
          throw new Error(`端口 ${settings.mcpPort} 无法使用：${errorMessage(startError)}`)
        }
      }
      try {
        database.saveSettings(settings)
      } catch (saveError) {
        await candidate?.close()
        throw saveError
      }
      if (candidate) {
        const previousServer = server
        server = candidate
        error = null
        await previousServer
          ?.close()
          .catch((closeError) => console.error('旧 MCP 服务关闭失败', closeError))
      }
      return getState()
    },
    close: async () => server?.close()
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}
