import { describe, expect, it } from 'vitest'
import { parseScheduleInput } from '../schedule-input.js'

describe('计划命令输入', () => {
  it('推荐使用 off 关闭计划并兼容旧 manual', () => {
    expect(parseScheduleInput('off')).toBeNull()
    expect(parseScheduleInput(' OFF ')).toBeNull()
    expect(parseScheduleInput('manual')).toBeNull()
  })

  it('规范化有效的五段 Cron', () => {
    expect(parseScheduleInput(' 0 2 * * * ')).toBe('0 2 * * *')
  })
})
