import { Option, type Command } from 'commander'
import type { LocalJob, LocalJobEvent } from '@loci/shared'
import { runWithRuntime } from '../command-runtime.js'
import { CliError } from '../errors.js'
import { createCliRuntime, type CliRuntime } from '../runtime.js'
import { ensureLocalJobWorkerRunning } from '../service-manager.js'
import { askSelect, printTable } from '../ui.js'

interface FollowOptions {
  format: 'text' | 'jsonl'
}

export function registerTaskCommands(program: Command): void {
  const task = program.command('task').description('查看、跟随和取消本地持久任务')

  task
    .command('list')
    .description('列出最近的本地任务')
    .action(() =>
      runWithRuntime('本地任务', async (runtime) => {
        const jobs = runtime.database.listLocalJobs()
        printTable(
          ['任务 ID', '来源 ID', '状态', '进度', '触发'],
          jobs.map((job) => [job.id, job.sourceId, job.status, progressText(job), job.trigger])
        )
        return `共 ${jobs.length} 个任务`
      })
    )

  task
    .command('status [task]')
    .description('查看一个任务的当前状态；省略时交互选择')
    .action((reference: string | undefined) =>
      runWithRuntime('任务状态', async (runtime) => {
        const job = await resolveTaskInteractive(runtime, reference)
        return JSON.stringify(job, null, 2)
      })
    )

  task
    .command('follow [task]')
    .description('从持久事件中逐页跟随任务；Ctrl+C 只停止跟随；省略时交互选择')
    .addOption(
      new Option('--format <format>', '输出格式').choices(['text', 'jsonl']).default('text')
    )
    .action(async (reference: string | undefined, options: FollowOptions) => {
      const runtime = createCliRuntime()
      try {
        const job = await resolveTaskInteractive(runtime, reference)
        await followTask(runtime, job, options)
      } finally {
        await runtime.close()
      }
    })

  task
    .command('cancel [task]')
    .description('请求取消 pending 或 running 任务；省略时交互选择')
    .action((reference: string | undefined) =>
      runWithRuntime('取消任务', async (runtime) => {
        const job = await resolveTaskInteractive(runtime, reference)
        const current = runtime.database.requestLocalJobCancellation(job.id)
        if (!current) throw new CliError('任务不存在', 2)
        return current.status === 'cancelled'
          ? `任务 ${current.id} 已取消`
          : current.cancelRequested
            ? `任务 ${current.id} 正在取消`
            : `任务 ${current.id} 已经结束，当前状态为 ${current.status}`
      })
    )
}

async function followTask(
  runtime: CliRuntime,
  initial: LocalJob,
  options: FollowOptions
): Promise<void> {
  let detached = false
  const detach = (): void => {
    detached = true
  }
  process.once('SIGINT', detach)
  process.once('SIGTERM', detach)
  try {
    if (isActive(initial)) await ensureLocalJobWorkerRunning()
    let sequence = 0
    while (!detached) {
      let events: LocalJobEvent[]
      do {
        events = runtime.database.listLocalJobEvents(initial.id, sequence, 500)
        for (const event of events) {
          sequence = event.sequence
          writeEvent(event, options.format)
        }
      } while (events.length === 500)
      const current = runtime.database.getLocalJob(initial.id)
      if (!current) throw new CliError('任务不存在', 2)
      if (!isActive(current)) {
        writeTerminal(current, options.format)
        return
      }
      await delay(100)
    }
    writeDetached(initial.id, options.format)
  } finally {
    process.off('SIGINT', detach)
    process.off('SIGTERM', detach)
  }
}

function resolveTask(runtime: CliRuntime, reference: string): LocalJob {
  const exact = runtime.database.getLocalJob(reference)
  if (exact) return exact
  const matches = runtime.database.listLocalJobs(500).filter((job) => job.id.startsWith(reference))
  if (matches.length === 0) throw new CliError(`找不到任务：${reference}`, 2)
  if (matches.length > 1) throw new CliError(`任务短 ID 不唯一：${reference}`, 2)
  return matches[0]!
}

/** 省略参数时在 TTY 下交互选择任务；非 TTY 必须传入 reference。 */
async function resolveTaskInteractive(
  runtime: CliRuntime,
  reference: string | undefined
): Promise<LocalJob> {
  if (reference !== undefined) return resolveTask(runtime, reference)
  if (!process.stdin.isTTY) throw new CliError('非交互终端必须指定任务 ID', 2)
  return selectTask(runtime)
}

/** 从最近任务列表中交互选择一个任务。 */
async function selectTask(runtime: CliRuntime): Promise<LocalJob> {
  const jobs = runtime.database.listLocalJobs(50)
  if (jobs.length === 0) throw new CliError('还没有本地任务', 2)
  const id = await askSelect(
    '请选择任务',
    jobs.map((job) => ({
      value: job.id,
      label: `${job.id.slice(0, 8)} · ${job.status}`,
      hint: `${job.sourceId ?? '—'} · ${progressText(job)} · ${job.trigger}`
    }))
  )
  return jobs.find((job) => job.id === id)!
}

function writeEvent(event: LocalJobEvent, format: FollowOptions['format']): void {
  const line =
    format === 'jsonl'
      ? JSON.stringify({ type: 'page', ...event })
      : `[${event.progress.processed}/${Math.max(event.progress.queued, event.progress.processed)}] ${event.node.status} ${event.node.title} ${event.node.url}`
  process.stdout.write(`${line}\n`)
}

function writeTerminal(job: LocalJob, format: FollowOptions['format']): void {
  const line =
    format === 'jsonl'
      ? JSON.stringify({
          type: 'terminal',
          task_id: job.id,
          status: job.status,
          result: job.result
        })
      : `任务 ${job.id} 已结束：${job.status}（${progressText(job)}）`
  process.stdout.write(`${line}\n`)
}

function writeDetached(id: string, format: FollowOptions['format']): void {
  const line =
    format === 'jsonl'
      ? JSON.stringify({ type: 'detached', task_id: id })
      : `已停止跟随；任务仍在后台运行。任务 ID：${id}`
  process.stdout.write(`${line}\n`)
}

function progressText(job: LocalJob): string {
  return job.result
    ? `${job.result.processed}/${Math.max(job.result.queued, job.result.processed)}`
    : '尚未开始'
}

function isActive(job: LocalJob): boolean {
  return job.status === 'pending' || job.status === 'running'
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
