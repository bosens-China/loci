import { describe, expect, it } from 'vitest'
import { getUpcomingScheduleRuns, normalizeCronSchedule } from '../schedule.js'

describe('normalizeCronSchedule', () => {
  it('normalizes five-field Linux Cron schedules', () => {
    expect(normalizeCronSchedule('  */15   * * * *  ')).toBe('*/15 * * * *')
  })

  it('rejects schedules with a seconds field', () => {
    expect(() => normalizeCronSchedule('* * * * * *')).toThrow('5 段 Linux Cron')
  })

  it('rejects invalid schedules', () => {
    expect(() => normalizeCronSchedule('70 * * * *')).toThrow('Cron 表达式无效')
  })
})

describe('getUpcomingScheduleRuns', () => {
  it('返回指定时间之后的多次执行时间', () => {
    expect(
      getUpcomingScheduleRuns('*/15 * * * *', 2, new Date('2026-08-05T00:01:00.000Z')).map((date) =>
        date.toISOString()
      )
    ).toEqual(['2026-08-05T00:15:00.000Z', '2026-08-05T00:30:00.000Z'])
  })

  it('计划关闭时不返回执行时间', () => {
    expect(getUpcomingScheduleRuns(null)).toEqual([])
  })
})
