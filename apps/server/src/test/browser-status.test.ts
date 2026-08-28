import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkServerBrowserStatus } from '../browser-status.js'

const { connect, launch, close } = vi.hoisted(() => ({
  connect: vi.fn(),
  launch: vi.fn(),
  close: vi.fn()
}))

vi.mock('playwright-core', () => ({ chromium: { connect, launch } }))

beforeEach(() => {
  connect.mockReset()
  launch.mockReset()
  close.mockReset().mockResolvedValue(undefined)
})

describe('Server 浏览器状态', () => {
  it('未配置提供方时不尝试启动浏览器', async () => {
    await expect(checkServerBrowserStatus(undefined)).resolves.toMatchObject({
      provider: 'disabled',
      available: false,
      error: null
    })
    expect(launch).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })

  it('本地 Chromium 可启动时返回实际版本', async () => {
    launch.mockResolvedValue({ version: () => '133.0', close })
    await expect(checkServerBrowserStatus({ provider: 'local' })).resolves.toMatchObject({
      provider: 'local',
      available: true,
      chromiumVersion: '133.0'
    })
    expect(close).toHaveBeenCalledOnce()
  })

  it('Browserless 状态不会返回凭据或查询参数', async () => {
    connect.mockResolvedValue({ version: () => '133.0', close })
    const status = await checkServerBrowserStatus({
      provider: 'browserless',
      endpoint: 'wss://user:password@browser.example/playwright?token=secret'
    })
    expect(status).toMatchObject({
      provider: 'browserless',
      available: true,
      endpoint: 'wss://browser.example/playwright'
    })
    expect(JSON.stringify(status)).not.toContain('secret')
    expect(JSON.stringify(status)).not.toContain('password')
  })

  it('连接失败时只返回稳定的安全错误', async () => {
    connect.mockRejectedValue(new Error('wss://browser.example?token=secret'))
    await expect(
      checkServerBrowserStatus({
        provider: 'browserless',
        endpoint: 'wss://browser.example/playwright?token=secret'
      })
    ).resolves.toMatchObject({
      available: false,
      error: '无法连接 Browserless 浏览器服务'
    })
  })
})
