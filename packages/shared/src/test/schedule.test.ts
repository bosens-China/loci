import { describe, expect, it } from 'vitest'
import { getNextScheduledRun, normalizeCronSchedule } from '../schedule.js'

describe('normalizeCronSchedule', () => {
  it('normalizes five-field Linux Cron schedules and exposes the next run', () => {
    expect(normalizeCronSchedule('  */15   * * * *  ')).toBe('*/15 * * * *')
    expect(getNextScheduledRun('*/15 * * * *')).toBeInstanceOf(Date)
  })

  it('rejects schedules with a seconds field', () => {
    expect(() => normalizeCronSchedule('* * * * * *')).toThrow('5 段 Linux Cron')
  })

  it('rejects invalid schedules', () => {
    expect(() => normalizeCronSchedule('70 * * * *')).toThrow('Cron 表达式无效')
  })
})
