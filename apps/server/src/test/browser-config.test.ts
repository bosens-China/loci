import { describe, expect, it } from 'vitest'
import { readBrowserConfig } from '../browser-config.js'

describe('readBrowserConfig', () => {
  it('未配置时禁用远程浏览器', () => {
    expect(readBrowserConfig({})).toBeUndefined()
  })

  it('读取 Docker 内置的本地 headless shell', () => {
    expect(readBrowserConfig({ LOCI_BROWSER_PROVIDER: 'local' })).toEqual({ provider: 'local' })
  })

  it('兼容原 Browserless 配置并附加令牌', () => {
    expect(
      readBrowserConfig({
        LOCI_BROWSER_TOKEN: 'secret',
        LOCI_BROWSER_URL: 'wss://browser.example/chromium/playwright'
      })
    ).toEqual({
      provider: 'browserless',
      endpoint: 'wss://browser.example/chromium/playwright?token=secret'
    })
  })

  it('拒绝缺少令牌和未知提供方', () => {
    expect(() =>
      readBrowserConfig({
        LOCI_BROWSER_PROVIDER: 'browserless',
        LOCI_BROWSER_URL: 'ws://browser:9222'
      })
    ).toThrow('必须设置 LOCI_BROWSER_TOKEN')
    expect(() =>
      readBrowserConfig({
        LOCI_BROWSER_PROVIDER: 'unknown',
        LOCI_BROWSER_URL: 'ws://browser:9222'
      })
    ).toThrow('只支持 local 或 browserless')
  })
})
