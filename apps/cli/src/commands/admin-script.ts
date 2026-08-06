import type { Command } from 'commander'
import {
  deriveSourceName,
  normalizeCronSchedule,
  type CloudLibrary,
  type CloudLibraryInput,
  type CloudSyncJob
} from '@loci/shared'
import type { CloudAdminClient } from '@loci/runtime'
import { runWithRuntime } from '../command-runtime.js'
import { CliError } from '../errors.js'
import { askConfirm, printTable } from '../ui.js'

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
    .option('--scope <path>', '收录范围', '/')
    .option('--page-limit <number>', '页面上限', integerValue, 1000)
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
    .option('--schedule <cron>', '5 段 Cron；传 manual 关闭计划')
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
        if (!options.yes) {
          if (!process.stdin.isTTY) throw new CliError('非交互终端删除文档库必须提供 --yes', 2)
          if (!(await askConfirm(`确定删除“${library.name}”吗？`))) return '已取消删除'
        }
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

  admin
    .command('cancel <job>')
    .description('取消排队或运行中的 Server 同步任务')
    .action((jobId: string) =>
      withAdmin('取消 Server 同步任务', async (client) => {
        const job = await client.cancelSyncJob(jobId)
        return `任务 ${job.id.slice(0, 8)} 状态：${job.status}`
      })
    )
}

function withAdmin(
  title: string,
  action: (client: CloudAdminClient) => Promise<string | void>
): Promise<void> {
  return runWithRuntime(title, async (runtime) => {
    const username = process.env.LOCI_ADMIN_USERNAME?.trim()
    const password = process.env.LOCI_ADMIN_PASSWORD
    if (!username || !password) {
      throw new CliError('请设置 LOCI_ADMIN_USERNAME 和 LOCI_ADMIN_PASSWORD', 2)
    }
    await runtime.admin.login(runtime.database.getSettings().serverUrl, { username, password })
    try {
      return await action(runtime.admin)
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
    scopePath: options.scope ?? '/',
    pageLimit: options.pageLimit ?? 1000,
    schedule: scheduleValue(options.schedule, null)
  }
}

function scheduleValue(value: string | undefined, fallback: string | null): string | null {
  if (value === undefined) return fallback
  return value === 'manual' ? null : normalizeCronSchedule(value)
}

async function resolveLibrary(client: CloudAdminClient, reference: string): Promise<CloudLibrary> {
  const matches = (await client.listLibraries()).filter(
    (library) =>
      library.id === reference ||
      library.id.startsWith(reference) ||
      library.name.toLowerCase() === reference.toLowerCase()
  )
  if (matches.length === 1) return matches[0]!
  if (!matches.length) throw new CliError(`找不到 Server 文档库：${reference}`, 2)
  throw new CliError(`文档库引用不唯一：${reference}`, 2)
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
  printTable(
    ['名称', '范围', '页面', '计划', '最近同步', '短 ID'],
    libraries.map((library) => [
      library.name,
      library.scopePath,
      library.pages,
      library.schedule ?? '仅手动',
      library.lastCrawledAt ?? '—',
      library.id.slice(0, 8)
    ])
  )
  return `共 ${libraries.length} 个 Server 文档库`
}

function printJobs(jobs: CloudSyncJob[]): string {
  printTable(
    ['任务', '文档库', '状态', '创建时间', '完成时间', '错误'],
    jobs.map((job) => [
      job.id.slice(0, 8),
      job.libraryId.slice(0, 8),
      job.status,
      job.createdAt,
      job.finishedAt ?? '—',
      job.error ?? '—'
    ])
  )
  return `共 ${jobs.length} 个同步任务`
}

function integerValue(value: string): number {
  const number = Number(value)
  if (!Number.isInteger(number)) throw new CliError('页面上限必须是整数', 2)
  return number
}
