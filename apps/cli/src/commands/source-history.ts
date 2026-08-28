import type { Command } from 'commander'
import type { CrawlHistoryRecord } from '@loci/runtime'
import { runWithRuntime } from '../command-runtime.js'
import { CliError } from '../errors.js'
import { saveRecentResource } from '../preferences.js'
import { resolveSource } from '../resources.js'
import { askSearch, note, printTable } from '../ui.js'

export function registerSourceHistoryCommands(source: Command): void {
  source
    .command('history [source]')
    .description('列出最近抓取记录；非交互终端需指定文档源或传入 --all')
    .option('--all', '显示全部文档源的最近记录')
    .action((reference: string | undefined, options: { all?: boolean }) =>
      runWithRuntime('抓取记录', async (runtime) => {
        if (!process.stdin.isTTY && !reference && !options.all) {
          throw new CliError('非交互终端必须指定文档源或传入 --all', 2)
        }
        const target = options.all
          ? undefined
          : await resolveSource(runtime, reference, {
              localOnly: true,
              preferenceKey: 'source-runs'
            })
        if (target) saveRecentResource(runtime.database, 'source-runs', target.id)
        const runs = runtime.database.listCrawlHistory(target?.id)
        printRuns(runs)
        return `已显示 ${runs.length} 条抓取记录`
      })
    )

  source
    .command('run-details [run]')
    .description('查看一次抓取的汇总与页面失败明细；省略时交互选择')
    .action((reference: string | undefined) =>
      runWithRuntime('抓取运行详情', async (runtime) => {
        const allRuns = runtime.database.listCrawlHistory()
        if (!allRuns.length) throw new CliError('还没有抓取记录')
        const run = reference ? resolveRun(allRuns, reference) : await selectRun(runtime)
        note(
          [
            `文档源：${run.sourceName}`,
            `状态：${formatCrawlRunStatus(run.status)}`,
            `开始：${formatTime(run.startedAt)}`,
            `完成：${formatTime(run.finishedAt)}`,
            `发现：${run.discovered}，成功：${run.succeeded}，失败：${run.failed}`,
            `错误：${run.error ?? '—'}`
          ].join('\n'),
          `运行 ${run.id.slice(0, 8)}`
        )
        const failures = runtime.database.listCrawlFailures(run.id)
        printTable(
          ['URL', '原因', '状态码', '可重试', '错误'],
          failures.map((failure) => [
            failure.url,
            failureReasonLabel(failure.reason),
            failure.statusCode ?? '—',
            failure.retryable ? '是' : '否',
            failure.message
          ])
        )
        return failures.length ? `共 ${failures.length} 个页面失败` : '这次运行没有页面失败'
      })
    )
}

async function selectRun(
  runtime: Parameters<typeof resolveSource>[0]
): Promise<CrawlHistoryRecord> {
  const source = await resolveSource(runtime, undefined, {
    localOnly: true,
    message: '请选择要审查的文档源',
    preferenceKey: 'source-runs'
  })
  saveRecentResource(runtime.database, 'source-runs', source.id)
  const runs = runtime.database.listCrawlHistory(source.id)
  if (!runs.length) throw new CliError(`“${source.name}”还没有抓取记录`)
  if (runs.length === 1) return runs[0]!
  const id = await askSearch(
    '请选择一次抓取记录',
    runs.map((run) => ({
      value: run.id,
      label: `${formatTime(run.startedAt)} · ${formatCrawlRunStatus(run.status)}`,
      hint: `成功 ${run.succeeded}，失败 ${run.failed}`
    }))
  )
  return runs.find((run) => run.id === id)!
}

function resolveRun(runs: CrawlHistoryRecord[], reference: string): CrawlHistoryRecord {
  const matches = runs.filter((run) => run.id === reference || run.id.startsWith(reference))
  if (matches.length === 1) return matches[0]!
  if (!matches.length) throw new CliError(`找不到抓取记录：${reference}`, 2)
  throw new CliError(`抓取记录引用不唯一：${reference}`, 2)
}

function printRuns(runs: CrawlHistoryRecord[]): void {
  printTable(
    ['文档源', '状态', '开始时间', '发现', '成功', '失败', '短 ID', '错误'],
    runs.map((run) => [
      run.sourceName,
      formatCrawlRunStatus(run.status),
      formatTime(run.startedAt),
      run.discovered,
      run.succeeded,
      run.failed,
      run.id.slice(0, 8),
      run.error ?? '—'
    ])
  )
}

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '—'
}

export function formatCrawlRunStatus(status: string): string {
  return { queued: '等待', running: '进行中', completed: '成功', failed: '失败' }[status] ?? status
}

function failureReasonLabel(reason: string): string {
  return (
    {
      not_found: '页面不存在',
      out_of_scope_redirect: '重定向越界',
      http_error: 'HTTP 错误',
      request_error: '请求失败'
    }[reason] ?? reason
  )
}
