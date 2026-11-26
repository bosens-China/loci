import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { cliFixture } from './fixture.js'

const cli = cliFixture()
it('按项目安装、列出与清除 Skill', async () => {
  const args = ['--project', cli.root(), '--agent', 'universal']
  await cli.json('skills', 'add', ...args, '--yes')
  const path = join(cli.root(), '.agents/skills/use-loci/SKILL.md')
  expect(existsSync(path)).toBe(true)
  expect(await cli.json('skills', 'list', ...args)).toMatchObject([
    { name: 'use-loci', scope: 'project', status: 'current' }
  ])
  await cli.json('skills', 'clear', ...args, '--yes')
  expect(existsSync(path)).toBe(false)
})
it('全局接入在单独会话中可检查、重试、移除和单独恢复 Rules', async () => {
  const rules = join(cli.root(), 'home/.codex/AGENTS.md')
  expect(await cli.json('setup', 'codex')).toMatchObject({ changed: true, overall: 'ready' })
  expect(await cli.json('setup', 'codex')).toMatchObject({ changed: false, overall: 'ready' })
  expect(await cli.json('setup', 'status', 'codex')).toMatchObject({
    components: [
      { component: 'skill', status: 'current' },
      { component: 'rules', status: 'current' }
    ]
  })
  expect(readFileSync(rules, 'utf8')).toContain('loci')
  await cli.json('setup', 'remove', 'codex', '--yes')
  expect(await cli.json('setup', 'status', 'codex')).toMatchObject({ overall: 'missing' })
  expect(await cli.json('setup', 'rules', 'codex', '--yes')).toMatchObject({
    status: 'current',
    path: rules
  })
})
