import { describe, expect, it } from 'vitest'
import { formatBytes, formatDate, formatDateTime, formatDuration, parseDate } from '@/utils/format'

describe('format.ts', () => {
  it('parseDate 解析有效日期字符串并拒绝无效值', () => {
    expect(parseDate(null)).toBeNull()
    expect(parseDate('')).toBeNull()
    expect(parseDate('invalid-date')).toBeNull()

    const iso = parseDate('2026-08-25T09:09:00.000Z')
    expect(iso).toBeInstanceOf(Date)
    expect(Number.isNaN(iso?.getTime())).toBe(false)
  })

  it('formatDate 和 formatDateTime 面对非法或空值不抛异常并返回占位符', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate('invalid')).toBe('—')
    expect(formatDateTime(undefined)).toBe('—')
    expect(formatDateTime('invalid-time-value')).toBe('—')
    expect(formatDateTime('2026-08-25T09:09:00.000Z')).not.toBe('—')
  })

  it('formatBytes 和 formatDuration 正常格式化', () => {
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(3500)).toBe('4 秒')
    expect(formatDuration(65000)).toBe('1 分 5 秒')
  })
})
