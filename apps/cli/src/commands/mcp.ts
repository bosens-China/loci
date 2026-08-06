import { Option, type Command } from 'commander'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import {
  acquireRuntimeLock,
  createAgentImportCommand,
  createHttpMcpConnection,
  importAgentClient,
  createLociMcpServer,
  LOCI_CLI_STDIO_CONNECTION,
  readRuntimeLock,
  startMcpHttpServer,
  type LociMcpServices,
  type McpAgentConnection
} from '@loci/runtime'
import { createCursorMcpConfig, type AgentClient } from '@loci/shared'
import { createCliRuntime } from '../runtime.js'
import { waitForTermination } from '../process-lifecycle.js'
import { runWithRuntime } from '../command-runtime.js'
import { CliError } from '../errors.js'
import { readMcpConfigurePreference, saveMcpConfigurePreference } from '../preferences.js'
import { askConfirm, askSelect, finishUi, info, note, startUi, success } from '../ui.js'
import { canConnect } from './status.js'

const agentClients = [
  { value: 'codex', label: 'Codex' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'vscode', label: 'VS Code' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'gemini-cli', label: 'Gemini CLI' }
] as const satisfies ReadonlyArray<{ value: AgentClient; label: string }>

type AgentSelection = AgentClient | 'manual'

const clients: ReadonlyArray<{ value: AgentSelection; label: string }> = [
  ...agentClients,
  { value: 'manual', label: '其他客户端（复制通用配置）' }
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
    .command('config')
    .description('输出兼容 Cursor 的通用 MCP 配置，不修改客户端文件')
    .addOption(
      new Option('--transport <transport>', '选择 MCP 传输方式')
        .choices(['stdio', 'http'])
        .default('stdio')
    )
    .action((options: { transport: McpTransport }) => printManualMcpConfig(options.transport))

  mcp
    .command('configure [client]')
    .description('把唯一的 Loci MCP 写入 Agent 客户端配置，默认使用 CLI stdio')
    .addOption(
      new Option('--transport <transport>', '选择 MCP 传输方式').choices(['stdio', 'http'])
    )
    .option('--yes', '跳过写入前确认')
    .action(
      async (client: string | undefined, options: { transport?: McpTransport; yes?: boolean }) => {
        let remembered = { client: 'codex' as AgentClient, transport: 'stdio' as McpTransport }
        if (process.stdin.isTTY && (!client || !options.transport)) {
          const preferenceRuntime = createCliRuntime()
          try {
            remembered = readMcpConfigurePreference(preferenceRuntime.database)
          } finally {
            await preferenceRuntime.close()
          }
        }
        const selected =
          client ??
          (process.stdin.isTTY
            ? await askSelect<AgentSelection>('请选择 Agent 客户端', clients, remembered.client)
            : 'manual')
        const transport =
          options.transport ?? (process.stdin.isTTY ? remembered.transport : 'stdio')
        if (selected === 'manual') {
          await printManualMcpConfig(transport)
          return
        }
        if (!isAgentClient(selected)) {
          throw new CliError(
            `不支持的 Agent 客户端：${selected}；请运行 loci mcp config 复制配置`,
            2
          )
        }
        await runWithRuntime('配置 Agent 客户端', async (runtime) => {
          const connection =
            transport === 'stdio'
              ? LOCI_CLI_STDIO_CONNECTION
              : createHttpMcpConnection(
                  `http://127.0.0.1:${runtime.database.getSettings().mcpPort}/mcp`
                )
          if (process.stdin.isTTY && !options.yes) {
            const command = createAgentImportCommand(selected, connection)
            note(
              [
                `客户端：${command.label}`,
                `传输方式：${transport === 'stdio' ? 'CLI stdio' : '本地 HTTP'}`,
                `将执行：${formatCommand(command.command, command.args)}`
              ].join('\n'),
              'MCP 配置写入预览'
            )
            if (!(await askConfirm('确认写入这个客户端的用户配置吗？', true))) {
              return '客户端配置未修改'
            }
          }
          const result = await importAgentClient(selected, connection)
          saveMcpConfigurePreference(runtime.database, { client: selected, transport })
          return result.message
        })
      }
    )
}

function formatCommand(command: string, args: readonly string[]): string {
  return [command, ...args.map((argument) => JSON.stringify(argument))].join(' ')
}

function isAgentClient(value: string): value is AgentClient {
  return agentClients.some((client) => client.value === value)
}

async function printManualMcpConfig(transport: McpTransport): Promise<void> {
  let connection: McpAgentConnection = LOCI_CLI_STDIO_CONNECTION
  if (transport === 'http') {
    const runtime = createCliRuntime()
    try {
      connection = createHttpMcpConnection(
        `http://127.0.0.1:${runtime.database.getSettings().mcpPort}/mcp`
      )
    } finally {
      await runtime.close()
    }
  }
  process.stderr.write('请将下面的 Cursor 风格配置复制到客户端的 MCP 配置文件中。\n')
  process.stdout.write(`${createCursorMcpConfig(connection)}\n`)
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
