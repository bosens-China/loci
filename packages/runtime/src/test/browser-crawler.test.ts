import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { browserStatus, ensureBrowserInstalled, LocalBrowserCrawler } from '../browser-crawler.js'

const { closeBrowser, launchBrowser } = vi.hoisted(() => ({
  closeBrowser: vi.fn(),
  launchBrowser: vi.fn()
}))

vi.mock('playwright-core', () => ({ chromium: { launch: launchBrowser } }))

describe('browserStatus', () => {
  let directory: string

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'loci-browser-'))
  })

  beforeEach(() => {
    rmSync(directory, { recursive: true, force: true })
    mkdirSync(directory, { recursive: true })
    closeBrowser.mockReset().mockResolvedValue(undefined)
    launchBrowser.mockReset().mockResolvedValue({ close: closeBrowser })
  })

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('未安装时返回 headless shell 的缺失状态且不尝试启动', async () => {
    const status = await browserStatus(directory)
    expect(status).toMatchObject({ installed: false, launchable: false, error: null })
    expect(status.executable).toContain(directory)
    expect(status.executable).toContain('chromium_headless_shell-')
    expect(status.executable).not.toMatch(/[\\/]chromium-\d+/)
    expect(launchBrowser).not.toHaveBeenCalled()
  })

  it('缺失时要求非交互调用方先手动安装', async () => {
    await expect(ensureBrowserInstalled(directory)).rejects.toThrow('loci browser install')
  })

  it('缺失时通过交互回调执行安装并重新检查文件', async () => {
    const { executable } = await browserStatus(directory)
    let prompted = false
    await ensureBrowserInstalled(
      directory,
      async (install) => {
        prompted = true
        await install()
      },
      async () => {
        createExecutable(executable)
      }
    )
    expect(prompted).toBe(true)
  })

  it('只安装 headless shell 时使用同一可执行文件检查启动', async () => {
    const missing = await browserStatus(directory)
    createExecutable(missing.executable)

    const status = await browserStatus(directory)

    expect(status).toEqual({
      installed: true,
      executable: missing.executable,
      launchable: true,
      error: null
    })
    expect(launchBrowser).toHaveBeenCalledWith({
      headless: true,
      executablePath: missing.executable
    })
    expect(closeBrowser).toHaveBeenCalledOnce()
  })
})

describe('LocalBrowserCrawler', () => {
  beforeEach(() => {
    closeBrowser.mockReset().mockResolvedValue(undefined)
    launchBrowser.mockReset()
  })

  it('并发首次使用时只启动一个浏览器实例', async () => {
    const browser = { close: closeBrowser }
    let finishLaunch: ((value: unknown) => void) | undefined
    launchBrowser.mockReturnValueOnce(
      new Promise((resolve) => {
        finishLaunch = resolve
      })
    )
    const crawler = new LocalBrowserCrawler('/tmp/loci-browser-single-flight')

    const first = openBrowser(crawler)
    const second = openBrowser(crawler)
    await vi.waitFor(() => expect(launchBrowser).toHaveBeenCalledOnce())
    finishLaunch?.(browser)

    await expect(Promise.all([first, second])).resolves.toEqual([browser, browser])
    expect(launchBrowser).toHaveBeenCalledOnce()
    await crawler.close()
    expect(closeBrowser).toHaveBeenCalledOnce()
  })

  it('首次启动失败后允许下一次调用重新启动', async () => {
    const browser = { close: closeBrowser }
    launchBrowser.mockRejectedValueOnce(new Error('launch failed')).mockResolvedValueOnce(browser)
    const crawler = new LocalBrowserCrawler('/tmp/loci-browser-retry')

    await expect(openBrowser(crawler)).rejects.toThrow('launch failed')
    await expect(openBrowser(crawler)).resolves.toBe(browser)
    expect(launchBrowser).toHaveBeenCalledTimes(2)
    await crawler.close()
    expect(closeBrowser).toHaveBeenCalledOnce()
  })

  it('启动过程中关闭时会关闭刚创建的实例', async () => {
    const browser = { close: closeBrowser }
    let finishLaunch: ((value: unknown) => void) | undefined
    launchBrowser.mockReturnValueOnce(
      new Promise((resolve) => {
        finishLaunch = resolve
      })
    )
    const crawler = new LocalBrowserCrawler('/tmp/loci-browser-close-launch')

    const opening = openBrowser(crawler)
    await vi.waitFor(() => expect(launchBrowser).toHaveBeenCalledOnce())
    const closing = crawler.close()
    finishLaunch?.(browser)

    await expect(opening).rejects.toThrow()
    await closing
    expect(closeBrowser).toHaveBeenCalledOnce()
  })
})

function createExecutable(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '')
  chmodSync(path, 0o755)
}

function openBrowser(crawler: LocalBrowserCrawler): Promise<unknown> {
  return (crawler as unknown as { getBrowser: () => Promise<unknown> }).getBrowser()
}
