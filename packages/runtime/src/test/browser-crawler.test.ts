import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  browserStatus,
  ensureBrowserInstalled,
  parseBrowserCommandProgress
} from '../browser-crawler.js'

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
    launchBrowser.mockReset().mockResolvedValue({ close: closeBrowser, version: () => '133.0' })
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

    expect(status).toMatchObject({
      installed: true,
      executable: missing.executable,
      launchable: true,
      chromiumVersion: '133.0',
      error: null
    })
    expect(launchBrowser).toHaveBeenCalledWith({
      headless: true,
      executablePath: missing.executable
    })
    expect(closeBrowser).toHaveBeenCalledOnce()
  })
})

describe('parseBrowserCommandProgress', () => {
  it('从 Playwright 非 TTY 输出中读取下载百分比', () => {
    expect(parseBrowserCommandProgress('|■■■■      |  45% of 184.6 MiB')).toEqual({
      progress: 45,
      message: '正在下载 Chromium headless shell（184.6 MiB）'
    })
  })
})

function createExecutable(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '')
  chmodSync(path, 0o755)
}
