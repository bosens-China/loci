import { describe, expect, it } from 'vitest'
import { CliError } from '../errors.js'
import { createProgram, runCli } from '../cli.js'

describe('Loci CLI 命令边界', () => {
  it('保留隐藏的兼容入口', async () => {
    await expect(
      createProgram().parseAsync(['schedule', 'run'], { from: 'user' })
    ).resolves.toBeDefined()
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
