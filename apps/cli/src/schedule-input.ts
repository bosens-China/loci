import { normalizeCronSchedule } from '@loci/shared'

const DISABLED_SCHEDULES = new Set(['off', 'manual'])

/** `off` 是推荐写法，`manual` 仅为旧脚本保留。 */
export function parseScheduleInput(value: string): string | null {
  const trimmed = value.trim()
  return DISABLED_SCHEDULES.has(trimmed.toLowerCase()) ? null : normalizeCronSchedule(trimmed)
}
