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
      'update',
      'source',
      'schedule',
      'document',
      'cloud',
      'admin',
      'mcp',
      'browser',
      'config',
      'data',
      'skills',
      'doctor'
    ])
    expect(program.options.some((option) => option.long === '--json')).toBe(false)
    expect(
      program.commands
        .find((command) => command.name() === 'skills')
        ?.commands.map((command) => command.name())
    ).toEqual(['add', 'list', 'remove', 'clear'])
    expect(
      program.commands
        .find((command) => command.name() === 'source')
        ?.commands.map((command) => command.name())
    ).toEqual(['list', 'add', 'update', 'delete', 'sync', 'runs', 'logs'])
    expect(
      program.commands
        .find((command) => command.name() === 'mcp')
        ?.commands.map((command) => command.name())
    ).toEqual(['stdio', 'serve', 'status', 'config', 'configure', 'rules'])
    expect(
      program.commands
        .find((command) => command.name() === 'data')
        ?.commands.map((command) => command.name())
    ).toEqual(['export', 'import', 'clear-documents', 'clear-sources'])
    expect(
      program.commands
        .find((command) => command.name() === 'admin')
        ?.commands.map((command) => command.name())
    ).toEqual(['libraries', 'create', 'update', 'delete', 'sync', 'jobs', 'cancel'])
  })

  it('translates Commander failures into clear Chinese errors', async () => {
    const error = await runCli(['not-a-command']).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(CliError)
    expect((error as CliError).message).toContain('未知命令“not-a-command”')
    expect((error as CliError).exitCode).toBe(1)
  })
})
