import { mkdtempSync, rmSync } from 'node:fs'
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
const isTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
let dataDir = ''

beforeEach(() => {
  vi.clearAllMocks()
  dataDir = mkdtempSync(join(tmpdir(), 'loci-agent-interactive-'))
  process.env.LOCI_DATA_DIR = dataDir
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dataDir, { recursive: true, force: true })
  if (originalDataDir === undefined) delete process.env.LOCI_DATA_DIR
  else process.env.LOCI_DATA_DIR = originalDataDir
  if (isTtyDescriptor) Object.defineProperty(process.stdin, 'isTTY', isTtyDescriptor)
})

describe('loci agent 交互入口', () => {
  it('根命令询问 Agent、transport 和 Skill 作用域', async () => {
    vi.mocked(askSelect)
      .mockResolvedValueOnce('codex')
      .mockResolvedValueOnce('stdio')
      .mockResolvedValueOnce('project')
    vi.mocked(askConfirm).mockResolvedValue(false)

    await createProgram().parseAsync(['agent'], { from: 'user' })

    expect(askSelect).toHaveBeenCalledTimes(3)
    expect(vi.mocked(askSelect).mock.calls.map(([message]) => message)).toEqual([
      '请选择需要接入 Loci 的 Agent',
      '请选择 MCP 传输方式',
      '请选择 use-loci Skill 作用域'
    ])
  })

  it('子菜单缺参时继续交互补全', async () => {
    vi.mocked(askSelect).mockResolvedValueOnce('manual').mockResolvedValueOnce('stdio')

    await createProgram().parseAsync(['agent', 'config'], { from: 'user' })

    expect(vi.mocked(askSelect).mock.calls.map(([message]) => message)).toEqual([
      '请选择配置目标',
      '请选择 MCP 传输方式'
    ])
  })
})
