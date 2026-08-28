import type { Command } from 'commander'
import { DOCUMENT_SOURCE_DEFAULTS } from '@loci/core'
import {
  deriveSourceName,
  type CloudLibrary,
  type CloudLibraryInput,
  type CloudSyncJob
} from '@loci/shared'
import type { CloudAdminClient, LocalRuntime } from '@loci/runtime'
import { runWithRuntime } from '../command-runtime.js'
import { CliError } from '../errors.js'
import { parseScheduleInput } from '../schedule-input.js'
import { resolveSource } from '../resources.js'
import { confirmAction, printTable } from '../ui.js'
import { createAdminJobTable, createAdminLibraryTable } from './admin-output.js'
import { resolveAdminJob } from './admin-tasks.js'
import {
  formatDomainInterval,
  parseDomainConcurrency,
  parseDomainInterval
} from './domain-policy-options.js'
import { registerAdminCrawlSettings } from './admin-crawl-settings.js'

interface LibraryOptions {
  name?: string
  url?: string
  scope?: string
  pageLimit?: number
  schedule?: string
}

interface SyncOptions {
  all?: boolean
  wait?: boolean
}

interface ConfirmOptions {
  yes?: boolean
}

type WaitForSync = (client: CloudAdminClient, libraries: CloudLibrary[]) => Promise<void>

/** 注册可用于脚本和 CI 的管理员子命令，凭据只从环境变量读取。 */
export function registerAdminSubcommands(admin: Command, waitForSync: WaitForSync): void {
  admin
    .command('libraries')
    .description('列出 Server 文档库')
    .action(() =>
      withAdmin('Server 文档库', async (client) => printLibraries(await client.listLibraries()))
    )

  admin
    .command('create')
    .description('创建 Server 文档库')
    .requiredOption('--url <url>', '第一个公开文档页面 URL')
    .option('--name <name>', '文档源名称')
    .option('--scope <path>', '收录范围', DOCUMENT_SOURCE_DEFAULTS.scopePath)
    .option('--page-limit <number>', '页面上限', integerValue, DOCUMENT_SOURCE_DEFAULTS.pageLimit)
    .option('--schedule <cron>', '5 段 Cron 更新计划')
    .action((options: LibraryOptions) =>
      withAdmin('创建 Server 文档库', async (client) => {
        const input = createInput(options)
        const library = await client.createLibrary(input)
        return `已创建“${library.name}”（${library.scopePath}）`
      })
    )

  admin
    .command('update <library>')
    .description('修改 Server 文档库的显式字段')
    .option('--url <url>', '第一个公开文档页面 URL')
    .option('--name <name>', '文档源名称')
    .option('--scope <path>', '收录范围')
    .option('--page-limit <number>', '页面上限', integerValue)
    .option('--schedule <cron>', '5 段 Cron；传 off 关闭计划')
    .action((reference: string, options: LibraryOptions) =>
      withAdmin('修改 Server 文档库', async (client) => {
        const current = await resolveLibrary(client, reference)
        const input: CloudLibraryInput = {
          name: options.name ?? current.name,
          url: options.url ?? current.url,
          scopePath: options.scope ?? current.scopePath,
          pageLimit: options.pageLimit ?? current.pageLimit,
          schedule: scheduleValue(options.schedule, current.schedule)
        }
        const library = await client.updateLibrary(current.id, input)
        return `已更新“${library.name}”`
      })
    )

  admin
    .command('delete <library>')
    .description('删除 Server 文档库及其公开快照')
    .option('--yes', '跳过确认')
    .action((reference: string, options: { yes?: boolean }) =>
      withAdmin('删除 Server 文档库', async (client) => {
        const library = await resolveLibrary(client, reference)
        if (
          !(await confirmAction(
            `确定删除“${library.name}”吗？`,
            options.yes,
            '非交互终端删除文档库必须提供 --yes'
          ))
        )
          return '已取消删除'
        await client.deleteLibrary(library.id)
        return `已删除“${library.name}”`
      })
    )

  admin
    .command('sync [libraries...]')
    .description('批量同步 Server 文档库')
    .option('--all', '同步全部文档库')
    .option('--wait', '等待全部任务完成')
    .action((references: string[], options: SyncOptions) =>
      withAdmin('同步 Server 文档库', async (client) => {
        const libraries = await selectLibraries(client, references, options.all === true)
        if (options.wait) {
          await waitForSync(client, libraries)
          return `已完成 ${libraries.length} 个文档库同步`
        }
        await client.syncLibraries(libraries.map((library) => library.id))
        return `已提交 ${libraries.length} 个同步任务`
      })
    )

  admin
    .command('jobs')
    .description('查看活动和最近的 Server 同步任务')
    .action(() =>
      withAdmin('Server 同步任务', async (client) => printJobs(await client.listSyncJobs()))
    )

  registerAdminJobControls(admin)
  registerAdminCrawlSettings(admin, withAdmin)
  registerAdminDomainPolicies(admin)

  admin
    .command('publish <source>')
    .description('用压缩二进制归档把本地文档库发布到 Server')
    .option('--target <library>', '显式覆盖目标 Server 文档库；省略时创建新库')
    .option('--yes', '跳过确认')
    .action((sourceReference: string, options: { target?: string; yes?: boolean }) =>
      withAdmin('发布本地文档库', async (client, runtime) => {
        const source = await resolveSource(runtime, sourceReference)
        if (source.cloud) throw new CliError('只能发布本地文档库', 2)
        const target = options.target ? await resolveLibrary(client, options.target) : undefined
        await requireConfirmation(
          target
            ? `确定用“${source.name}”覆盖 Server 文档库“${target.name}”吗？`
            : `确定把“${source.name}”发布为新的公开 Server 文档库吗？`,
          options
        )
        const archive = await runtime.database.exportLibraryPublishArchive(
          source.id,
          target ? 'replace' : 'create',
          target?.id
        )
        const result = await client.publishLibrary(archive)
        return `${result.reused ? '已复用' : '已完成'}发布：${result.library.name}（${result.pages} 篇）`
      })
    )
}

function registerAdminDomainPolicies(admin: Command): void {
  admin
    .command('domain-list')
    .description('列出 Server hostname 抓取限制')
    .action(() =>
      withAdmin('Server 域名抓取限制', async (client) => {
        const rows = await client.listHostnamePolicies()
        printTable(
          ['hostname', 'HTTP', '浏览器', '批次间隔'],
          rows.map((item) => [
            item.hostname,
            item.httpConcurrency ?? '默认',
            item.browserConcurrency ?? '默认',
            formatDomainInterval(item.batchIntervalMinSeconds, item.batchIntervalMaxSeconds)
          ])
        )
        return `共 ${rows.length} 条 Server 域名规则`
      })
    )

  admin
    .command('domain-set <hostname>')
    .description('实时新增或修改 Server hostname 抓取限制')
    .option('--http <number>', 'HTTP 并发；default 表示默认')
    .option('--browser <number>', '浏览器并发；default 表示默认')
    .option('--interval <seconds>', '固定值、min-max 或 default')
    .action((hostname: string, options: { http?: string; browser?: string; interval?: string }) =>
      withAdmin('保存 Server 域名抓取限制', async (client) => {
        const current = (await client.listHostnamePolicies()).find(
          (item) => item.hostname === hostname.toLowerCase()
        )
        const interval = parseDomainInterval(options.interval, current)
        const saved = await client.saveHostnamePolicy({
          hostname,
          httpConcurrency: parseDomainConcurrency(options.http, current?.httpConcurrency ?? null),
          browserConcurrency: parseDomainConcurrency(
            options.browser,
            current?.browserConcurrency ?? null
          ),
          batchIntervalMinSeconds: interval[0],
          batchIntervalMaxSeconds: interval[1]
        })
        return `已保存 ${saved.hostname} 的 Server 抓取限制`
      })
    )

  admin
    .command('domain-delete <hostname>')
    .description('删除 Server hostname 自定义限制')
    .option('--yes', '跳过确认')
    .action((hostname: string, options: ConfirmOptions) =>
      withAdmin('删除 Server 域名抓取限制', async (client) => {
        await requireConfirmation(`确定删除 ${hostname} 的 Server 域名规则吗？`, options)
        await client.deleteHostnamePolicy(hostname)
        return `已删除 ${hostname} 的 Server 域名规则`
      })
    )
}

function registerAdminJobControls(admin: Command): void {
  for (const action of ['pause', 'resume', 'stop', 'cancel'] as const) {
    admin
      .command(`${action} <job>`)
      .description(`${adminActionLabel[action]} Server 同步任务`)
      .option('--yes', '跳过确认')
      .action((reference: string, options: ConfirmOptions) =>
        withAdmin(`${adminActionLabel[action]} Server 同步任务`, async (client) => {
          const job = resolveAdminJob(await client.listSyncJobs(), reference)
          await requireConfirmation(
            `确定${adminActionLabel[action]}任务 ${job.id.slice(0, 8)} 吗？`,
            options
          )
          const controlled = await client.controlSyncJob(job.id, action)
          return `任务 ${controlled.id.slice(0, 8)} 状态：${controlled.status}`
        })
      )
  }
  admin
    .command('priority <job> <priority>')
    .description('调整 Server 同步任务优先级（-100 到 100）')
    .option('--yes', '跳过确认')
    .action((reference: string, value: string, options: ConfirmOptions) =>
      withAdmin('调整 Server 任务优先级', async (client) => {
        const priority = Number(value)
        if (!Number.isInteger(priority) || priority < -100 || priority > 100) {
          throw new CliError('优先级必须是 -100 到 100 之间的整数', 2)
        }
        const job = resolveAdminJob(await client.listSyncJobs(), reference)
        await requireConfirmation(`确定将任务 ${job.id.slice(0, 8)} 调整为 ${priority}？`, options)
        const controlled = await client.setSyncJobPriority(job.id, priority)
        return `任务 ${controlled.id.slice(0, 8)} 优先级：${controlled.priority}`
      })
    )
  for (const action of ['pause-all', 'resume-all'] as const) {
    admin
      .command(`${action} [hostname]`)
      .description(`${action === 'pause-all' ? '暂停' : '恢复'}全部 Server 任务，可限定 hostname`)
      .option('--yes', '跳过确认')
      .action((hostname: string | undefined, options: ConfirmOptions) =>
        withAdmin('批量控制 Server 任务', async (client) => {
          await requireConfirmation(
            `确定${action === 'pause-all' ? '暂停' : '恢复'}${hostname ?? '全部域名'}的任务？`,
            options
          )
          const changed = await client.controlSyncJobs(action, hostname?.toLowerCase())
          return `已处理 ${changed} 个 Server 任务`
        })
      )
  }
}

async function requireConfirmation(message: string, options: ConfirmOptions): Promise<void> {
  const confirmed = await confirmAction(
    message,
    options.yes,
    '非交互终端控制 Server 任务必须提供 --yes'
  )
  if (!confirmed) throw new CliError('操作已取消', 2)
}

const adminActionLabel = {
  pause: '暂停',
  resume: '恢复',
  stop: '结束并保留内容',
  cancel: '取消并丢弃本次内容'
} as const

function withAdmin(
  title: string,
  action: (client: CloudAdminClient, runtime: LocalRuntime) => Promise<string | void>
): Promise<void> {
  return runWithRuntime(title, async (runtime) => {
    const username = process.env.LOCI_ADMIN_USERNAME?.trim()
    const password = process.env.LOCI_ADMIN_PASSWORD
    if (!username || !password) {
      throw new CliError('请设置 LOCI_ADMIN_USERNAME 和 LOCI_ADMIN_PASSWORD', 2)
    }
    await runtime.admin.login(runtime.database.getSettings().serverUrl, { username, password })
    try {
      return await action(runtime.admin, runtime)
    } finally {
      await runtime.admin.logout().catch(() => undefined)
    }
  })
}

function createInput(options: LibraryOptions): CloudLibraryInput {
  const url = options.url!
  return {
    name: options.name ?? (deriveSourceName(url) || new URL(url).hostname),
    url,
    scopePath: options.scope ?? DOCUMENT_SOURCE_DEFAULTS.scopePath,
    pageLimit: options.pageLimit ?? DOCUMENT_SOURCE_DEFAULTS.pageLimit,
    schedule: scheduleValue(options.schedule, null)
  }
}

function scheduleValue(value: string | undefined, fallback: string | null): string | null {
  if (value === undefined) return fallback
  return parseScheduleInput(value)
}

async function resolveLibrary(client: CloudAdminClient, reference: string): Promise<CloudLibrary> {
  return resolveFromList(await client.listLibraries(), reference)
}

async function selectLibraries(
  client: CloudAdminClient,
  references: string[],
  all: boolean
): Promise<CloudLibrary[]> {
  const libraries = await client.listLibraries()
  if (all) {
    if (!libraries.length) throw new CliError('Server 还没有文档库', 2)
    return libraries
  }
  if (!references.length) throw new CliError('请提供文档库，或使用 --all', 2)
  return Promise.all(references.map((reference) => resolveFromList(libraries, reference)))
}

function resolveFromList(libraries: CloudLibrary[], reference: string): CloudLibrary {
  const matches = libraries.filter(
    (library) =>
      library.id === reference ||
      library.id.startsWith(reference) ||
      library.name.toLowerCase() === reference.toLowerCase()
  )
  if (matches.length === 1) return matches[0]!
  if (!matches.length) throw new CliError(`找不到 Server 文档库：${reference}`, 2)
  throw new CliError(`文档库引用不唯一：${reference}`, 2)
}

function printLibraries(libraries: CloudLibrary[]): string {
  const table = createAdminLibraryTable(libraries)
  printTable(table.headers, table.rows)
  return `共 ${libraries.length} 个 Server 文档库`
}

function printJobs(jobs: CloudSyncJob[]): string {
  const table = createAdminJobTable(jobs)
  printTable(table.headers, table.rows)
  return `共 ${jobs.length} 个同步任务`
}

function integerValue(value: string): number {
  const number = Number(value)
  if (!Number.isInteger(number)) throw new CliError('页面上限必须是整数', 2)
  return number
}
