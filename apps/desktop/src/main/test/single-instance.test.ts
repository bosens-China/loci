import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  requestSingleInstanceLock: vi.fn(),
  quit: vi.fn(),
  on: vi.fn()
}))

vi.mock('electron', () => ({ app: electron }))

import { registerSingleInstance } from '../single-instance'

describe('Electron 单实例', () => {
  beforeEach(() => vi.clearAllMocks())

  it('退出未取得锁的第二个实例', () => {
    electron.requestSingleInstanceLock.mockReturnValue(false)

    expect(registerSingleInstance(() => undefined)).toBe(false)
    expect(electron.quit).toHaveBeenCalledOnce()
  })

  it('再次启动时唤醒已有窗口', () => {
    const window = {
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn()
    }
    electron.requestSingleInstanceLock.mockReturnValue(true)
    electron.on.mockImplementation((_event, listener) => listener())

    expect(registerSingleInstance(() => window)).toBe(true)
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })
})
