import { describe, expect, it } from 'vitest'
import { resolveTheme } from './settings-theme'

describe('resolveTheme', () => {
  it('follows the system only in auto mode', () => {
    expect(resolveTheme('auto', true)).toBe('dark')
    expect(resolveTheme('auto', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
  })
})
