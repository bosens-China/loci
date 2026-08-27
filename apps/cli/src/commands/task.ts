import { setTimeout as delay } from 'node:timers/promises'
import { Option, type Command } from 'commander'
import { formatLocalDate, type LocalJob, type LocalJobEvent, type OperationLog } from '@loci/shared'
import { runWithRuntime } from '../command-runtime.js'
import { CliError } from '../errors.js'
import { createCliRuntime, type CliRuntime } from '../runtime.js'
import { ensureLocalJobWorkerRunning } from '../service-manager.js'
import { askSelect, confirmAction, printTable } from '../ui.js'

interface FollowOptions {
  format: 'text' | 'jsonl'
}

interface ConfirmOptions {
  yes?: boolean
}

interface ListOptions {
  hostname?: string
  status?: LocalJob['status']
  date?: string
}

interface LogOptions {
  date?: string
  category?: OperationLog['category']
  level?: OperationLog['level']
  hostname?: string
}

export function registerTaskCommands(program: Command): void {
  const task = program.command('task').description('查看、跟随和控制本地持久任务')

  task
    .command('list')
    .description('列出最近的本地任务')
    .option('--hostname <hostname>', '按 hostname 筛选')
    .addOption(
      new Option('--status <status>', '按状态筛选').choices([
        'pending',
        'running',
        'completed',
        'failed',
        'cancelled'
      ])
    )
    .option('--date <yyyy-mm-dd>', '按本地批次日期筛选')
    .action((options: ListOptions) =>
      runWithRuntime('本地任务', async (runtime) => {
        const jobs = filterListedJobs(runtime.database.listLocalJobs(), options)
        printTable(
          ['任务 ID', '来源 ID', '域名', '状态', '进度', '触发', '批次日期'],
          jobs.map((job) => [
            job.id,
            job.sourceId,
            job.hostname,
            describeJobState(job),
            progressText(job),
            job.trigger,
            formatLocalDate(job.scheduledAt)
          ])
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
    .option('-y, --yes', '跳过二次确认')
    .action((reference: string | undefined, options: ConfirmOptions) =>
      runWithRuntime('取消任务', async (runtime) => {
        const job = await resolveTaskInteractive(runtime, reference)
        await requireConfirmation(`确认取消任务 ${job.id} 并丢弃本次内容？`, options)
        const current = runtime.database.requestLocalJobCancellation(job.id)
        if (!current) throw new CliError('任务不存在', 2)
        return current.status === 'cancelled'
          ? `任务 ${current.id} 已取消`
          : current.cancelRequested
            ? `任务 ${current.id} 正在取消`
            : `任务 ${current.id} 已经结束，当前状态为 ${current.status}`
      })
    )

  registerSingleJobControl(task, 'pause', '暂停任务', async (runtime, id) =>
    runtime.database.requestLocalJobPause(id)
  )
  registerSingleJobControl(task, 'resume', '恢复任务', async (runtime, id) => {
    const job = runtime.database.resumeLocalJob(id)
    if (job) await ensureLocalJobWorkerRunning()
    return job
  })
  registerSingleJobControl(task, 'stop', '结束任务并保留已抓取内容', async (runtime, id) =>
    runtime.database.requestLocalJobStop(id)
  )

  task
    .command('priority <priority> [task]')
    .description('调整任务优先级，数值越大越先执行；省略任务时交互选择')
    .option('-y, --yes', '跳过二次确认')
    .action((priorityValue: string, reference: string | undefined, options: ConfirmOptions) =>
      runWithRuntime('调整任务优先级', async (runtime) => {
        const priority = Number(priorityValue)
        if (!Number.isInteger(priority) || priority < -100 || priority > 100) {
          throw new CliError('优先级必须是 -100 到 100 之间的整数', 2)
        }
        const job = await resolveTaskInteractive(runtime, reference)
        await requireConfirmation(`确认将任务 ${job.id} 的优先级调整为 ${priority}？`, options)
        const current = runtime.database.setLocalJobPriority(job.id, priority)
        if (!current) throw new CliError('任务不存在', 2)
        return `任务 ${current.id} 的优先级已调整为 ${current.priority}`
      })
    )

  registerBulkJobControl(task, 'pause-all', '暂停', (runtime, hostname) =>
    runtime.database.pauseLocalJobs(hostname)
  )
  registerBulkJobControl(task, 'resume-all', '恢复', async (runtime, hostname) => {
    const changed = runtime.database.resumeLocalJobs(hostname)
    if (changed > 0) await ensureLocalJobWorkerRunning()
    return changed
  })

  task
    .command('logs')
    .description('查看结构化操作日志')
    .option('--date <yyyy-mm-dd>', '按本地日期筛选')
    .addOption(
      new Option('--category <category>', '按分类筛选').choices([
        'task',
        'library',
        'settings',
        'cloud',
        'maintenance',
        'system'
      ])
    )
    .addOption(new Option('--level <level>', '按级别筛选').choices(['info', 'warning', 'error']))
    .option('--hostname <hostname>', '按 hostname 筛选')
    .action((options: LogOptions) =>
      runWithRuntime('操作日志', async (runtime) => {
        const response = runtime.database.listOperationLogs({ ...options, limit: 100 })
        printTable(
          ['时间', '分类', '操作', '级别', '域名', '消息'],
          response.items.map((item) => [
            item.createdAt,
            item.category,
            item.action,
            item.level,
            item.hostname ?? '—',
            item.message
          ])
        )
        return `共 ${response.total} 条操作记录`
      })
    )
}

function registerSingleJobControl(
  task: Command,
  action: 'pause' | 'resume' | 'stop',
  label: string,
  control: (runtime: CliRuntime, id: string) => Promise<LocalJob | undefined>
): void {
  task
    .command(`${action} [task]`)
    .description(`${label}；省略任务时交互选择`)
    .option('-y, --yes', '跳过二次确认')
    .action((reference: string | undefined, options: ConfirmOptions) =>
      runWithRuntime(label, async (runtime) => {
        const job = await resolveTaskInteractive(runtime, reference)
        await requireConfirmation(`确认${label} ${job.id}？`, options)
        const current = await control(runtime, job.id)
        if (!current) throw new CliError('任务不存在', 2)
        return `任务 ${current.id} 当前状态：${describeJobState(current)}`
      })
    )
}

function registerBulkJobControl(
  task: Command,
  command: 'pause-all' | 'resume-all',
  label: '暂停' | '恢复',
  control: (runtime: CliRuntime, hostname?: string) => number | Promise<number>
): void {
  task
    .command(`${command} [hostname]`)
    .description(`${label}全部活动任务；可仅处理一个 hostname`)
    .option('-y, --yes', '跳过二次确认')
    .action((hostname: string | undefined, options: ConfirmOptions) =>
      runWithRuntime(`${label}全部任务`, async (runtime) => {
        const scope = hostname ? `域名 ${hostname}` : '全部域名'
        await requireConfirmation(`确认${label}${scope}的活动任务？`, options)
        const changed = await control(runtime, hostname?.trim().toLowerCase() || undefined)
        return `已${label} ${changed} 个任务`
      })
    )
}

async function requireConfirmation(message: string, options: ConfirmOptions): Promise<void> {
  const confirmed = await confirmAction(
    message,
    options.yes,
    '非交互终端执行任务控制必须传入 --yes'
  )
  if (!confirmed) throw new CliError('操作已取消', 2)
}

function describeJobState(job: LocalJob): string {
  if (job.stopRequested) return '等待结束'
  if (job.pauseRequested || job.paused) return '已暂停'
  return job.status
}

function filterListedJobs(jobs: LocalJob[], options: ListOptions): LocalJob[] {
  const hostname = options.hostname?.trim().toLowerCase()
  if (options.date && !/^\d{4}-\d{2}-\d{2}$/u.test(options.date)) {
    throw new CliError('--date 必须使用 YYYY-MM-DD 格式', 2)
  }
  return jobs.filter(
    (job) =>
      (!hostname || job.hostname === hostname) &&
      (!options.status || job.status === options.status) &&
      (!options.date || formatLocalDate(job.scheduledAt) === options.date)
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
