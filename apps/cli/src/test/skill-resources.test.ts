import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveCliSkillResourceDir } from '../skill-resources.js'

const directories: string[] = []

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})

describe('CLI Skill 静态资源', () => {
  it('源码运行时回退到仓库唯一源目录', () => {
    const directory = resolveCliSkillResourceDir()

    expect(existsSync(join(directory, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(directory, 'agents/openai.yaml'))).toBe(true)
  })

  it('构建产物优先读取同目录下复制的 resources', () => {
    const root = mkdtempSync(join(tmpdir(), 'loci-cli-assets-'))
    directories.push(root)
    const resourceDir = join(root, 'dist/resources/skills/use-loci')
    mkdirSync(resourceDir, { recursive: true })
    writeFileSync(join(resourceDir, 'SKILL.md'), '# packaged\n')

    expect(resolveCliSkillResourceDir(pathToFileURL(join(root, 'dist/index.js')).href)).toBe(
      resourceDir
    )
  })
})
