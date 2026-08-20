import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProgram } from '../../cli.js'

let directory = ''
const originalCwd = process.cwd()
const originalDataDir = process.env.LOCI_DATA_DIR
const originalHome = process.env.HOME

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'loci-cli-skills-'))
  process.env.LOCI_DATA_DIR = join(directory, 'data')
  process.env.HOME = join(directory, 'home')
  process.chdir(directory)
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
  process.chdir(originalCwd)
  if (originalDataDir === undefined) delete process.env.LOCI_DATA_DIR
  else process.env.LOCI_DATA_DIR = originalDataDir
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  rmSync(directory, { recursive: true, force: true })
})

describe('agent skills command', () => {
  it('默认在当前目录安装、列出并删除项目级 use-loci', async () => {
    const program = createProgram()
    const projectArgs = ['--agent', 'universal', '--project', directory]
    await program.parseAsync(['agent', 'skills', 'add', ...projectArgs, '--yes'], { from: 'user' })
    expect(existsSync(join(directory, '.agents/skills/use-loci/SKILL.md'))).toBe(true)

    vi.mocked(process.stdout.write).mockClear()
    await program.parseAsync(['agent', 'skills', 'list', ...projectArgs], { from: 'user' })
    const tableOutput = vi.mocked(process.stdout.write).mock.calls.flat().join('')
    expect(tableOutput).toContain('已是最新')
    expect(tableOutput).not.toContain('current')

    vi.mocked(process.stdout.write).mockClear()
    await program.parseAsync(['agent', 'skills', 'list', ...projectArgs, '--json'], {
      from: 'user'
    })
    const output = vi.mocked(process.stdout.write).mock.calls.flat().join('')
    expect(output).toContain('use-loci')
    expect(output).toContain(`"projectRoot": "${realpathSync(directory)}"`)

    await program.parseAsync(['agent', 'skills', 'remove', ...projectArgs, '--yes'], {
      from: 'user'
    })
    expect(vi.mocked(process.stdout.write).mock.calls.flat().join('')).toContain('已删除')
    expect(existsSync(join(directory, '.agents/skills/use-loci'))).toBe(false)
  })

  it('支持 --global 和 --project 选择明确作用域', async () => {
    const program = createProgram()
    const otherProject = join(directory, 'other-project')
    mkdirSync(otherProject)

    await program.parseAsync(
      ['agent', 'skills', 'add', '--agent', 'universal', '--global', '--yes'],
      { from: 'user' }
    )
    await program.parseAsync(
      ['agent', 'skills', 'add', '--agent', 'universal', '--project', otherProject, '--yes'],
      { from: 'user' }
    )
    expect(existsSync(join(directory, 'home/.agents/skills/use-loci/SKILL.md'))).toBe(true)
    expect(existsSync(join(otherProject, '.agents/skills/use-loci/SKILL.md'))).toBe(true)

    vi.mocked(process.stdout.write).mockClear()
    await program.parseAsync(
      ['agent', 'skills', 'list', '--agent', 'universal', '--global', '--json'],
      { from: 'user' }
    )
    const globalOutput = vi.mocked(process.stdout.write).mock.calls.flat().join('')
    expect(globalOutput).toContain('"scope": "global"')
    expect(globalOutput).toContain(join(directory, 'home/.agents/skills/use-loci'))
    expect(globalOutput).not.toContain(otherProject)

    vi.mocked(process.stdout.write).mockClear()
    await program.parseAsync(
      ['agent', 'skills', 'list', '--agent', 'universal', '--project', './other-project', '--json'],
      { from: 'user' }
    )
    const projectOutput = vi.mocked(process.stdout.write).mock.calls.flat().join('')
    expect(projectOutput).toContain(`"projectRoot": "${realpathSync(otherProject)}"`)
    expect(projectOutput).not.toContain('"scope": "global"')

    await program.parseAsync(
      ['agent', 'skills', 'clear', '--agent', 'universal', '--project', otherProject, '--yes'],
      { from: 'user' }
    )
    expect(existsSync(join(otherProject, '.agents/skills/use-loci'))).toBe(false)
    expect(existsSync(join(directory, 'home/.agents/skills/use-loci'))).toBe(true)

    await program.parseAsync(
      ['agent', 'skills', 'clear', '--agent', 'universal', '--global', '--yes'],
      { from: 'user' }
    )
    expect(existsSync(join(directory, 'home/.agents/skills/use-loci'))).toBe(false)
  })

  it('拒绝同时传入 --global 和 --project', async () => {
    await expect(
      createProgram().parseAsync(
        ['agent', 'skills', 'add', '--global', '--project', './', '--yes'],
        { from: 'user' }
      )
    ).rejects.toThrow("option '--project <path>' cannot be used with option '--global'")
  })

  it('非交互命令要求完整的 Agent、作用域和写入确认', async () => {
    const program = createProgram()
    await expect(program.parseAsync(['agent', 'skills', 'list'], { from: 'user' })).rejects.toThrow(
      '必须指定 --agent'
    )
    await expect(
      program.parseAsync(['agent', 'skills', 'list', '--agent', 'universal'], { from: 'user' })
    ).rejects.toThrow('必须指定 --project 或 --global')
    await expect(
      program.parseAsync(
        ['agent', 'skills', 'add', '--agent', 'universal', '--project', directory],
        { from: 'user' }
      )
    ).rejects.toThrow('必须传入 --yes')
  })
})
