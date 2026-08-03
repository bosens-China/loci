import { describe, expect, it } from 'vitest'
import { formatBytes } from '../format-bytes.js'

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1024 ** 2, '1.0 MB'],
    [1024 ** 3, '1.0 GB'],
    [2.5 * 1024 ** 3, '2.5 GB'],
    [1024 ** 4, '1.0 TB']
  ])('将 %d 字节显示为 %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })

  it('对无效大小显示占位符', () => {
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
  })
})
