import type { Command } from 'commander'
import type { AgentIntegrationStatus, AgentClient } from '@loci/shared'
import { isAgentClient, listImportableAgentClients } from '@loci/shared'
import type { AgentIntegrationService } from '@loci/runtime'
import { runWithRuntime } from '../command-runtime.js'
import { CliError } from '../errors.js'
import type { CliRuntime } from '../runtime.js'
import { askConfirm, askSelect, note, printTable } from '../ui.js'

interface WriteOptions {
  yes?: boolean
}

interface StatusOptions {
  json?: boolean
}

const choices = listImportableAgentClients().map((client) => ({
  value: client.id,
  label: client.label
}))

export function registerAgentIntegrationCommands(agent: Command): void {
  agent
    .command('setup [client]')
    .description('一键配置全局 MCP、Skill 和 Rules')
    .option('--yes', '跳过写入前确认')
    .action(runAgentSetup)

  agent
    .command('status [client]')
    .description('检查 Agent 全局接入状态')
    .option('--json', '输出 JSON')
    .action(runAgentStatus)

  agent
    .command('remove [client]')
    .description('安全移除全局 MCP、Skill 和 Rules')
    .option('--yes', '跳过移除前确认')
    .action(runAgentRemove)
}

export async function runAgentSetupWizard(): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new CliError('非交互终端请使用完整的 loci agent 子命令和参数', 2)
  }
  await runAgentSetup(undefined, {})
}

async function runAgentSetup(client: string | undefined, options: WriteOptions): Promise<void> {
  const selected = await selectClient(client)
  requireWriteConfirmation(options)
  await runWithRuntime('Agent 全局接入', async (runtime) => {
    const service = requireService(runtime)
    if (!options.yes) {
      note(formatPreview(service.inspect(selected)), '全局接入预览')
      if (!(await askConfirm('确认配置全局 MCP、Skill 和 Rules 吗？', true))) {
        return 'Agent 配置未修改'
      }
    }
    const result = await service.setup(selected)
    return formatResult(result.status, result.changed ? '全局接入已完成' : '全局接入无需更新')
  })
}

async function runAgentRemove(client: string | undefined, options: WriteOptions): Promise<void> {
  const selected = await selectClient(client)
  requireWriteConfirmation(options)
  await runWithRuntime('移除 Agent 全局接入', async (runtime) => {
    const service = requireService(runtime)
    if (!options.yes) {
      note(formatPreview(service.inspect(selected)), '全局移除预览')
      if (!(await askConfirm('确认移除 Loci 管理的全局配置吗？'))) {
        return 'Agent 配置未修改'
      }
    }
    const result = await service.remove(selected)
    return formatResult(result.status, result.changed ? '全局接入已移除' : '没有可移除的自动配置')
  })
}

async function runAgentStatus(client: string | undefined, options: StatusOptions): Promise<void> {
  if (client !== undefined && !isAgentClient(client)) {
    throw new CliError(`不支持的 Agent 客户端：${client}`, 2)
  }
  await runWithRuntime('Agent 接入状态', async (runtime) => {
    const service = requireService(runtime)
    const statuses = client ? [service.inspect(client)] : service.list()
    if (options.json) {
      process.stdout.write(`${JSON.stringify(client ? statuses[0] : statuses, null, 2)}\n`)
    } else {
      printTable(
        ['Agent', '整体', 'MCP', 'Skill', 'Rules'],
        statuses.map((status) => [
          status.label,
          overallLabel(status.overall),
          componentLabel(status, 'mcp'),
          componentLabel(status, 'skill'),
          componentLabel(status, 'rules')
        ])
      )
    }
    return `已检查 ${statuses.length} 个 Agent`
  })
}

async function selectClient(client: string | undefined): Promise<AgentClient> {
  const selected =
    client ??
    (process.stdin.isTTY
      ? await askSelect<AgentClient>('请选择需要管理的 Agent', choices, 'codex')
      : undefined)
  if (!selected) throw new CliError('非交互终端必须指定 Agent 客户端', 2)
  if (!isAgentClient(selected)) throw new CliError(`不支持的 Agent 客户端：${selected}`, 2)
  return selected
}

function requireWriteConfirmation(options: WriteOptions): void {
  if (!process.stdin.isTTY && !options.yes) {
    throw new CliError('非交互写操作必须传入 --yes', 2)
  }
}

function requireService(runtime: CliRuntime): AgentIntegrationService {
  if (!runtime.agentIntegration) throw new Error('当前 Runtime 未启用 Agent 接入管理')
  return runtime.agentIntegration
}

function formatPreview(status: AgentIntegrationStatus): string {
  return [
    `Agent：${status.label}`,
    ...status.components.map(
      (component) =>
        `${componentName(component.component)}：${statusLabel(component.status)} · ${component.path}`
    )
  ].join('\n')
}

function formatResult(
  status: AgentIntegrationStatus,
  title: string
): string | { message: string; tone: 'warning' } {
  const details = status.components
    .map(
      (component) =>
        `${componentName(component.component)}：${statusLabel(component.status)}${component.message ? `（${component.message}）` : ''}`
    )
    .join('\n')
  const message = `${title}\n${details}`
  return status.overall === 'attention' || status.overall === 'partial'
    ? { message, tone: 'warning' }
    : message
}

function componentLabel(
  status: AgentIntegrationStatus,
  component: 'mcp' | 'skill' | 'rules'
): string {
  const found = status.components.find((item) => item.component === component)
  return found ? statusLabel(found.status) : '未知'
}

function componentName(component: 'mcp' | 'skill' | 'rules'): string {
  return { mcp: 'MCP', skill: 'Skill', rules: 'Rules' }[component]
}

function statusLabel(status: AgentIntegrationStatus['components'][number]['status']): string {
  return {
    missing: '未配置',
    current: '已就绪',
    outdated: '待更新',
    conflict: '有冲突',
    manual: '需手动'
  }[status]
}

function overallLabel(status: AgentIntegrationStatus['overall']): string {
  return {
    ready: '已接入',
    partial: '部分完成',
    missing: '未接入',
    attention: '需处理'
  }[status]
}
