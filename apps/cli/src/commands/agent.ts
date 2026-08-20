import { Option, type Command } from 'commander'
import {
  createAgentImportCommand,
  createHttpMcpConnection,
  importAgentClient,
  installAgentGlobalRules,
  LOCI_CLI_STDIO_CONNECTION,
  resolveAgentMcpConfigPath,
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
  isSkillAgent,
  listImportableAgentClients,
  listMcpClients,
  supportsMcpTransport,
  type AgentClient,
  type McpClient,
  type McpConfigTarget,
  type McpTransport
} from '@loci/shared'
import { runWithRuntime } from '../command-runtime.js'
import { CliError } from '../errors.js'
import { readMcpConfigurePreference, saveMcpConfigurePreference } from '../preferences.js'
import { createCliRuntime } from '../runtime.js'
import { askConfirm, askSelect, note } from '../ui.js'
import { installLociSkill, registerSkillsCommands } from './skills.js'

type AgentSelection = AgentClient | 'manual'

const clients: ReadonlyArray<{ value: AgentSelection; label: string }> = [
  ...listImportableAgentClients().map((client) => ({ value: client.id, label: client.label })),
  { value: 'manual', label: '其他客户端（复制通用配置）' }
]

const globalRulesClients: ReadonlyArray<{ value: McpClient; label: string }> = listMcpClients().map(
  (client) => ({ value: client.id, label: client.label })
)

/** 统一管理 Agent 客户端连接、全局规则和 Skills。 */
export function registerAgentCommands(program: Command): void {
  const agent = program
    .command('agent')
    .description('交互接入 Agent，或通过完整子命令管理连接、规则和 Skills')
    .action(runAgentOnboarding)

  registerConfigureCommand(agent)
  registerRulesCommand(agent)
  registerSkillsCommands(agent)
  registerConfigCommand(agent)
}

function registerConfigureCommand(agent: Command): void {
  agent
    .command('configure [client]')
    .description('将 Loci MCP 连接写入 Agent 客户端配置')
    .addOption(
      new Option('--transport <transport>', '选择 MCP 传输方式').choices(['stdio', 'http'])
    )
    .option('--yes', '跳过写入前确认')
    .action(configureAgentClient)
}

async function configureAgentClient(
  client: string | undefined,
  options: { transport?: McpTransport; yes?: boolean }
): Promise<void> {
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
      : undefined)
  if (!selected) throw new CliError('非交互终端必须指定 Agent 客户端', 2)
  const transport =
    options.transport ??
    (process.stdin.isTTY ? await askTransport(selected, remembered.transport) : undefined)
  if (!transport) throw new CliError('非交互终端必须指定 --transport', 2)
  if (selected === 'manual') {
    await printManualMcpConfig(transport, GENERIC_MCP_CONFIG_TARGET.id)
    return
  }
  if (!isAgentClient(selected)) {
    throw new CliError(`不支持的 Agent 客户端：${selected}；请运行 loci agent config 复制配置`, 2)
  }
  if (!supportsMcpTransport(selected, transport)) {
    const definition = getMcpClientDefinition(selected)
    throw new CliError(`${definition.label} 不支持 ${transport} 传输`, 2)
  }
  if (!process.stdin.isTTY && !options.yes) {
    throw new CliError('非交互写入 Agent 配置必须传入 --yes', 2)
  }
  await runWithRuntime('配置 Agent 客户端', async (runtime) => {
    const connection =
      transport === 'stdio'
        ? LOCI_CLI_STDIO_CONNECTION
        : createHttpMcpConnection(`http://127.0.0.1:${runtime.database.getSettings().mcpPort}/mcp`)
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

function registerRulesCommand(agent: Command): void {
  agent
    .command('rules [client]')
    .description('写入 Loci 全局规则；Cursor 输出可复制内容')
    .option('--yes', '跳过写入前确认')
    .action(configureAgentRules)
}

async function configureAgentRules(
  client: string | undefined,
  options: { yes?: boolean }
): Promise<void> {
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

  if (!process.stdin.isTTY && !options.yes) {
    throw new CliError('非交互写入 Agent 全局规则必须传入 --yes', 2)
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
}

function registerConfigCommand(agent: Command): void {
  agent
    .command('config [client]')
    .description('打印 Agent 客户端或通用 MCP 配置，不修改文件')
    .addOption(
      new Option('--transport <transport>', '选择 MCP 传输方式').choices(['stdio', 'http'])
    )
    .action(printAgentConfig)
}

async function printAgentConfig(
  client: string | undefined,
  options: { transport?: McpTransport }
): Promise<void> {
  const selected =
    client ??
    (process.stdin.isTTY
      ? await askSelect<AgentSelection>('请选择配置目标', clients, 'manual')
      : undefined)
  if (!selected) throw new CliError('非交互终端必须指定配置目标', 2)
  const target = resolveMcpConfigTarget(selected === 'manual' ? 'generic' : selected)
  const transport =
    options.transport ?? (process.stdin.isTTY ? await askTransport(selected, 'stdio') : undefined)
  if (!transport) throw new CliError('非交互终端必须指定 --transport', 2)
  await printManualMcpConfig(transport, target)
}

async function runAgentOnboarding(): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new CliError('非交互终端请使用完整的 loci agent 子命令和参数', 2)
  }
  const available = listImportableAgentClients().map((client) => ({
    value: client.id,
    label: client.label
  }))
  const selected = await askSelect<AgentClient>('请选择需要接入 Loci 的 Agent', available, 'codex')
  const transport = await askTransport(selected, selected === 'antigravity' ? 'http' : 'stdio')
  const scope = await askSelect<'project' | 'global'>(
    '请选择 use-loci Skill 作用域',
    [
      { value: 'project', label: '当前项目', hint: process.cwd() },
      { value: 'global', label: '所有项目', hint: '安装到用户级 Skills 目录' }
    ],
    'project'
  )
  const definition = getMcpClientDefinition(selected)
  note(
    [
      `Agent：${definition.label}`,
      `MCP：${transport === 'stdio' ? 'CLI stdio' : '本地 HTTP'}`,
      `Skill：${scope === 'project' ? process.cwd() : '用户级全局目录'}`,
      `全局规则：${definition.globalRulesPath}`
    ].join('\n'),
    '推荐接入预览'
  )
  if (!(await askConfirm('确认配置 MCP、安装 Skill 并写入全局规则吗？', true))) return

  await configureAgentClient(selected, { transport, yes: true })
  await installLociSkill({
    agent: isSkillAgent(selected) ? selected : 'universal',
    project: scope === 'project' ? process.cwd() : undefined,
    global: scope === 'global',
    yes: true
  })
  await configureAgentRules(selected, { yes: true })
}

async function askTransport(selected: string, initial: McpTransport): Promise<McpTransport> {
  const options = (['stdio', 'http'] as const)
    .filter(
      (transport) =>
        selected === 'manual' ||
        selected === GENERIC_MCP_CONFIG_TARGET.id ||
        (isMcpClient(selected) && supportsMcpTransport(selected, transport))
    )
    .map((transport) => ({
      value: transport,
      label: transport === 'stdio' ? 'CLI stdio' : '本地 HTTP'
    }))
  const initialValue = options.some((option) => option.value === initial)
    ? initial
    : options[0]!.value
  return askSelect('请选择 MCP 传输方式', options, initialValue)
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
