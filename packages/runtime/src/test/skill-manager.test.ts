import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createDatabase } from '../database.js'
import { SkillManager } from '../skill-manager.js'
import { acquireRuntimeLock } from '../runtime-lock.js'
import { skillLockKey } from '../skill-files.js'

const directories: string[] = []
const skillResourceDir = fileURLToPath(
  new URL('../../../../.agents/skills/use-loci/', import.meta.url)
)

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})

function setup(): { root: string; manager: SkillManager } {
  const root = mkdtempSync(join(tmpdir(), 'loci-skills-'))
  directories.push(root)
  const database = createDatabase(join(root, 'loci.sqlite'))
  return {
    root,
    manager: new SkillManager({
      database,
      dataDir: join(root, 'data'),
      homeDir: join(root, 'home'),
      packageVersion: '1.12.0',
      skillResourceDir
    })
  }
}

describe('SkillManager', () => {
  it('默认全局安装且重复 add 幂等', async () => {
    const { root, manager } = setup()
    const target = join(root, 'home/.agents/skills/use-loci')

    await expect(manager.add()).resolves.toEqual([
      { action: 'installed', name: 'use-loci', targetPath: target }
    ])
    await expect(manager.add()).resolves.toEqual([
      { action: 'unchanged', name: 'use-loci', targetPath: target }
    ])
    expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toContain('name: use-loci')
    expect(readFileSync(join(target, 'agents/openai.yaml'), 'utf8')).toContain('Loci 文档助手')
    expect(manager.list()).toMatchObject([{ targetPath: target, status: 'current' }])
  })

  it('修改后由 add 整目录重装并删除旧文件', async () => {
    const { root, manager } = setup()
    const target = join(root, 'home/.cursor/skills/use-loci')
    await manager.add({ agent: 'cursor' })
    writeFileSync(join(target, 'SKILL.md'), '# local edit\n')
    writeFileSync(join(target, 'stale.txt'), 'stale')

    expect(manager.preview({ agent: 'cursor' })[0]).toMatchObject({ status: 'modified' })
    await expect(manager.add({ agent: 'cursor' })).resolves.toMatchObject([
      { action: 'reinstalled' }
    ])
    expect(existsSync(join(target, 'stale.txt'))).toBe(false)
    expect(manager.list({ agent: 'cursor' })[0]?.status).toBe('current')
  })

  it('拒绝接管无台账的第三方目录', async () => {
    const { root, manager } = setup()
    const target = join(root, 'home/.agents/skills/use-loci')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'SKILL.md'), '# third party\n')

    expect(manager.preview()[0]?.status).toBe('conflict')
    await expect(manager.add()).rejects.toThrow('不是 Loci 管理的目录')
  })

  it('all 按物理路径去重且项目操作使用显式路径', async () => {
    const { root, manager } = setup()
    const project = join(root, 'project')
    mkdirSync(project)

    const results = await manager.add({ agent: 'all', project })
    expect(results).toHaveLength(4)
    expect(new Set(results.map((item) => item.targetPath)).size).toBe(4)
    expect(results.every((item) => item.targetPath.startsWith(realpathSync(project)))).toBe(true)
    expect(manager.list({ project })).toHaveLength(4)
  })

  it('remove 清理目录和台账，缺失目录也能清理记录', async () => {
    const { root, manager } = setup()
    const target = join(root, 'home/.claude/skills/use-loci')
    await manager.add({ agent: 'claude-code' })
    await expect(manager.remove({ agent: 'claude-code' })).resolves.toMatchObject([
      { action: 'removed' }
    ])
    expect(existsSync(target)).toBe(false)
    expect(manager.list()).toEqual([])

    await manager.add({ agent: 'claude-code' })
    rmSync(target, { recursive: true })
    await expect(manager.remove({ agent: 'claude-code' })).resolves.toMatchObject([
      { action: 'missing' }
    ])
    expect(manager.list()).toEqual([])
    const missing = await manager.remove({ agent: 'all' })
    expect(missing.every((result) => result.action === 'missing')).toBe(true)
  })

  it('clear 只清理筛选范围内的记录', async () => {
    const { root, manager } = setup()
    await manager.add({ agent: 'all' })
    const project = join(root, 'project')
    mkdirSync(project)
    await manager.add({ project })
    const result = await manager.clear({ agent: 'all' })
    expect(result).toMatchObject({ removed: 5, missing: 0, failures: [] })
    expect(manager.list()).toMatchObject([{ scope: 'project', projectRoot: realpathSync(project) }])
  })

  it('同一进程的同时 add 复用同一个写入任务', async () => {
    const { manager } = setup()
    const [first, second] = await Promise.all([manager.add(), manager.add()])
    expect(first).toEqual(second)
    expect(first[0]?.action).toBe('installed')
    expect(manager.list()).toHaveLength(1)
  })

  it('跨入口锁释放后复查状态并继续安装', async () => {
    const { root, manager } = setup()
    const target = join(root, 'home/.agents/skills/use-loci')
    const lock = acquireRuntimeLock(join(root, 'data'), skillLockKey(target), '另一个 Loci 入口')
    const pending = manager.add()
    setTimeout(() => lock.release(), 100)
    await expect(pending).resolves.toMatchObject([{ action: 'installed', targetPath: target }])
  })
})
