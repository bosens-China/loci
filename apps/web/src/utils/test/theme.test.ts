import { describe, expect, it } from 'vitest'
import { resolveThemeMode } from '@/utils/theme'

describe('resolveThemeMode', () => {
  it('自动模式跟随系统偏好，显式模式始终优先', () => {
    expect(resolveThemeMode('auto', false)).toBe('light')
    expect(resolveThemeMode('auto', true)).toBe('dark')
    expect(resolveThemeMode('light', true)).toBe('light')
    expect(resolveThemeMode('dark', false)).toBe('dark')
  })
})
