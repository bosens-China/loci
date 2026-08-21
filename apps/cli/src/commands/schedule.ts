import type { Command } from 'commander'
import { SCHEDULE_PRESETS, getSchedulePreset, normalizeCronSchedule } from '@loci/shared'
import { applyPersistentBackgroundSetting } from '../background-host.js'
import { runWithRuntime } from '../command-runtime.js'
import { CliError } from '../errors.js'
import { resolveSource } from '../resources.js'
import { parseScheduleInput } from '../schedule-input.js'
import { askSelect, askText, printTable } from '../ui.js'
const MANUAL = 'manual'
const CUSTOM = 'custom'

export function registerScheduleCommands(
  program: Command,
  ensureService?: () => Promise<unknown>
): void {
  const schedule = program.command('schedule').description('管理本地定时同步计划')

  schedule
    .command('list')
    .description('列出本地文档源计划和云端自动同步状态')
    .action(() =>
      runWithRuntime('定时同步计划', async (runtime) => {
        const sources = runtime.database.listSources()
        const scheduled = sources.filter((source) => source.schedule || source.cloud?.autoSync)
        if (scheduled.length === 0) {
          process.stdout.write(
            sources.some((source) => source.cloud === null)
              ? '还没有文档源配置定时同步，可运行 loci schedule set <source> <cron> 设置。\n'
              : '还没有本地文档源，请先运行 loci source add。\n'
          )
        } else {
          printTable(
            ['名称', '类型', '计划', '短 ID'],
            scheduled.map((source) => [
              source.name,
              source.cloud ? '云端副本' : '本地文档源',
              source.cloud?.autoSync ? '每日检查' : source.schedule,
              source.id.slice(0, 8)
            ])
          )
        }
        return '定时同步计划读取成功'
      })
    )

  schedule
    .command('set [source] [cron]')
    .description('设置本地文档源计划；开启时自动准备后台服务，cron 传 off 可关闭')
    .action((reference: string | undefined, cron: string | undefined) =>
      runWithRuntime('设置定时同步', async (runtime) => {
        const source = await resolveSource(runtime, reference, { localOnly: true })
        const expression = cron ? scheduleValue(cron) : await askSchedule(source.schedule)
        const saved = await applyPersistentBackgroundSetting(
          Boolean(expression),
          () => runtime.updateSourceSchedule(source, expression),
          ensureService
        )
        return expression
          ? `已将“${saved.name}”设置为 ${expression}，后台服务已就绪`
          : `已关闭“${saved.name}”的定时同步`
      })
    )

  schedule
    .command('run', { hidden: true })
    .description('兼容入口：提示使用统一后台服务')
    .action(() => {
      process.stdout.write('请运行 loci service run 以前台方式启动统一后台服务。\n')
    })
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
  try {
    return parseScheduleInput(value)
  } catch (error) {
    throw new CliError(errorMessage(error), 2)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}
