import { describe, expect, it } from 'vitest'
import { detectAffectedScopes, listQualityScopes } from '../affected-scopes.mts'

describe('detectAffectedScopes', () => {
  it('CLI 修改只检查 CLI', () => {
    const scopes = detectAffectedScopes(['apps/cli/src/index.ts', 'apps/cli/vitest.config.ts'])

    expect(listQualityScopes(scopes)).toEqual(['cli'])
  })

  it('Web 修改同时检查 Web 和 CLI 分发包', () => {
    const scopes = detectAffectedScopes(['apps/web/src/App.tsx'])

    expect(listQualityScopes(scopes)).toEqual(['cli', 'web'])
  })

  it('Core 修改传播到全部依赖方', () => {
    const scopes = detectAffectedScopes(['packages/core/src/index.ts'])

    expect(listQualityScopes(scopes)).toEqual(['core', 'shared', 'runtime', 'cli', 'server', 'web'])
  })

  it('Shared 修改传播到全部依赖方', () => {
    const scopes = detectAffectedScopes(['packages/shared/src/index.ts'])

    expect(listQualityScopes(scopes)).toEqual(['core', 'shared', 'runtime', 'cli', 'server', 'web'])
  })

  it('内置 Skill 修改触发 CLI 检查和构建', () => {
    const scopes = detectAffectedScopes([
      '.agents/skills/use-loci/SKILL.md',
      '.agents/skills/use-loci/agents/openai.yaml'
    ])

    expect(listQualityScopes(scopes)).toEqual(['cli'])
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
      'web',
      'docs'
    ])
  })

  it('站点文档修改触发文档检查和构建', () => {
    const scopes = detectAffectedScopes(['apps/docs/docs/cli.mdx'])

    expect(listQualityScopes(scopes)).toEqual(['docs'])
  })

  it('普通 Markdown 修改不触发代码检查', () => {
    const scopes = detectAffectedScopes(['docs/PRD.md', 'README.md'])

    expect(scopes.code).toBe(false)
    expect(listQualityScopes(scopes)).toEqual([])
  })
})
