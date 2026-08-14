import { Option, type Command } from 'commander'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import {
  acquireRuntimeLock,
  createAgentImportCommand,
  createHttpMcpConnection,
  importAgentClient,
  installAgentGlobalRules,
  createLociMcpServer,
  LOCI_CLI_STDIO_CONNECTION,
  readRuntimeLock,
  resolveAgentMcpConfigPath,
  startMcpHttpServer,
  type McpAgentConnection
} from '@loci/runtime'
import {
  GENERIC_MCP_CONFIG_TARGET,
  LOCI_AGENT_INSTRUCTIONS,
  createMcpClientConfig,
  getMcpClientDefinition,
  isAgentClient,
  isAgentGlobalRulesClient,
  isMcpClient,
  listImportableAgentClients,
  listMcpClients,
  supportsMcpTransport,
  type AgentClient,
  type McpClient,
  type McpConfigTarget,
  type McpTransport
} from '@loci/shared'
import { createCliRuntime } from '../runtime.js'
import { waitForTermination } from '../process-lifecycle.js'
import { runWithRuntime } from '../command-runtime.js'
import { CliError } from '../errors.js'
import { readMcpConfigurePreference, saveMcpConfigurePreference } from '../preferences.js'
import { askConfirm, askSelect, finishUi, info, note, startUi, success } from '../ui.js'
import { canConnect } from './status.js'
import { registerMcpCallCommand } from './mcp-call.js'
import { createMcpServices } from './mcp-services.js'

const agentClients: ReadonlyArray<{ value: AgentClient; label: string }> =
  listImportableAgentClients().map((client) => ({ value: client.id, label: client.label }))

type AgentSelection = AgentClient | 'manual'

const clients: ReadonlyArray<{ value: AgentSelection; label: string }> = [
  ...agentClients,
  { value: 'manual', label: '其他客户端（复制通用配置）' }
]

const globalRulesClients: ReadonlyArray<{ value: McpClient; label: string }> = listMcpClients().map(
  (client) => ({ value: client.id, label: client.label })
)

export function registerMcpCommands(program: Command): void {
  const mcp = program.command('mcp').description('调用工具并管理唯一的 Loci MCP 服务')

  registerMcpCallCommand(mcp)

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
    .command('config [client]')
    .description('输出指定客户端或通用 MCP 配置，不修改客户端文件')
    .addOption(
      new Option('--transport <transport>', '选择 MCP 传输方式').choices(['stdio', 'http'])
    )
    .action((client: string | undefined, options: { transport?: McpTransport }) => {
      const target = resolveMcpConfigTarget(client)
      const transport = options.transport ?? (target === 'antigravity' ? 'http' : 'stdio')
      return printManualMcpConfig(transport, target)
    })

  mcp
    .command('configure [client]')
    .description('优先用客户端命令写入 Loci MCP，失败时回退用户配置文件')
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
          options.transport ??
          (selected === 'antigravity'
            ? 'http'
            : process.stdin.isTTY
              ? remembered.transport
              : 'stdio')
        if (selected === 'manual') {
          await printManualMcpConfig(transport, GENERIC_MCP_CONFIG_TARGET.id)
          return
        }
        if (!isAgentClient(selected)) {
          throw new CliError(
            `不支持的 Agent 客户端：${selected}；请运行 loci mcp config 复制配置`,
            2
          )
        }
        if (!supportsMcpTransport(selected, transport)) {
          const definition = getMcpClientDefinition(selected)
          throw new CliError(`${definition.label} 不支持 ${transport} 传输`, 2)
        }
        await runWithRuntime('配置 Agent 客户端', async (runtime) => {
          const connection =
            transport === 'stdio'
              ? LOCI_CLI_STDIO_CONNECTION
              : createHttpMcpConnection(
                  `http://127.0.0.1:${runtime.database.getSettings().mcpPort}/mcp`
                )
          if (process.stdin.isTTY && !options.yes) {
            const definition = getMcpClientDefinition(selected)
            const path = resolveAgentMcpConfigPath(selected)
            const action = definition.quickImport
              ? (() => {
                  const command = createAgentImportCommand(selected, connection)
                  return [
                    `优先执行：${formatCommand(command.command, command.args)}`,
                    `命令失败后合并：${path}`
                  ]
                })()
              : [`直接合并：${path}`]
            note(
              [
                `客户端：${definition.label}`,
                `传输方式：${transport === 'stdio' ? 'CLI stdio' : '本地 HTTP'}`,
                ...action
              ].join('\n'),
              'MCP 配置写入预览'
            )
            if (!(await askConfirm('确认写入这个客户端的用户配置吗？', true))) {
              return '客户端配置未修改'
            }
          }
          const result = await importAgentClient(selected, connection, {
            dataDir: runtime.dataDir,
            owner: 'CLI Agent MCP 配置写入'
          })
          saveMcpConfigurePreference(runtime.database, { client: selected, transport })
          return result.message
        })
      }
    )

  mcp
    .command('rules [client]')
    .description('写入 Loci 全局规则；Cursor 输出可复制内容')
    .option('--yes', '跳过写入前确认')
    .action(async (client: string | undefined, options: { yes?: boolean }) => {
      const selected =
        client ??
        (process.stdin.isTTY
          ? await askSelect<McpClient>('请选择 Agent 客户端', globalRulesClients, 'codex')
          : undefined)
      if (!selected) throw new CliError('非交互终端必须指定 Agent 客户端', 2)
      if (!isMcpClient(selected)) throw new CliError(`不支持的 Agent 客户端：${selected}`, 2)

      const definition = getMcpClientDefinition(selected)
      if (!isAgentGlobalRulesClient(selected)) {
        process.stderr.write(`请将下面的规则复制到 ${definition.globalRulesPath}。\n`)
        process.stdout.write(`${LOCI_AGENT_INSTRUCTIONS}\n`)
        return
      }

      if (process.stdin.isTTY && !options.yes) {
        note(
          [
            `客户端：${definition.label}`,
            `目标：${definition.globalRulesPath}`,
            '仅替换 Loci 受管区块'
          ].join('\n'),
          '全局规则写入预览'
        )
        if (!(await askConfirm('确认写入这个客户端的用户级全局规则吗？', true))) return
      }
      await runWithRuntime(
        '配置 Agent 全局规则',
        async (runtime) =>
          installAgentGlobalRules(selected, {
            dataDir: runtime.dataDir,
            owner: 'CLI Agent 全局规则写入'
          }).message
      )
    })
}

function formatCommand(command: string, args: readonly string[]): string {
  return [command, ...args.map((argument) => JSON.stringify(argument))].join(' ')
}

function resolveMcpConfigTarget(value: string | undefined): McpConfigTarget {
  if (value === undefined || value === GENERIC_MCP_CONFIG_TARGET.id) {
    return GENERIC_MCP_CONFIG_TARGET.id
  }
  if (isMcpClient(value)) return value
  throw new CliError(`不支持的 MCP 配置目标：${value}`, 2)
}

async function printManualMcpConfig(
  transport: McpTransport,
  target: McpConfigTarget
): Promise<void> {
  if (target !== GENERIC_MCP_CONFIG_TARGET.id && !supportsMcpTransport(target, transport)) {
    const definition = getMcpClientDefinition(target)
    throw new CliError(`${definition.label} 不支持 ${transport} 传输`, 2)
  }
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
  const targetDefinition =
    target === GENERIC_MCP_CONFIG_TARGET.id
      ? GENERIC_MCP_CONFIG_TARGET
      : getMcpClientDefinition(target)
  process.stderr.write(
    `请将下面的 ${targetDefinition.label} 配置复制到 ${targetDefinition.configPath}。\n`
  )
  process.stdout.write(`${createMcpClientConfig(target, connection)}\n`)
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
