import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDesktopSkillResourceDir } from '../skill-resources'

describe('桌面 Skill 静态资源', () => {
  it('开发态读取仓库唯一源目录', () => {
    const directory = resolveDesktopSkillResourceDir(false, '/unused')

    expect(existsSync(join(directory, 'SKILL.md'))).toBe(true)
  })

  it('生产态读取 Electron resources 目录', () => {
    expect(resolveDesktopSkillResourceDir(true, '/app/resources')).toBe(
      join('/app/resources', 'skills', 'use-loci')
    )
  })
})
