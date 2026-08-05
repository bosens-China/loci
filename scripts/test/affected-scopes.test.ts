import { describe, expect, it } from 'vitest'
import { detectAffectedScopes, listQualityScopes } from '../affected-scopes.mts'

describe('detectAffectedScopes', () => {
  it('CLI 修改只检查 CLI', () => {
    const scopes = detectAffectedScopes(['apps/cli/src/index.ts', 'apps/cli/vitest.config.ts'])

    expect(listQualityScopes(scopes)).toEqual(['cli'])
  })

  it('Core 修改传播到全部依赖方', () => {
    const scopes = detectAffectedScopes(['packages/core/src/index.ts'])

    expect(listQualityScopes(scopes)).toEqual([
      'core',
      'shared',
      'runtime',
      'cli',
      'server',
      'desktop'
    ])
  })

  it('Shared 修改传播到 Runtime、CLI 和 Desktop', () => {
    const scopes = detectAffectedScopes(['packages/shared/src/index.ts'])

    expect(listQualityScopes(scopes)).toEqual(['shared', 'runtime', 'cli', 'desktop'])
  })

  it('Server 与部署配置只影响 Server', () => {
    const scopes = detectAffectedScopes(['apps/server/src/index.ts', 'compose.yaml'])

    expect(listQualityScopes(scopes)).toEqual(['server'])
  })

  it('根配置和锁文件执行全量检查', () => {
    const scopes = detectAffectedScopes(['pnpm-lock.yaml'])

    expect(listQualityScopes(scopes)).toEqual([
      'root',
      'scripts',
      'core',
      'shared',
      'runtime',
      'cli',
      'server',
      'desktop',
      'docs'
    ])
  })

  it('纯文档修改不触发代码检查', () => {
    const scopes = detectAffectedScopes(['apps/docs/docs/cli.mdx', 'README.md'])

    expect(scopes.code).toBe(false)
    expect(listQualityScopes(scopes)).toEqual([])
  })
})
