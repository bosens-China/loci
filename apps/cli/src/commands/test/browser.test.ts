import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProgram } from '../../cli.js'

const originalDataDir = process.env.LOCI_DATA_DIR
const originalCacheDir = process.env.LOCI_CACHE_DIR
const originalBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH
const originalExitCode = process.exitCode
let root = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'loci-cli-browser-'))
  process.env.LOCI_DATA_DIR = join(root, 'data')
  process.env.LOCI_CACHE_DIR = join(root, 'cache')
  process.exitCode = undefined
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
  if (originalDataDir === undefined) delete process.env.LOCI_DATA_DIR
  else process.env.LOCI_DATA_DIR = originalDataDir
  if (originalCacheDir === undefined) delete process.env.LOCI_CACHE_DIR
  else process.env.LOCI_CACHE_DIR = originalCacheDir
  if (originalBrowsersPath === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH
  else process.env.PLAYWRIGHT_BROWSERS_PATH = originalBrowsersPath
  process.exitCode = originalExitCode
  rmSync(root, { recursive: true, force: true })
})

describe('browser CLI', () => {
  it('status 从共享 Runtime 输出真实安装路径和版本', async () => {
    await createProgram().parseAsync(['browser', 'status'], { from: 'user' })

    const output = vi.mocked(process.stdout.write).mock.calls.flat().join('')
    expect(output).toContain('安装状态：未安装')
    expect(output).toContain('Playwright：')
    expect(output).toContain(join(root, 'cache', 'playwright'))
    expect(process.exitCode).toBe(3)
  })
})
