import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProgram } from '../../cli.js'

let directory = ''

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'loci-cli-skills-'))
  process.env.LOCI_DATA_DIR = join(directory, 'data')
  process.env.HOME = join(directory, 'home')
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.LOCI_DATA_DIR
  rmSync(directory, { recursive: true, force: true })
})

describe('skills command', () => {
  it('默认安装、列出并删除全局 use-loci', async () => {
    const program = createProgram()
    await program.parseAsync(['skills', 'add', '--yes'], { from: 'user' })
    await program.parseAsync(['skills', 'list', '--json'], { from: 'user' })
    const output = vi.mocked(process.stdout.write).mock.calls.flat().join('')
    expect(output).toContain('use-loci')
    expect(output).toContain('.agents/skills/use-loci')

    await program.parseAsync(['skills', 'remove', '--yes'], { from: 'user' })
    expect(vi.mocked(process.stdout.write).mock.calls.flat().join('')).toContain('已删除')
  })
})
