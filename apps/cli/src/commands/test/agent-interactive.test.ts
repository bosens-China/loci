import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ui.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ui.js')>()),
  askConfirm: vi.fn(),
  askSelect: vi.fn(),
  note: vi.fn()
}))

import { createProgram } from '../../cli.js'
import { askConfirm, askSelect } from '../../ui.js'

const originalDataDir = process.env.LOCI_DATA_DIR
const originalHome = process.env.HOME
const isTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
let dataDir = ''
let homeDir = ''

beforeEach(() => {
  vi.clearAllMocks()
  dataDir = mkdtempSync(join(tmpdir(), 'loci-agent-interactive-'))
  homeDir = join(dataDir, 'home')
  process.env.LOCI_DATA_DIR = dataDir
  process.env.HOME = homeDir
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dataDir, { recursive: true, force: true })
  if (originalDataDir === undefined) delete process.env.LOCI_DATA_DIR
  else process.env.LOCI_DATA_DIR = originalDataDir
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (isTtyDescriptor) Object.defineProperty(process.stdin, 'isTTY', isTtyDescriptor)
})

describe('loci agent 交互入口', () => {
  it('根命令进入全局一键接入向导', async () => {
    vi.mocked(askSelect).mockResolvedValueOnce('codex')
    vi.mocked(askConfirm).mockResolvedValue(false)

    await createProgram().parseAsync(['agent'], { from: 'user' })

    expect(askSelect).toHaveBeenCalledTimes(1)
    expect(vi.mocked(askSelect).mock.calls.map(([message]) => message)).toEqual([
      '请选择需要管理的 Agent'
    ])
    expect(existsSync(join(homeDir, '.codex'))).toBe(false)
  })

  it('子菜单缺参时继续交互补全', async () => {
    vi.mocked(askSelect).mockResolvedValueOnce('manual')

    await createProgram().parseAsync(['agent', 'print-config'], { from: 'user' })

    expect(vi.mocked(askSelect).mock.calls.map(([message]) => message)).toEqual(['请选择配置目标'])
  })
})
