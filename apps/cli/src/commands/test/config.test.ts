import { describe, expect, it } from 'vitest'
import { formatBatchIntervalHint, parseBatchIntervalRange } from '../config.js'

describe('批次间隔配置', () => {
  it('支持固定值与 min-max 区间', () => {
    expect(parseBatchIntervalRange('120')).toEqual([120, 120])
    expect(parseBatchIntervalRange('100-300')).toEqual([100, 300])
    expect(formatBatchIntervalHint('100-300')).toContain('100 到 300')
  })

  it('拒绝倒置区间和不完整区间', () => {
    expect(() => parseBatchIntervalRange('300-100')).toThrow()
    expect(() => parseBatchIntervalRange('100-')).toThrow()
  })
})
