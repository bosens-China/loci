import { Cron } from 'croner'
import type { Command } from 'commander'
import { acquireRuntimeLock, type RuntimeLock } from '@loci/runtime'
import {
  SCHEDULE_PRESETS,
  getSchedulePreset,
  normalizeCronSchedule,
  type DocumentSource
} from '@loci/shared'
import { runWithRuntime } from '../command-runtime.js'
import { CliError } from '../errors.js'
import { waitForTermination } from '../process-lifecycle.js'
import { resolveSource } from '../resources.js'
import { createCliRuntime } from '../runtime.js'
import { askSelect, askText, finishUi, info, printTable, startUi, warning } from '../ui.js'

const DAY_MS = 24 * 60 * 60 * 1000
const MANUAL = 'manual'
const CUSTOM = 'custom'

export function registerScheduleCommands(program: Command): void {
  const schedule = program.command('schedule').description('管理并运行 CLI 定时同步')

  schedule
    .command('list')
    .description('列出本地文档源计划和云端自动同步状态')
    .action(() =>
      runWithRuntime('定时同步计划', async (runtime) => {
        const sources = runtime.database.listSources()
        printTable(
          ['名称', '类型', '计划', '短 ID'],
          sources
            .filter((source) => source.schedule || source.cloud?.autoSync)
            .map((source) => [
              source.name,
              source.cloud ? '云端副本' : '本地文档源',
              source.cloud?.autoSync ? '每日检查' : source.schedule,
              source.id.slice(0, 8)
            ])
        )
        return '定时同步计划读取成功'
      })
    )

  schedule
    .command('set [source] [cron]')
    .description('设置本地文档源计划；cron 传 manual 可关闭')
    .action((reference: string | undefined, cron: string | undefined) =>
      runWithRuntime('设置定时同步', async (runtime) => {
        const source = await resolveSource(runtime, reference, { localOnly: true })
        const expression = cron ? scheduleValue(cron) : await askSchedule(source.schedule)
        const saved = runtime.updateSourceSchedule(source, expression)
        return expression
          ? `已将“${saved.name}”设置为 ${expression}`
          : `已关闭“${saved.name}”的定时同步`
      })
    )

  schedule
    .command('run')
    .description('以前台常驻方式执行本地计划与云端副本自动同步')
    .action(runScheduleHost)
}

async function runScheduleHost(): Promise<void> {
  startUi('Loci CLI 定时同步')
  const runtime = createCliRuntime()
  const jobs: Cron[] = []
  let hostLock: RuntimeLock | undefined
  let cloudTimer: ReturnType<typeof setInterval> | undefined
  const serverUrl = (): string => runtime.database.getSettings().serverUrl
  try {
    hostLock = acquireRuntimeLock(runtime.dataDir, 'schedule', 'CLI 计划运行器')
    for (const source of runtime.database
      .listSources()
      .filter((item) => !item.cloud && item.schedule)) {
      jobs.push(createSourceJob(runtime, source))
    }
    await runtime.cloud.syncEligible(serverUrl())
    cloudTimer = setInterval(() => void runtime.cloud.syncEligible(serverUrl()), DAY_MS)
    info(`已恢复 ${jobs.length} 个本地计划；云端自动同步每日检查一次`)
    info('按 Ctrl+C 停止计划运行器')
    await waitForTermination()
    finishUi('定时同步已停止')
  } finally {
    if (cloudTimer) clearInterval(cloudTimer)
    for (const job of jobs) job.stop()
    hostLock?.release()
    await runtime.close()
  }
}

function createSourceJob(
  runtime: ReturnType<typeof createCliRuntime>,
  source: DocumentSource
): Cron {
  return new Cron(
    normalizeCronSchedule(source.schedule)!,
    {
      protect: true,
      catch: (error) => warning(`定时同步“${source.name}”失败：${errorMessage(error)}`)
    },
    async () => {
      if (runtime.isCrawling(source.id)) return
      try {
        await runtime.crawlSource(source.id)
        info(`定时同步“${source.name}”完成`)
      } catch (error) {
        warning(`定时同步“${source.name}”失败：${errorMessage(error)}`)
      }
    }
  )
}

async function askSchedule(current: string | null): Promise<string | null> {
  const preset = current ? getSchedulePreset(current) : null
  const selected = await askSelect<string>(
    '自动更新计划',
    [
      { value: MANUAL, label: '关闭定时同步' },
      ...SCHEDULE_PRESETS.map((item) => ({
        value: item.expression,
        label: item.label,
        hint: item.description
      })),
      { value: CUSTOM, label: '自定义 Cron' }
    ],
    current ? (preset?.expression ?? CUSTOM) : MANUAL
  )
  if (selected === MANUAL) return null
  if (selected !== CUSTOM) return normalizeCronSchedule(selected)
  return scheduleValue(
    await askText('自定义 Cron（分 时 日 月 周）', { initialValue: current ?? '0 2 * * *' })
  )
}

function scheduleValue(value: string): string | null {
  if (value === MANUAL) return null
  try {
    return normalizeCronSchedule(value)
  } catch (error) {
    throw new CliError(errorMessage(error), 2)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}
