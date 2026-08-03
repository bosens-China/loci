import { describe, expect, it } from 'vitest'
import { isDevToolsShortcut } from '../window-shortcuts'

const input = {
  type: 'keyDown' as const,
  key: 'I',
  control: false,
  shift: false,
  meta: false,
  alt: false
}

describe('isDevToolsShortcut', () => {
  it('supports the platform convention without matching plain typing', () => {
    expect(isDevToolsShortcut({ ...input, control: true, shift: true }, 'win32')).toBe(true)
    expect(isDevToolsShortcut({ ...input, meta: true, alt: true }, 'darwin')).toBe(true)
    expect(isDevToolsShortcut(input, 'win32')).toBe(false)
  })
})
