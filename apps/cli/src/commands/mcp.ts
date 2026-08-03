import { Option, type Command } from 'commander'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { startMcpHttpServer } from '../../../desktop/src/main/mcp/http.js'
import { createLociMcpServer, type LociMcpServices } from '../../../desktop/src/main/mcp/server.js'
import type { AgentClient } from '@loci/shared'
import {
  createHttpMcpConnection,
  importAgentClient,
  LOCI_CLI_STDIO_CONNECTION
} from '../../../desktop/src/main/agent-import.js'
import { acquireRuntimeLock, readRuntimeLock } from '../../../desktop/src/main/runtime-lock.js'
import { createCliRuntime } from '../runtime.js'
import { runWithRuntime } from '../command-runtime.js'
import { askSelect, finishUi, info, startUi, success } from '../ui.js'
import { canConnect } from './status.js'

const clients: ReadonlyArray<{ value: AgentClient; label: string }> = [
  { value: 'codex', label: 'Codex' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'vscode', label: 'VS Code' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'gemini-cli', label: 'Gemini CLI' }
]

type McpTransport = 'stdio' | 'http'

export function registerMcpCommands(program: Command): void {
  const mcp = program.command('mcp').description('管理唯一的 Loci MCP 服务')

  mcp
    .command('stdio')
    .description('通过 Loci MCP stdio 为 Agent 提供本地能力')
    .action(async () => {
      const runtime = createCliRuntime()
      const handle = serveStdio(() => createLociMcpServer(createMcpServices(runtime)), {
        onerror: (error) => console.error(`Loci MCP stdio 错误：${error.message}`)
      })
      try {
        await waitForStdioTermination()
      } finally {
        await handle.close()
        await runtime.close()
      }
    })

  mcp
    .command('serve')
    .description('以前台方式启动 Loci MCP，适用于无桌面环境')
    .action(async () => {
      startUi('Loci MCP')
      const runtime = createCliRuntime()
      const settings = runtime.database.getSettings()
      let lock: ReturnType<typeof acquireRuntimeLock> | undefined
      try {
        if (await canConnect(settings.mcpPort)) {
          info(`现有实例：http://127.0.0.1:${settings.mcpPort}/mcp`)
          finishUi('已有 Loci MCP 正在运行，本次未重复启动')
          return
        }
        lock = acquireRuntimeLock(runtime.dataDir, 'mcp', 'CLI')
        const server = await startMcpHttpServer(settings.mcpPort, createMcpServices(runtime))
        success(`MCP 已启动：${server.endpoint}`)
        info('按 Ctrl+C 停止服务')
        await waitForTermination()
        await server.close()
        finishUi('MCP 已停止')
      } finally {
        lock?.release()
        await runtime.close()
      }
    })

  mcp
    .command('status')
    .description('检查 MCP 地址、端口和当前宿主')
    .action(() =>
      runWithRuntime('MCP 状态', async (runtime) => {
        const settings = runtime.database.getSettings()
        const running = await canConnect(settings.mcpPort)
        const lock = readRuntimeLock(runtime.dataDir, 'mcp')
        process.stdout.write('默认 Agent 入口： CLI stdio（loci mcp stdio）\n')
        process.stdout.write(`地址： http://127.0.0.1:${settings.mcpPort}/mcp\n`)
        process.stdout.write(`HTTP 状态： ${running ? '运行中' : '未运行'}\n`)
        process.stdout.write(
          `宿主： ${lock?.owner ?? (running ? '桌面端或其他 Loci 进程' : '—')}\n`
        )
        return running ? 'MCP 服务可访问' : 'MCP 当前未运行'
      })
    )

  mcp
    .command('configure [client]')
    .description('把唯一的 Loci MCP 写入 Agent 客户端配置，默认使用 CLI stdio')
    .addOption(
      new Option('--transport <transport>', '选择 MCP 传输方式')
        .choices(['stdio', 'http'])
        .default('stdio')
    )
    .action((client: AgentClient | undefined, options: { transport: McpTransport }) =>
      runWithRuntime('配置 Agent 客户端', async (runtime) => {
        const selected = client ?? (await askSelect<AgentClient>('请选择 Agent 客户端', clients))
        if (!clients.some((item) => item.value === selected)) {
          throw new Error(`不支持的 Agent 客户端：${selected}`)
        }
        const connection =
          options.transport === 'stdio'
            ? LOCI_CLI_STDIO_CONNECTION
            : createHttpMcpConnection(
                `http://127.0.0.1:${runtime.database.getSettings().mcpPort}/mcp`
              )
        const result = await importAgentClient(selected, connection)
        return result.message
      })
    )
}

function createMcpServices(runtime: ReturnType<typeof createCliRuntime>): LociMcpServices {
  return {
    listSources: () => runtime.database.listSources(),
    listDocuments: () => runtime.database.listDocuments(),
    searchDocuments: (query) => runtime.database.searchDocuments(query),
    createSource: runtime.createSource,
    crawlSource: runtime.crawlSource,
    deleteSource: runtime.deleteSource,
    isCrawling: runtime.isCrawling,
    getCrawlState: runtime.getCrawlState,
    listCloudLibraries: () => runtime.cloud.listCatalog(runtime.database.getSettings().serverUrl),
    pullCloudLibrary: (libraryId) => {
      runtime.assertWritable()
      return runtime.cloud.importLibrary(runtime.database.getSettings().serverUrl, libraryId, false)
    }
  }
}

function waitForTermination(): Promise<void> {
  return new Promise((resolve) => {
    const stop = (): void => resolve()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}

function waitForStdioTermination(): Promise<void> {
  return new Promise((resolve) => {
    const stop = (): void => {
      process.stdin.off('end', stop)
      process.stdin.off('close', stop)
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      resolve()
    }
    process.stdin.once('end', stop)
    process.stdin.once('close', stop)
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}
