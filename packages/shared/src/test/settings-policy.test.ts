import { describe, expect, it } from 'vitest'
import { APP_SETTINGS_LIMITS, isValidBatchIntervalSeconds } from '../settings-policy.js'

describe('APP_SETTINGS_LIMITS', () => {
  it('允许关闭批次等待或使用有效区间', () => {
    expect(isValidBatchIntervalSeconds(APP_SETTINGS_LIMITS.batchIntervalSeconds.disabled)).toBe(
      true
    )
    expect(isValidBatchIntervalSeconds(APP_SETTINGS_LIMITS.batchIntervalSeconds.min)).toBe(true)
    expect(isValidBatchIntervalSeconds(APP_SETTINGS_LIMITS.batchIntervalSeconds.max)).toBe(true)
    expect(isValidBatchIntervalSeconds(1)).toBe(false)
    expect(isValidBatchIntervalSeconds(3001)).toBe(false)
    expect(isValidBatchIntervalSeconds(100.5)).toBe(false)
  })
})
