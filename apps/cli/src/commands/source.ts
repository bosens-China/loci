import { Option, type Command } from 'commander'
import { deriveSourceName, formatBytes, type FetchMode } from '@loci/shared'
import {
  DOCUMENT_SOURCE_DEFAULTS,
  DOCUMENT_SOURCE_LIMITS,
  parseGithubRepositoryUrl
} from '@loci/core'
import { startBackgroundSourceSync } from '../background-sync.js'
import { runWithRuntime } from '../command-runtime.js'
import { CliCanceledError, CliError } from '../errors.js'
import { validateExcludePathPattern, validatePublicUrl, validateSourceName } from '../input.js'
import { resolveSource } from '../resources.js'
import {
  readSourceCreatePreference,
  saveRecentResource,
  saveSourceCreatePreference,
  scopeAtDepth,
  scopeDepth
} from '../preferences.js'
import { registerSourceHistoryCommands } from './source-history.js'
import { askConfirm, askInteger, askText, note, printTable, warning } from '../ui.js'
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
import { syncSource } from './source-sync.js'

export { askScope } from './source-prompts.js'

interface SourceOptions {
  name?: string
  url?: string
  mode?: FetchMode
  pageLimit?: number
  scope?: string
  excludePath?: string
  httpConcurrency?: number
  browserConcurrency?: number
  yes?: boolean
  sync?: boolean
  background?: boolean
  archiveLimit?: number
  markdownLimit?: number
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
            ['名称', '文档', '内容大小', '类型', '范围', '最近更新', '短 ID'],
            sources.map((item) => [
              item.name,
              item.pages,
              formatBytes(item.contentSize),
              item.kind === 'github' ? 'GitHub' : modeLabel(item.mode),
              item.kind === 'github' ? '默认分支' : item.scopePath,
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
      new Option('--mode <mode>', `抓取方式，默认 ${DOCUMENT_SOURCE_DEFAULTS.mode}`).choices([
        'auto',
        'http',
        'browser'
      ])
    )
    .option(
      '--page-limit <number>',
      `页面上限，默认 ${DOCUMENT_SOURCE_DEFAULTS.pageLimit}`,
      numberValue
    )
    .option('--scope <path>', `收录路径，默认 ${DOCUMENT_SOURCE_DEFAULTS.scopePath}`)
    .option('--exclude-path <regex>', '排除 pathname 的正则，默认不启用')
    .option('--http-concurrency <number>', 'HTTP 并发覆盖值，默认继承共享设置', numberValue)
    .option('--browser-concurrency <number>', '浏览器并发覆盖值，默认继承共享设置', numberValue)
    .option('--archive-limit <size>', 'GitHub ZIP 上限，例如 200mb', sizeMbValue)
    .option('--markdown-limit <size>', 'GitHub Markdown 总量上限，例如 100mb', sizeMbValue)
    .option('--no-sync', '创建后不执行首次同步')
    .addOption(
      new Option(
        '--background',
        '使用一次性后台进程执行首次同步；不能与 --no-sync 同时使用'
      ).conflicts('sync')
    )
    .action((urlArgument: string | undefined, options: SourceOptions, command: Command) =>
      runWithRuntime('添加文档源', async (runtime) => {
        if (options.background && options.sync === false) {
          throw new CliError('--background 不能与 --no-sync 同时使用', 2)
        }
        const preference = process.stdin.isTTY
          ? readSourceCreatePreference(runtime.database)
          : {
              mode: DOCUMENT_SOURCE_DEFAULTS.mode,
              pageLimit: DOCUMENT_SOURCE_DEFAULTS.pageLimit,
              scopeDepth: 0,
              syncAfterCreate: true
            }
        const guided =
          process.stdin.isTTY &&
          !urlArgument &&
          !options.url &&
          !command.options.some(
            (option) => command.getOptionValueSource(option.attributeName()) === 'cli'
          )
        const url =
          options.url ??
          urlArgument ??
          (await askText('起始页面 URL', {
            placeholder: 'https://example.com/docs/start',
            validate: validatePublicUrl
          }))
        const repository = parseGithubRepositoryUrl(url)
        const hostname = new URL(url).hostname
        const input = {
          name:
            options.name ??
            (guided
              ? await askText('文档源名称', {
                  initialValue: repository?.repo || deriveSourceName(url) || hostname,
                  validate: validateSourceName
                })
              : repository?.repo || deriveSourceName(url) || hostname),
          url,
          mode: repository
            ? DOCUMENT_SOURCE_DEFAULTS.mode
            : (options.mode ??
              (guided ? await askMode('抓取方式', preference.mode) : preference.mode)),
          pageLimit:
            options.pageLimit ??
            (guided
              ? await askInteger('页面上限', {
                  initialValue: preference.pageLimit,
                  minimum: DOCUMENT_SOURCE_LIMITS.pageLimit.min,
                  maximum: DOCUMENT_SOURCE_LIMITS.pageLimit.max
                })
              : preference.pageLimit),
          scopePath: repository
            ? DOCUMENT_SOURCE_DEFAULTS.scopePath
            : (options.scope ??
              (guided
                ? await askScope(url, scopeAtDepth(url, preference.scopeDepth))
                : scopeAtDepth(url, preference.scopeDepth))),
          excludePathPattern: repository
            ? null
            : (options.excludePath ??
              (guided
                ? await askText('排除路径正则（选填）', {
                    required: false,
                    placeholder: '/(zh|de|fr)(/|$)',
                    validate: validateExcludePathPattern
                  })
                : null)),
          schedule: DOCUMENT_SOURCE_DEFAULTS.schedule,
          httpConcurrency: options.httpConcurrency ?? DOCUMENT_SOURCE_DEFAULTS.httpConcurrency,
          browserConcurrency:
            options.browserConcurrency ?? DOCUMENT_SOURCE_DEFAULTS.browserConcurrency,
          githubArchiveLimitMb:
            options.archiveLimit ?? DOCUMENT_SOURCE_DEFAULTS.githubArchiveLimitMb,
          githubMarkdownLimitMb:
            options.markdownLimit ?? DOCUMENT_SOURCE_DEFAULTS.githubMarkdownLimitMb
        }
        let syncAfterSave = options.sync !== false
        if (guided) {
          note(formatSourceSummary(input, runtime.database.getSettings()), '请确认文档源配置')
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
    .description('修改文档源；无选项时交互编辑，传入选项时只修改指定字段')
    .option('--name <name>', '文档源名称')
    .option('--url <url>', '第一个页面 URL')
    .addOption(new Option('--mode <mode>', '抓取方式').choices(['auto', 'http', 'browser']))
    .option('--page-limit <number>', '页面上限', numberValue)
    .option('--scope <path>', '收录路径')
    .option('--exclude-path <regex>', '排除 pathname 的正则；传空字符串可清除')
    .option('--http-concurrency <number>', 'HTTP 并发覆盖值', numberValue)
    .option('--browser-concurrency <number>', '浏览器并发覆盖值', numberValue)
    .option('--archive-limit <size>', 'GitHub ZIP 上限，例如 200mb', sizeMbValue)
    .option('--markdown-limit <size>', 'GitHub Markdown 总量上限，例如 100mb', sizeMbValue)
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
            (editAll
              ? await askText('文档源名称', {
                  initialValue: current.name,
                  validate: validateSourceName
                })
              : current.name),
          mode: parseGithubRepositoryUrl(url)
            ? DOCUMENT_SOURCE_DEFAULTS.mode
            : (options.mode ?? (editAll ? await askMode('抓取方式', current.mode) : current.mode)),
          pageLimit:
            options.pageLimit ??
            (editAll
              ? await askInteger('页面上限', {
                  initialValue: current.pageLimit,
                  minimum: DOCUMENT_SOURCE_LIMITS.pageLimit.min,
                  maximum: DOCUMENT_SOURCE_LIMITS.pageLimit.max
                })
              : current.pageLimit),
          scopePath: parseGithubRepositoryUrl(url)
            ? DOCUMENT_SOURCE_DEFAULTS.scopePath
            : (options.scope ??
              (editAll ? await askScope(url, current.scopePath) : current.scopePath)),
          excludePathPattern: parseGithubRepositoryUrl(url)
            ? null
            : options.excludePath !== undefined
              ? options.excludePath
              : editAll
                ? await askText('排除路径正则（选填）', {
                    initialValue: current.excludePathPattern ?? '',
                    required: false,
                    placeholder: '/(zh|de|fr)(/|$)',
                    validate: validateExcludePathPattern
                  })
                : (current.excludePathPattern ?? null),
          httpConcurrency: options.httpConcurrency ?? current.httpConcurrency,
          browserConcurrency: options.browserConcurrency ?? current.browserConcurrency,
          githubArchiveLimitMb: options.archiveLimit ?? current.githubArchiveLimitMb,
          githubMarkdownLimitMb: options.markdownLimit ?? current.githubMarkdownLimitMb
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
        if (!options.yes && !process.stdin.isTTY) {
          throw new CliError('非交互终端请传入 --yes 跳过删除确认', 2)
        }
        const target = await resolveSource(runtime, reference, {
          localOnly: true,
          preferenceKey: 'source-delete'
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
        const target = await resolveSource(runtime, reference, {
          localOnly: true,
          preferenceKey: 'source-sync'
        })
        const result = await syncSource(runtime, target)
        saveRecentResource(runtime.database, 'source-sync', target.id)
        return result
      })
    )
  registerSourceHistoryCommands(source)
}

function sizeMbValue(value: string): number {
  const match = /^(\d+)(?:\s*(?:m|mb|mib))?$/i.exec(value.trim())
  if (!match) throw new CliError(`无效大小：${value}，请使用整数 MB，例如 200mb`, 2)
  return numberValue(match[1]!)
}
