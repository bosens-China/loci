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
      'service',
      'ui',
      'document',
      'cloud',
      'admin',
      'agent',
      'mcp',
      'browser',
      'config',
      'data',
      'doctor'
    ])
    expect(program.options.some((option) => option.long === '--json')).toBe(false)
    expect(
      program.commands
        .find((command) => command.name() === 'agent')
        ?.commands.map((command) => command.name())
    ).toEqual(['configure', 'rules', 'skills', 'config'])
    expect(
      program.commands
        .find((command) => command.name() === 'agent')
        ?.commands.find((command) => command.name() === 'skills')
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
    ).toEqual(['call', 'stdio', 'serve', 'status'])
    expect(
      program.commands
        .find((command) => command.name() === 'service')
        ?.commands.map((command) => command.name())
    ).toEqual(['status', 'start', 'stop', 'restart', 'disable', 'logs', 'run'])
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

  it('不再暴露旧的 Agent 集成命令路径', async () => {
    await expect(createProgram().parseAsync(['mcp', 'config'], { from: 'user' })).rejects.toThrow(
      "unknown command 'config'"
    )
    await expect(createProgram().parseAsync(['skills', 'list'], { from: 'user' })).rejects.toThrow(
      "unknown command 'skills'"
    )
  })

  it('translates Commander failures into clear Chinese errors', async () => {
    const error = await runCli(['not-a-command']).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(CliError)
    expect((error as CliError).message).toContain('未知命令“not-a-command”')
    expect((error as CliError).exitCode).toBe(1)
  })
})
