import { describe, expect, it } from 'vitest'
import {
  createInstallCommand,
  createQualityCommands,
  parseQualityScopes
} from '../run-affected-quality.mts'

function commandLines(commands: ReadonlyArray<{ args: string[] }>): string[] {
  return commands.map(({ args }) => args.join(' '))
}

describe('run-affected-quality', () => {
  it('CLI scope 只安装 CLI 及其依赖', () => {
    const scopes = parseQualityScopes('cli')

    expect(createInstallCommand(scopes).args).toEqual([
      'install',
      '--frozen-lockfile',
      '--filter',
      'loci',
      '--filter',
      '@boses/cli...'
    ])
    expect(commandLines(createQualityCommands(scopes))).toEqual([
      'check:release-versions',
      'exec eslint --cache apps/cli',
      '--filter @boses/cli test',
      '--filter @boses/cli typecheck'
    ])
  })

  it('多个 scope 合并为一次测试和类型检查', () => {
    const scopes = parseQualityScopes('shared,runtime,cli,desktop')
    const lines = commandLines(createQualityCommands(scopes))

    expect(lines).toContain(
      '--filter @loci/shared --filter @loci/runtime --filter @boses/cli --filter @loci/desktop test'
    )
    expect(lines).toContain(
      '--filter @loci/shared --filter @loci/runtime --filter @boses/cli --filter @loci/desktop typecheck'
    )
  })

  it('root scope 保持完整质量门禁', () => {
    const scopes = parseQualityScopes('root,cli')

    expect(createInstallCommand(scopes).args).toEqual(['install', '--frozen-lockfile'])
    expect(commandLines(createQualityCommands(scopes))).toEqual([
      'check:release-versions',
      'lint',
      'test',
      'typecheck'
    ])
  })

  it('拒绝未知 scope', () => {
    expect(() => parseQualityScopes('cli,unknown')).toThrow('未知 CI scope')
  })
})
