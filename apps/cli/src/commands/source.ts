import { Option, type Command } from 'commander'
import { deriveSourceName, formatBytes, type FetchMode } from '@loci/shared'
import type { BrowserInstallPrompt } from '../browser.js'
import { runWithRuntime } from '../command-runtime.js'
import { CliError } from '../errors.js'
import { resolveSource } from '../resources.js'
import { askConfirm, askSelect, askText, createSpinner, printTable } from '../ui.js'

interface SourceOptions {
  name?: string
  url?: string
  mode?: FetchMode
  pageLimit?: number
  scope?: string
  httpConcurrency?: number
  browserConcurrency?: number
  yes?: boolean
}

export function registerSourceCommands(program: Command): void {
  const source = program.command('source').description('管理本地文档源')

  source
    .command('list')
    .description('列出本地文档源')
    .action(() =>
      runWithRuntime('本地文档源', async (runtime) => {
        const sources = runtime.database.listSources().filter((item) => item.cloud === null)
        if (sources.length === 0) {
          process.stdout.write('还没有本地文档源，可运行 loci source add 创建。\n')
        } else {
          printTable(
            ['名称', '页面', '内容大小', '方式', '范围', '最近更新', '短 ID'],
            sources.map((item) => [
              item.name,
              item.pages,
              formatBytes(item.contentSize),
              modeLabel(item.mode),
              item.scopePath,
              item.lastUpdated,
              item.id.slice(0, 8)
            ])
          )
        }
        return `共 ${sources.length} 个本地文档源`
      })
    )

  source
    .command('add [url]')
    .description('添加本地文档源')
    .option('--name <name>', '文档源名称，默认根据域名生成')
    .option('--url <url>', '第一个公开文档页面 URL')
    .addOption(
      new Option('--mode <mode>', '抓取方式，默认 auto').choices(['auto', 'http', 'browser'])
    )
    .option('--page-limit <number>', '页面上限，默认 1000', numberValue)
    .option('--scope <path>', '收录路径，默认 /')
    .option('--http-concurrency <number>', 'HTTP 并发覆盖值，默认继承共享设置', numberValue)
    .option('--browser-concurrency <number>', '浏览器并发覆盖值，默认继承共享设置', numberValue)
    .action((urlArgument: string | undefined, options: SourceOptions) =>
      runWithRuntime('添加文档源', async (runtime) => {
        const guided = process.stdin.isTTY && !urlArgument && !options.url
        const url =
          options.url ?? urlArgument ?? (await askText('第一个文档页面 URL', { required: true }))
        const hostname = new URL(url).hostname
        const input = {
          name:
            options.name ??
            (guided
              ? await askText('文档源名称', { initialValue: deriveSourceName(url) || hostname })
              : deriveSourceName(url) || hostname),
          url,
          mode: options.mode ?? (guided ? await askMode('抓取方式', 'auto') : 'auto'),
          pageLimit:
            options.pageLimit ?? (guided ? await askInteger('页面上限', 1000, 1, 10_000) : 1000),
          scopePath:
            options.scope ?? (guided ? await askText('收录路径', { initialValue: '/' }) : '/'),
          schedule: null,
          httpConcurrency: options.httpConcurrency ?? null,
          browserConcurrency: options.browserConcurrency ?? null
        }
        const saved = runtime.createSource(input)
        return `已添加文档源“${saved.name}”；运行 loci source sync ${saved.id.slice(0, 8)} 开始同步`
      })
    )

  source
    .command('update [source]')
    .description('只修改显式提供的字段，不改变桌面端定时计划')
    .option('--name <name>', '文档源名称')
    .option('--url <url>', '第一个页面 URL')
    .addOption(new Option('--mode <mode>', '抓取方式').choices(['auto', 'http', 'browser']))
    .option('--page-limit <number>', '页面上限', numberValue)
    .option('--scope <path>', '收录路径')
    .option('--http-concurrency <number>', 'HTTP 并发覆盖值', numberValue)
    .option('--browser-concurrency <number>', '浏览器并发覆盖值', numberValue)
    .action((reference: string | undefined, options: SourceOptions) =>
      runWithRuntime('修改文档源', async (runtime) => {
        const current = await resolveSource(runtime, reference, { localOnly: true })
        const hasUpdates = hasSourceUpdates(options)
        if (!process.stdin.isTTY && !hasUpdates) {
          throw new CliError('当前终端不可交互，请至少提供一个文档源修改选项', 2)
        }
        const editAll = process.stdin.isTTY && !hasUpdates
        const input = {
          name:
            options.name ??
            (editAll ? await askText('文档源名称', { initialValue: current.name }) : current.name),
          url:
            options.url ??
            (editAll
              ? await askText('第一个页面 URL', { initialValue: current.url })
              : current.url),
          mode: options.mode ?? (editAll ? await askMode('抓取方式', current.mode) : current.mode),
          pageLimit:
            options.pageLimit ??
            (editAll
              ? await askInteger('页面上限', current.pageLimit, 1, 10_000)
              : current.pageLimit),
          scopePath:
            options.scope ??
            (editAll
              ? await askText('收录路径', { initialValue: current.scopePath })
              : current.scopePath),
          httpConcurrency: options.httpConcurrency ?? current.httpConcurrency,
          browserConcurrency: options.browserConcurrency ?? current.browserConcurrency
        }
        const saved = runtime.updateSourcePreservingDesktopFields(current, input)
        return `已更新文档源“${saved.name}”`
      })
    )

  source
    .command('delete [source]')
    .description('删除文档源及其全部文档')
    .option('--yes', '跳过确认')
    .action((reference: string | undefined, options: SourceOptions) =>
      runWithRuntime('删除文档源', async (runtime) => {
        const target = await resolveSource(runtime, reference, { localOnly: true })
        if (!options.yes) {
          const confirmed = await askConfirm(
            `确定删除“${target.name}”及其 ${target.pages} 篇文档吗？`,
            false
          )
          if (!confirmed) return `未删除文档源“${target.name}”`
        }
        runtime.deleteSource(target.id)
        return `已删除文档源“${target.name}”及其 ${target.pages} 篇文档`
      })
    )

  source
    .command('sync [source]')
    .description('在前台同步一个本地文档源')
    .action((reference: string | undefined) =>
      runWithRuntime('同步文档源', async (runtime) => {
        const target = await resolveSource(runtime, reference, { localOnly: true })
        const spinner = createSpinner()
        spinner.start(`正在同步“${target.name}”`)
        try {
          const progress = await runtime.crawlSource(
            target.id,
            (current) => {
              spinner.message(
                `已处理 ${current.processed}/${current.queued}，成功 ${current.succeeded}，失败 ${current.failed}`
              )
            },
            createBrowserInstallPrompt(spinner, target.name)
          )
          const summary = `同步完成：成功 ${progress.succeeded}，失败 ${progress.failed}${progress.limitReached ? '，已达到页面上限' : ''}`
          spinner.stop(summary)
          return progress.failed > 0
            ? {
                message: `文档源“${target.name}”已同步，但有 ${progress.failed} 个页面失败`,
                tone: 'warning'
              }
            : `文档源“${target.name}”同步成功`
        } catch (error) {
          spinner.error('同步失败')
          throw error
        }
      })
    )

  source
    .command('runs [source]')
    .description('查看最近抓取记录')
    .action((reference: string | undefined) =>
      runWithRuntime('抓取记录', async (runtime) => {
        const target = reference
          ? await resolveSource(runtime, reference, { localOnly: true })
          : undefined
        const runs = runtime.database.listCrawlHistory(target?.id)
        printTable(
          ['状态', '开始时间', '发现', '成功', '失败', '错误'],
          runs.map((run) => [
            statusLabel(run.status),
            run.startedAt ? new Date(run.startedAt).toLocaleString('zh-CN') : '—',
            run.discovered,
            run.succeeded,
            run.failed,
            run.error ?? '—'
          ])
        )
        return `已显示 ${runs.length} 条抓取记录`
      })
    )
}

function createBrowserInstallPrompt(
  spinner: ReturnType<typeof createSpinner>,
  sourceName: string
): BrowserInstallPrompt | undefined {
  if (!process.stdin.isTTY) return undefined
  return async (install) => {
    spinner.stop('检测到当前环境缺少无头浏览器')
    const confirmed = await askConfirm(
      '抓取当前文档源需要 Chromium headless shell，是否现在安装？',
      true
    )
    if (!confirmed) {
      throw new CliError('已取消安装无头浏览器，本次同步未执行。')
    }
    process.stdout.write('正在安装 Chromium headless shell…\n')
    await install()
    spinner.start(`继续同步“${sourceName}”`)
  }
}

function hasSourceUpdates(options: SourceOptions): boolean {
  return Object.values(options).some((value) => value !== undefined)
}

async function askMode(message: string, initial: FetchMode): Promise<FetchMode> {
  return askSelect(
    message,
    [
      { value: 'auto', label: '自动判断' },
      { value: 'http', label: 'HTTP' },
      { value: 'browser', label: '浏览器' }
    ],
    initial
  )
}

async function askInteger(
  message: string,
  initial: number,
  minimum: number,
  maximum: number
): Promise<number> {
  const value = Number(await askText(message, { initialValue: String(initial) }))
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new CliError(`${message}必须是 ${minimum} 到 ${maximum} 之间的整数`, 2)
  }
  return value
}

function numberValue(value: string): number {
  const number = Number(value)
  if (!Number.isInteger(number)) throw new CliError(`无效整数：${value}`, 2)
  return number
}

function modeLabel(mode: FetchMode): string {
  return { auto: '自动', http: 'HTTP', browser: '浏览器' }[mode]
}

function statusLabel(status: string): string {
  return { queued: '等待', running: '进行中', completed: '成功', failed: '失败' }[status] ?? status
}
