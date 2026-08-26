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
    await program.parseAsync(['agent', 'skills', 'list', ...projectArgs, '--json'], {
      from: 'user'
    })
    const output = readJsonListOutput()
    expect(output).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'use-loci',
          scope: 'project',
          projectRoot: realpathSync(directory)
        })
      ])
    )

    await program.parseAsync(['agent', 'skills', 'remove', ...projectArgs, '--yes'], {
      from: 'user'
    })
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
    const globalOutput = readJsonListOutput()
    expect(globalOutput).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: 'global',
          projectRoot: null,
          targetPath: join(directory, 'home/.agents/skills/use-loci')
        })
      ])
    )

    vi.mocked(process.stdout.write).mockClear()
    await program.parseAsync(
      ['agent', 'skills', 'list', '--agent', 'universal', '--project', './other-project', '--json'],
      { from: 'user' }
    )
    const projectOutput = readJsonListOutput()
    expect(projectOutput).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: 'project',
          projectRoot: realpathSync(otherProject)
        })
      ])
    )

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
    ).rejects.toThrow()
  })

  it('非交互命令要求完整的 Agent、作用域和写入确认', async () => {
    const program = createProgram()
    await expect(
      program.parseAsync(['agent', 'skills', 'list'], { from: 'user' })
    ).rejects.toThrow()
    await expect(
      program.parseAsync(['agent', 'skills', 'list', '--agent', 'universal'], { from: 'user' })
    ).rejects.toThrow()
    await expect(
      program.parseAsync(
        ['agent', 'skills', 'add', '--agent', 'universal', '--project', directory],
        { from: 'user' }
      )
    ).rejects.toThrow()
  })
})

function readJsonListOutput(): unknown {
  const output = vi
    .mocked(process.stdout.write)
    .mock.calls.map(([chunk]) => String(chunk))
    .find((chunk) => chunk.trimStart().startsWith('['))
  expect(output).toBeDefined()
  return JSON.parse(output ?? '') as unknown
}
