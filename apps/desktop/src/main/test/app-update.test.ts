import { describe, expect, it } from 'vitest'
import { findLatestDesktopVersion, isNewerVersion } from '../app-update'

describe('桌面端更新检查', () => {
  it('忽略 CLI、草稿和预发布标签', () => {
    expect(
      findLatestDesktopVersion([
        { tag_name: 'cli-v1.3.0' },
        { tag_name: 'loci-v1.4.0', draft: true },
        { tag_name: 'loci-v1.3.0', prerelease: true },
        { tag_name: 'loci-v1.2.2' }
      ])
    ).toBe('1.2.2')
  })

  it('只将严格更高的版本视为更新', () => {
    expect(isNewerVersion('1.3.0', '1.2.9')).toBe(true)
    expect(isNewerVersion('1.2.1', '1.2.1')).toBe(false)
    expect(isNewerVersion('0.9.9', '1.0.0')).toBe(false)
  })
})
