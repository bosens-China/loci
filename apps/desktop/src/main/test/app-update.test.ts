import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppUpdater as ElectronAutoUpdater } from 'electron-updater'
import { describe, expect, it, vi } from 'vitest'
import { createAppUpdater, findLatestDesktopVersion, isNewerVersion } from '../app-update'

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

  it('并发检查只启动一次自动更新', async () => {
    let finishCheck: (() => void) | undefined
    const listeners = new Map<string, (value: unknown) => void>()
    const checkForUpdatesAndNotify = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          finishCheck = () => resolve(null)
        })
    )
    const automaticUpdater = {
      on: vi.fn((event: string, listener: (value: unknown) => void) => {
        listeners.set(event, listener)
      }),
      setFeedURL: vi.fn(),
      checkForUpdatesAndNotify
    } as unknown as ElectronAutoUpdater
    const updater = createAppUpdater({
      platform: 'win32',
      currentVersion: '1.0.0',
      cachePath: join(mkdtempSync(join(tmpdir(), 'loci-update-')), 'cache.json'),
      fetcher: vi.fn(
        async () => new Response(JSON.stringify([{ tag_name: 'loci-v1.1.0' }]), { status: 200 })
      ),
      loadAutoUpdater: async () => automaticUpdater
    })

    const first = updater.check()
    const second = updater.check()
    await vi.waitFor(() => expect(checkForUpdatesAndNotify).toHaveBeenCalledOnce())
    listeners.get('update-available')?.({ version: '1.1.0' })
    finishCheck?.()
    await Promise.all([first, second])

    await updater.check()

    expect(automaticUpdater.setFeedURL).toHaveBeenCalledOnce()
    expect(checkForUpdatesAndNotify).toHaveBeenCalledOnce()
  })

  it('macOS 不加载自动更新器', async () => {
    const loadAutoUpdater = vi.fn()
    const updater = createAppUpdater({
      platform: 'darwin',
      currentVersion: '1.0.0',
      cachePath: join(mkdtempSync(join(tmpdir(), 'loci-update-')), 'cache.json'),
      fetcher: vi.fn(
        async () => new Response(JSON.stringify([{ tag_name: 'loci-v1.1.0' }]), { status: 200 })
      ),
      loadAutoUpdater
    })

    const state = await updater.check()

    expect(state.autoUpdateSupported).toBe(false)
    expect(state.updateAvailable).toBe(true)
    expect(loadAutoUpdater).not.toHaveBeenCalled()
  })
})
