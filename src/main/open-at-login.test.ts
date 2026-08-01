import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  isPackaged: true as boolean,
  getLoginItemSettings: vi.fn(),
  setLoginItemSettings: vi.fn()
}))

vi.mock('electron', () => ({ app: electron }))

import { getOpenAtLogin, setOpenAtLogin, shouldStartHidden } from './open-at-login'

let platform: NodeJS.Platform

describe('开机自启', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    electron.isPackaged = true
    platform = 'win32'
    vi.spyOn(process, 'platform', 'get').mockImplementation(() => platform)
  })

  afterEach(() => vi.unstubAllEnvs())

  it('读取并更新系统登录项', () => {
    electron.getLoginItemSettings
      .mockReturnValueOnce({ executableWillLaunchAtLogin: true })
      .mockReturnValueOnce({ executableWillLaunchAtLogin: false })

    expect(getOpenAtLogin()).toEqual({ supported: true, enabled: true })
    expect(setOpenAtLogin(false)).toEqual({ supported: true, enabled: false })
    expect(electron.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: false,
      args: ['--hidden']
    })
  })

  it('开发模式不修改系统登录项', () => {
    electron.isPackaged = false

    expect(setOpenAtLogin(true)).toEqual({ supported: false, enabled: false })
    expect(electron.setLoginItemSettings).not.toHaveBeenCalled()
  })

  it('在 Linux 写入并删除 XDG 自启动项', () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-autostart-'))
    platform = 'linux'
    vi.stubEnv('XDG_CONFIG_HOME', directory)
    vi.stubEnv('APPIMAGE', '/opt/Loci AppImage')
    try {
      expect(setOpenAtLogin(true)).toEqual({ supported: true, enabled: true })
      const filename = join(directory, 'autostart', 'loci.desktop')
      expect(readFileSync(filename, 'utf8')).toContain('Exec="/opt/Loci AppImage" --hidden')
      expect(setOpenAtLogin(false)).toEqual({ supported: true, enabled: false })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('识别静默启动参数', () => {
    const argv = process.argv
    process.argv = [...argv, '--hidden']
    try {
      expect(shouldStartHidden()).toBe(true)
    } finally {
      process.argv = argv
    }
  })
})
