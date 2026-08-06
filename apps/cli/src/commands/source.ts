import { Option, type Command } from 'commander'
import { deriveSourceName, formatBytes, type DocumentSource, type FetchMode } from '@loci/shared'
import type { BrowserInstallPrompt } from '../browser.js'
import { startBackgroundSourceSync } from '../background-sync.js'
import { runWithRuntime, type CommandResult } from '../command-runtime.js'
import { CliCanceledError, CliError } from '../errors.js'
import { validatePublicUrl } from '../input.js'
import { resolveSource } from '../resources.js'
import {
  readSourceCreatePreference,
  saveRecentResource,
  saveSourceCreatePreference,
  scopeAtDepth,
  scopeDepth
} from '../preferences.js'
import type { CliRuntime } from '../runtime.js'
import { registerSourceHistoryCommands } from './source-history.js'
import { askConfirm, askInteger, askText, createSpinner, note, printTable, warning } from '../ui.js'
import {
  askMode,
  askScope,
  formatSourceChanges,
  formatSourceSummary,
  hasSourceUpdates,
  modeLabel,
  numberValue,
  sameSourceInput
} from './source-prompts.js'

export { askScope } from './source-prompts.js'

interface SourceOptions {
  name?: string
  url?: string
  mode?: FetchMode
  pageLimit?: number
  scope?: string
  httpConcurrency?: number
  browserConcurrency?: number
  yes?: boolean
  sync?: boolean
  background?: boolean
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
    .option('--no-sync', '创建后不执行首次同步')
    .option('--background', '使用一次性后台进程执行首次同步')
    .action((urlArgument: string | undefined, options: SourceOptions) =>
      runWithRuntime('添加文档源', async (runtime) => {
        if (options.background && options.sync === false) {
          throw new CliError('--background 不能与 --no-sync 同时使用', 2)
        }
        const preference = process.stdin.isTTY
          ? readSourceCreatePreference(runtime.database)
          : { mode: 'auto' as const, pageLimit: 1000, scopeDepth: 0, syncAfterCreate: true }
        const guided = process.stdin.isTTY && !urlArgument && !options.url
        const url =
          options.url ??
          urlArgument ??
          (await askText('起始页面 URL', {
            placeholder: 'https://example.com/docs/start',
            validate: validatePublicUrl
          }))
        const hostname = new URL(url).hostname
        const input = {
          name:
            options.name ??
            (guided
              ? await askText('文档源名称', { initialValue: deriveSourceName(url) || hostname })
              : deriveSourceName(url) || hostname),
          url,
          mode:
            options.mode ?? (guided ? await askMode('抓取方式', preference.mode) : preference.mode),
          pageLimit:
            options.pageLimit ??
            (guided
              ? await askInteger('页面上限', {
                  initialValue: preference.pageLimit,
                  minimum: 1,
                  maximum: 10_000
                })
              : preference.pageLimit),
          scopePath:
            options.scope ??
            (guided
              ? await askScope(url, scopeAtDepth(url, preference.scopeDepth))
              : scopeAtDepth(url, preference.scopeDepth)),
          schedule: null,
          httpConcurrency: options.httpConcurrency ?? null,
          browserConcurrency: options.browserConcurrency ?? null
        }
        let syncAfterSave = options.sync !== false
        if (guided) {
          note(formatSourceSummary(input), '请确认文档源配置')
          if (!(await askConfirm('确认添加这个文档源吗？', true))) throw new CliCanceledError()
          if (options.sync !== false) {
            syncAfterSave = await askConfirm(
              '创建后是否立即开始第一次同步？',
              preference.syncAfterCreate
            )
          }
        }
        const saved = runtime.createSource(input)
        saveSourceCreatePreference(runtime.database, {
          mode: input.mode,
          pageLimit: input.pageLimit,
          scopeDepth: scopeDepth(input.url, input.scopePath),
          syncAfterCreate: syncAfterSave
        })
        if (syncAfterSave && options.background) {
          await startBackgroundSourceSync(saved.id)
          return `已添加文档源“${saved.name}”并启动后台同步；运行 loci source runs ${saved.id.slice(0, 8)} 查看记录`
        }
        if (syncAfterSave) return syncSource(runtime, saved)
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
        const current = await resolveSource(runtime, reference, {
          localOnly: true,
          preferenceKey: 'source-update'
        })
        const hasUpdates = hasSourceUpdates(options)
        if (!process.stdin.isTTY && !hasUpdates) {
          throw new CliError('当前终端不可交互，请至少提供一个文档源修改选项', 2)
        }
        const editAll = process.stdin.isTTY && !hasUpdates
        const url =
          options.url ??
          (editAll
            ? await askText('起始页面 URL', {
                initialValue: current.url,
                validate: validatePublicUrl
              })
            : current.url)
        const input = {
          url,
          name:
            options.name ??
            (editAll ? await askText('文档源名称', { initialValue: current.name }) : current.name),
          mode: options.mode ?? (editAll ? await askMode('抓取方式', current.mode) : current.mode),
          pageLimit:
            options.pageLimit ??
            (editAll
              ? await askInteger('页面上限', {
                  initialValue: current.pageLimit,
                  minimum: 1,
                  maximum: 10_000
                })
              : current.pageLimit),
          scopePath:
            options.scope ?? (editAll ? await askScope(url, current.scopePath) : current.scopePath),
          httpConcurrency: options.httpConcurrency ?? current.httpConcurrency,
          browserConcurrency: options.browserConcurrency ?? current.browserConcurrency
        }
        if (editAll && sameSourceInput(current, input)) return `文档源“${current.name}”没有变化`
        let syncAfterSave = false
        if (editAll) {
          if (current.url !== input.url) {
            warning('起始 URL 已变化，现有文档会被清空，需要重新同步')
          }
          note(formatSourceChanges(current, input), '请确认文档源变更')
          if (!(await askConfirm('确认保存这些修改吗？', true))) throw new CliCanceledError()
          if (current.url !== input.url) {
            syncAfterSave = await askConfirm('保存后是否立即重新同步？', true)
          }
        }
        const saved = runtime.updateSourcePreservingDesktopFields(current, input)
        saveRecentResource(runtime.database, 'source-update', saved.id)
        if (syncAfterSave) return syncSource(runtime, saved)
        return `已更新文档源“${saved.name}”`
      })
    )

  source
    .command('delete [source]')
    .description('删除文档源及其全部文档')
    .option('--yes', '跳过确认')
    .action((reference: string | undefined, options: SourceOptions) =>
      runWithRuntime('删除文档源', async (runtime) => {
        const target = await resolveSource(runtime, reference, {
          localOnly: true,
          preferenceKey: 'source-sync'
        })
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
        const result = await syncSource(runtime, target)
        saveRecentResource(runtime.database, 'source-sync', target.id)
        return result
      })
    )
  registerSourceHistoryCommands(source)
}

async function syncSource(
  runtime: CliRuntime,
  target: DocumentSource
): Promise<string | CommandResult> {
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
