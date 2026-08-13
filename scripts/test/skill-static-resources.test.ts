import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workspaceRoot = process.cwd()

describe('内置 Skill 静态资源打包配置', () => {
  it('CLI 发布包包含 tsdown 复制的完整资源目录', () => {
    const packageJson = readJson('apps/cli/package.json')
    const config = read('apps/cli/tsdown.config.ts')

    expect(existsSync(resolve(workspaceRoot, '.agents/skills/use-loci/SKILL.md'))).toBe(true)
    expect(packageJson.files).toContain('dist/resources/**')
    expect(packageJson.scripts.prebuild).toBeUndefined()
    expect(config).toContain("from: '../../.agents/skills/use-loci'")
    expect(config).toContain("to: 'dist/resources/skills'")
  })

  it('桌面安装包通过 extraResources 原样携带 Skill', () => {
    const packageJson = readJson('apps/desktop/package.json')
    const config = read('apps/desktop/electron-builder.yml')

    expect(packageJson.scripts.build).not.toContain('skills:generate')
    expect(config).toContain('extraResources:')
    expect(config).toContain('from: ../../.agents/skills/use-loci')
    expect(config).toContain('to: skills/use-loci')
  })

  it('Runtime 不再维护资源生成命令或生成文件', () => {
    const packageJson = readJson('packages/runtime/package.json')

    expect(packageJson.scripts['skills:generate']).toBeUndefined()
    expect(
      existsSync(resolve(workspaceRoot, 'packages/runtime/src/skill-resource.generated.ts'))
    ).toBe(false)
    expect(
      existsSync(resolve(workspaceRoot, 'packages/runtime/scripts/generate-skill-resource.mjs'))
    ).toBe(false)
  })
})

function read(path: string): string {
  return readFileSync(resolve(workspaceRoot, path), 'utf8')
}

function readJson(path: string): { files?: string[]; scripts: Record<string, string> } {
  return JSON.parse(read(path)) as { files?: string[]; scripts: Record<string, string> }
}
