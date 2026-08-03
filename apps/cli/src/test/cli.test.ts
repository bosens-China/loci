import { describe, expect, it } from 'vitest'
import { CliError } from '../errors.js'
import { createProgram, runCli } from '../cli.js'

describe('Loci CLI command surface', () => {
  it('exposes the intended human-oriented command groups', () => {
    const program = createProgram()
    const commands = program.commands
      .map((command) => command.name())
      .filter((name) => name !== 'help')

    expect(commands).toEqual([
      'status',
      'source',
      'document',
      'cloud',
      'admin',
      'mcp',
      'browser',
      'config',
      'data',
      'doctor'
    ])
    expect(program.options.some((option) => option.long === '--json')).toBe(false)
    expect(
      program.commands
        .find((command) => command.name() === 'mcp')
        ?.commands.map((command) => command.name())
    ).toEqual(['stdio', 'serve', 'status', 'configure'])
  })

  it('translates Commander failures into clear Chinese errors', async () => {
    const error = await runCli(['not-a-command']).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(CliError)
    expect((error as CliError).message).toContain('未知命令“not-a-command”')
    expect((error as CliError).exitCode).toBe(1)
  })
})
