import { describe, expect, it, vi } from 'vitest'
import { fetchLatestVersion, isNewerVersion } from '../update.js'

describe('CLI 更新检查', () => {
  it('只将严格更高的语义化版本视为更新', () => {
    expect(isNewerVersion('1.2.2', '1.2.1')).toBe(true)
    expect(isNewerVersion('1.3.0', '1.2.9')).toBe(true)
    expect(isNewerVersion('1.2.1', '1.2.1')).toBe(false)
    expect(isNewerVersion('1.2.0', '1.2.1')).toBe(false)
    expect(isNewerVersion('0.9.9', '1.0.0')).toBe(false)
  })

  it('读取 npm 的最新版本', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"version":"99.0.0"}'))

    await expect(fetchLatestVersion(fetcher)).resolves.toBe('99.0.0')
  })
})
