import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProgram } from '../../cli.js'

const originalDataDir = process.env.LOCI_DATA_DIR
const originalHome = process.env.HOME
let root = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'loci-cli-agent-integration-'))
  process.env.LOCI_DATA_DIR = join(root, 'data')
  process.env.HOME = join(root, 'home')
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
  if (originalDataDir === undefined) delete process.env.LOCI_DATA_DIR
  else process.env.LOCI_DATA_DIR = originalDataDir
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  rmSync(root, { recursive: true, force: true })
})

describe('agent 全局接入命令', () => {
  it('setup、status 和 remove 复用同一份全局状态', async () => {
    const program = createProgram()
    await program.parseAsync(['agent', 'setup', 'antigravity', '--yes'], { from: 'user' })
    expect(existsSync(join(root, 'home/.gemini/config/skills/use-loci/SKILL.md'))).toBe(true)
    expect(existsSync(join(root, 'home/.gemini/GEMINI.md'))).toBe(true)

    vi.mocked(process.stdout.write).mockClear()
    await program.parseAsync(['agent', 'status', 'antigravity', '--json'], { from: 'user' })
    expect(vi.mocked(process.stdout.write).mock.calls.flat().join('')).toContain(
      '"overall": "ready"'
    )

    await program.parseAsync(['agent', 'remove', 'antigravity', '--yes'], { from: 'user' })
    expect(existsSync(join(root, 'home/.gemini/config/skills/use-loci'))).toBe(false)
  })

  it('非交互写入必须显式确认', async () => {
    await expect(
      createProgram().parseAsync(['agent', 'setup', 'antigravity'], { from: 'user' })
    ).rejects.toThrow('必须传入 --yes')
  })
})
