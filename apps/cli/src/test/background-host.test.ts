import { describe, expect, it, vi } from 'vitest'
import {
  applyPersistentBackgroundSetting,
  ensurePersistentBackgroundService
} from '../background-host.js'

describe('持久后台宿主', () => {
  it('启动失败时给出启动和日志命令', async () => {
    await expect(
      ensurePersistentBackgroundService(async () => {
        throw new Error('系统服务不可用')
      })
    ).rejects.toThrow('loci service start')
    await expect(
      ensurePersistentBackgroundService(async () => {
        throw new Error('系统服务不可用')
      })
    ).rejects.toThrow('loci service logs')
  })

  it('开启时先确保服务，关闭时只保存设置', async () => {
    const events: string[] = []
    const ensureService = vi.fn(async () => {
      events.push('ensure')
    })
    const action = vi.fn(() => {
      events.push('save')
      return 'saved'
    })

    await expect(applyPersistentBackgroundSetting(true, action, ensureService)).resolves.toBe(
      'saved'
    )
    expect(events).toEqual(['ensure', 'save'])

    events.length = 0
    await applyPersistentBackgroundSetting(false, action, ensureService)
    expect(events).toEqual(['save'])
    expect(ensureService).toHaveBeenCalledOnce()
  })
})
