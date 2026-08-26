import { describe, expect, it, vi } from 'vitest'
import { fetchLatestVersion } from '../update.js'

describe('CLI 更新检查', () => {
  it('读取 npm 的最新版本', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"version":"99.0.0"}'))

    await expect(fetchLatestVersion(fetcher)).resolves.toBe('99.0.0')
  })
})
