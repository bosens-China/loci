import type { AppSettings, AppSettingsState } from '../../shared/api'
import type { LociDatabase } from '../database'
import { isLociMcpAvailable, startMcpHttpServer, type McpHttpServer } from './http'
import type { LociMcpServices } from './server'

export interface McpRuntime {
  start: () => Promise<void>
  getState: () => AppSettingsState
  save: (settings: AppSettings) => Promise<AppSettingsState>
  close: () => Promise<void>
}

export function createMcpRuntime(database: LociDatabase, services: LociMcpServices): McpRuntime {
  let server: McpHttpServer | undefined
  let externalServer = false
  let error: string | null = null

  const getState = (): AppSettingsState => {
    const settings = database.getSettings()
    return {
      settings,
      mcp: {
        running: Boolean(server) || externalServer,
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
        externalServer = false
        error = null
      } catch (startError) {
        externalServer = await isLociMcpAvailable(port)
        error = externalServer ? null : `MCP 服务无法监听端口 ${port}：${errorMessage(startError)}`
        if (error) console.error(error)
      }
    },
    getState,
    save: async (settings) => {
      const previousSettings = database.getSettings()
      if (externalServer && settings.mcpPort !== previousSettings.mcpPort) {
        throw new Error('请先停止由 CLI 启动的 Loci MCP，再修改 MCP 端口')
      }
      const shouldRestart =
        (!server && !externalServer) || settings.mcpPort !== previousSettings.mcpPort
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
        externalServer = false
        error = null
        // 旧连接在后台排空，设置保存不等待正在执行的 MCP 请求。
        void previousServer
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
