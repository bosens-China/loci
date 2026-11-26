import { normalizeUrl } from '@loci/core'
import { CrawlCancelledError, SourceContentRemovalRequired, inspectSource } from '@loci/runtime'
import {
  getSourcePatchContentRemovalRisk,
  type CrawlProgress,
  type DocumentSource,
  type FetchMode
} from '@loci/shared'
import { Option, type Command } from 'commander'
import {
  jsonOption,
  output,
  positive,
  withCancellation,
  withRuntime,
  type OutputOptions
} from '../command-runtime.js'
import { cancelCrawl, launchCrawl, type CrawlTarget } from '../crawl-process.js'
import { CliError, errorMessage } from '../errors.js'
import { library } from '../resources.js'
import type { CliRuntime } from '../runtime.js'
import { confirmWrite } from '../ui.js'

interface CrawlOptions extends OutputOptions {
  wait?: boolean
  yes?: boolean
  category?: string
  version?: string
  name?: string
  scope?: string
  exclude?: string
  pageLimit?: number
  httpConcurrency?: number
  browserConcurrency?: number
  mode?: FetchMode
}
interface CrawlRequest extends CrawlTarget {
  source: DocumentSource
}

function crawlOptions(command: Command): Command {
  return jsonOption(command)
    .option('--wait', '在前台等待抓取完成并显示进度')
    .option('--yes', '确认可能裁剪已有正文的配置变更')
    .option('--category <name>', '文档库分类，新分类将自动创建')
    .option('--version <ver>', '文档库版本')
    .option('--name <name>', '文档库名称')
    .option('--scope <path>', '收录路径')
    .option('--exclude <pattern>', '排除路径正则')
    .option('--http-concurrency <n>', 'HTTP 并发', positive)
    .option('--browser-concurrency <n>', '浏览器并发', positive)
    .option('--page-limit <n>', '整库抓取页数上限', positive)
    .addOption(new Option('--mode <mode>', '抓取方式').choices(['auto', 'http', 'browser']))
}

function patch(opts: CrawlOptions) {
  return {
    ...(opts.category !== undefined && { category: opts.category.trim() || null }),
    ...(opts.version !== undefined && { version: opts.version.trim() || null }),
    ...(opts.name !== undefined && { name: opts.name }),
    ...(opts.scope !== undefined && { scopePath: opts.scope }),
    ...(opts.exclude !== undefined && { excludePathPattern: opts.exclude }),
    ...(opts.httpConcurrency !== undefined && { httpConcurrency: opts.httpConcurrency }),
    ...(opts.browserConcurrency !== undefined && { browserConcurrency: opts.browserConcurrency }),
    ...(opts.pageLimit !== undefined && { pageLimit: opts.pageLimit }),
    ...(opts.mode !== undefined && { mode: opts.mode })
  }
}

async function execute(
  runtime: CliRuntime,
  requests: CrawlRequest[],
  opts: CrawlOptions,
  signal: AbortSignal
) {
  const changes = patch(opts)
  const needsConfirmation = opts.yes
    ? []
    : requests.filter(
        ({ source }) => !source.readOnly && getSourcePatchContentRemovalRisk(source, changes)
      )
  if (needsConfirmation.length)
    await confirmWrite(
      `更改「${needsConfirmation.map(({ source }) => source.name).join('、')}」的收录范围或排除规则可能清理旧正文和指定页面，是否继续？`
    )
  const confirmed = new Set(needsConfirmation.map(({ source }) => source.id))
  const allowed = (source: DocumentSource) => opts.yes === true || confirmed.has(source.id)
  if (!opts.wait) {
    const rows = await Promise.allSettled(
      requests.map(async ({ source, ...target }) => {
        signal.throwIfAborted()
        if (source.readOnly) throw new CliError('文档库只读', 2)
        if (target.pages && source.kind !== 'web')
          throw new CliError('指定页面抓取仅支持本地网页文档源', 2)
        for (const url of target.pages ?? []) normalizeUrl(url)
        const { id: libraryId, name } = runtime.patchSource(source.id, changes, allowed(source))
        const started = await launchCrawl(runtime, libraryId, target)
        return {
          libraryId,
          name,
          status: 'running',
          ...started,
          statusCommand: `loci status ${libraryId}`,
          cancelCommand: `loci cancel ${libraryId}`
        }
      })
    )
    const results = rows.map((row, index) => {
      if (row.status === 'fulfilled') return row.value
      if (rows.length === 1) throw row.reason
      process.exitCode = 1
      return {
        libraryId: requests[index]!.source.id,
        name: requests[index]!.source.name,
        status: 'failed',
        error: errorMessage(row.reason)
      }
    })
    output(opts, results, (items) =>
      items
        .map((r) =>
          'statusCommand' in r
            ? `${r.name}  ${r.reused ? '复用进行中的抓取' : '抓取已启动'}  ${r.statusCommand}  ${r.cancelCommand}`
            : `${r.name}  ${r.error}`
        )
        .join('\n')
    )
    return
  }
  const results = await Promise.all(
    requests.map(async ({ source, pages, additionalUrls }) => {
      let latest: CrawlProgress | undefined
      const previousFailures = new Map<string, string>()
      function progress(p: CrawlProgress) {
        for (const f of p.failures ?? []) previousFailures.set(f.url, f.message)
        if (latest?.processed !== p.processed || latest?.node?.url !== p.node?.url) {
          process.stderr.write(`${source.name}  ${p.processed}/${p.queued}  ${p.node?.url ?? ''}\n`)
        }
        latest = p
      }
      try {
        signal.throwIfAborted()
        if (source.readOnly) throw new Error('文档库只读')
        runtime.patchSource(source.id, changes, allowed(source))
        let done: CrawlProgress
        if (pages) {
          const result = await runtime.fetchPages(source.id, pages, undefined, signal, progress)
          for (const item of result.items) {
            if (item.status === 'failed' || item.status === 'missing')
              previousFailures.set(item.url, item.message ?? item.status)
          }
          done = result.progress
        } else
          done = await runtime.crawlSource(source.id, progress, undefined, signal, additionalUrls)
        for (const f of done.failures ?? []) previousFailures.set(f.url, f.message)
        const status = done.failed
          ? done.succeeded
            ? 'completed_with_errors'
            : 'failed'
          : 'completed'
        return {
          libraryId: source.id,
          status,
          succeeded: done.succeeded,
          failed: done.failed,
          ...(done.failed && {
            failures: Array.from(previousFailures, ([url, reason]) => ({ url, reason }))
          })
        }
      } catch (error) {
        return {
          libraryId: source.id,
          status: signal.aborted || error instanceof CrawlCancelledError ? 'cancelled' : 'failed',
          succeeded: latest?.succeeded ?? 0,
          failed: latest?.failed ?? 0,
          error: errorMessage(error),
          ...(previousFailures.size && {
            failures: Array.from(previousFailures, ([url, reason]) => ({ url, reason }))
          })
        }
      }
    })
  )
  if (signal.aborted || results.some((r) => r.status === 'cancelled')) process.exitCode = 130
  else if (results.some((r) => r.status !== 'completed')) process.exitCode = 1
  for (const r of results) {
    if ('error' in r) process.stderr.write(`${r.libraryId}  ${r.error}\n`)
    for (const failure of r.failures ?? [])
      process.stderr.write(`${failure.url}  ${failure.reason}\n`)
  }
  output(opts, results, (rows) =>
    rows
      .map((r) => `${r.libraryId}  ${r.status}  成功 ${r.succeeded} 页，失败 ${r.failed} 页`)
      .join('\n')
  )
}

/** 使用运行时的来源身份去重；指定页面按所属文档库提交为一次任务。 */
export function registerCrawlCommands(program: Command): void {
  crawlOptions(program.command('fetch <urls...>').description('自动识别并抓取文档库'))
    .option('--pages', '仅抓取给定页面')
    .option('--to <library>', '精确抓取到已有库')
    .option('--inspect', '只探测站点规模和路径分布')
    .action(
      async (
        urls: string[],
        opts: CrawlOptions & { pages?: boolean; to?: string; inspect?: boolean }
      ) => {
        await withCancellation(async (signal) => {
          if (opts.inspect) {
            const rows = await Promise.all(
              urls.map((url) =>
                inspectSource({
                  url,
                  scopePath: opts.scope,
                  excludePathPattern: opts.exclude,
                  signal
                })
              )
            )
            signal.throwIfAborted()
            output(
              opts,
              rows.map(
                ({
                  url,
                  kind,
                  discovery,
                  estimatedPages,
                  estimateKind,
                  pathGroups,
                  excludedPages
                }) => ({
                  url,
                  kind,
                  discovery,
                  estimatedPages,
                  estimateKind,
                  pathGroups,
                  excludedPages
                })
              )
            )
            return
          }
          await withRuntime(async (runtime) => {
            if (opts.to !== undefined)
              return execute(
                runtime,
                [{ source: library(runtime, opts.to), pages: urls }],
                opts,
                signal
              )
            const grouped = new Map<string, CrawlRequest>()
            for (const url of urls) {
              const input = { url, ...patch(opts) }
              const source = await createCrawlSource(runtime, input, opts.yes)
              const request: CrawlRequest = grouped.get(source.id) ?? {
                source,
                pages: opts.pages ? [] : undefined
              }
              if (request.pages) request.pages.push(url)
              else if (source.kind === 'web' && normalizeUrl(url) !== normalizeUrl(source.url)) {
                request.additionalUrls ??= []
                request.additionalUrls.push(normalizeUrl(url))
              }
              grouped.set(source.id, request)
            }
            await execute(runtime, [...grouped.values()], opts, signal)
          })
        })
      }
    )
  crawlOptions(program.command('update [libraries...]').description('更新指定文档库及抓取配置'))
    .option('--all', '更新全部可写库')
    .option('--pages <urls...>', '精确刷新指定页面')
    .action(async (refs: string[], opts: CrawlOptions & { all?: boolean; pages?: string[] }) => {
      if (Boolean(refs.length) === Boolean(opts.all))
        throw new CliError('请指定一个或多个文档库，或单独使用 --all', 2)
      await withCancellation((signal) =>
        withRuntime(async (r) => {
          const sources = opts.all
            ? r.listLibraries().filter((s) => !s.readOnly)
            : refs.map((ref) => library(r, ref))
          const unique = new Map(sources.map((source) => [source.id, source]))
          await execute(
            r,
            [...unique.values()].map((source) => ({ source, pages: opts.pages })),
            opts,
            signal
          )
        })
      )
    })
  jsonOption(
    program.command('cancel <library>').description('取消指定文档库正在执行的抓取')
  ).action(async (ref: string, opts: OutputOptions) => {
    const result = await withRuntime((r) => cancelCrawl(r, library(r, ref).id))
    output(
      opts,
      result,
      (r) => `${r.libraryId}  ${r.cancelled ? '抓取已取消' : '当前无进行中的抓取'}  ${r.status}`
    )
  })
  jsonOption(
    program.command('status [library]').description('查看当前进度和最近的抓取结果')
  ).action(async (ref: string | undefined, opts: OutputOptions) => {
    const result = await withRuntime((r) =>
      ref === undefined ? r.listLibraryCrawlStatuses() : r.getLibraryCrawlStatus(library(r, ref).id)
    )
    output(
      opts,
      result,
      (value) =>
        (Array.isArray(value) ? value : value ? [value] : [])
          .map((s) =>
            [
              `${s.libraryId}  ${s.status}  ${s.progress.processed}/${s.progress.discovered}  成功 ${s.progress.succeeded} 页，失败 ${s.progress.failed} 页`,
              s.progress.currentUrl,
              [s.startedAt, s.finishedAt].filter(Boolean).join(' → '),
              s.error,
              ...(s.failures ?? []).map((failure) => `${failure.url}  ${failure.message}`)
            ]
              .filter(Boolean)
              .join('\n')
          )
          .join('\n') || '暂无抓取记录'
    )
  })
}

async function createCrawlSource(
  runtime: CliRuntime,
  input: Parameters<CliRuntime['createSource']>[0],
  yes?: boolean
): Promise<DocumentSource> {
  try {
    return runtime.createSource(input, yes === true)
  } catch (error) {
    if (!(error instanceof SourceContentRemovalRequired)) throw error
    await confirmWrite(`${error.message}，是否继续？`)
    return runtime.createSource(input, true)
  }
}
