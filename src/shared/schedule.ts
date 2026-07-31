import { Cron } from 'croner'

export const CUSTOM_SCHEDULE = 'custom'
export const DEFAULT_SCHEDULE = '0 * * * *'

export const SCHEDULE_PRESETS = [
  { expression: '0 * * * *', label: '每小时', description: '每个整点抓取一次' },
  { expression: '*/15 * * * *', label: '每 15 分钟', description: '适合更新频繁的文档站' },
  { expression: '0 2 * * *', label: '每天凌晨 2:00', description: '避开常用工作时间' },
  { expression: '0 9 * * 1-5', label: '工作日 09:00', description: '周一至周五早上更新' }
] as const

export function normalizeCronSchedule(value: string | null | undefined): string | null {
  const expression = value?.trim().replace(/\s+/gu, ' ') ?? ''
  if (!expression) return null
  if (expression.split(' ').length !== 5) {
    throw new Error('请输入 5 段 Linux Cron：分 时 日 月 周')
  }
  try {
    const job = new Cron(expression, { paused: true })
    if (!job.nextRun()) throw new Error('没有下一次执行时间')
  } catch {
    throw new Error('Cron 表达式无效，请检查分、时、日、月、周的取值')
  }
  return expression
}

export function getNextScheduledRun(value: string | null | undefined): Date | null {
  try {
    const expression = normalizeCronSchedule(value)
    return expression ? new Cron(expression, { paused: true }).nextRun() : null
  } catch {
    return null
  }
}

export function getSchedulePreset(expression: string): (typeof SCHEDULE_PRESETS)[number] | null {
  return SCHEDULE_PRESETS.find((preset) => preset.expression === expression) ?? null
}
