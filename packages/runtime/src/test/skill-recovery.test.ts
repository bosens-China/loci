import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { createDatabase } from '../database.js'
import { SkillManager } from '../skill-manager.js'

it.each([false, true])(
  '跨进程中断替换后恢复旧目录和台账，并允许重试（保留备份: %s）',
  async (keepBackup) => {
    const root = mkdtempSync(join(tmpdir(), 'loci-skill-recovery-'))
    const dataDir = join(root, 'data')
    const homeDir = join(root, 'home')
    const databasePath = join(root, 'loci.sqlite')
    const skillResourceDir = resolve('../../.agents/skills/use-loci')
    const target = join(homeDir, '.agents/skills/use-loci')
    const database = createDatabase(databasePath)
    const manager = new SkillManager({
      database,
      dataDir,
      homeDir,
      skillResourceDir,
      packageVersion: '1'
    })
    let child: ReturnType<typeof spawn> | undefined
    try {
      await manager.add()
      writeFileSync(join(target, 'SKILL.md'), '# 用户修改\n')
      const ready = join(root, 'ready')
      const script = `
      import fs from 'node:fs'
      import { syncBuiltinESMExports } from 'node:module'
      const rename = fs.renameSync
      fs.renameSync = (from, to) => {
        rename(from, to)
        if (String(to).endsWith('.backup') || String(to).includes('.loci-skill-backups')) {
          fs.writeFileSync(${JSON.stringify(ready)}, 'ready')
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000)
        }
      }
      syncBuiltinESMExports()
      const { createDatabase } = await import(${JSON.stringify(pathToFileURL(resolve('src/database.ts')).href)})
      const { SkillManager } = await import(${JSON.stringify(pathToFileURL(resolve('src/skill-manager.ts')).href)})
      const database = createDatabase(${JSON.stringify(databasePath)})
      const manager = new SkillManager({ database, dataDir: ${JSON.stringify(dataDir)}, homeDir: ${JSON.stringify(homeDir)}, skillResourceDir: ${JSON.stringify(skillResourceDir)}, packageVersion: '2' })
      await manager.add({}, { backupLocalChanges: ${keepBackup} })
    `
      child = spawn(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '--eval', script],
        {
          stdio: ['ignore', 'ignore', 'pipe']
        }
      )
      const exited = once(child, 'exit')
      const errors: Buffer[] = []
      child.stderr?.on('data', (data: Buffer) => errors.push(data))
      const deadline = Date.now() + 10000
      while (!existsSync(ready) && child.exitCode === null && Date.now() < deadline)
        await new Promise((done) => setTimeout(done, 25))
      expect(existsSync(ready), Buffer.concat(errors).toString()).toBe(true)
      child.kill('SIGKILL')
      await exited
      expect(manager.preview()[0]?.status).toBe('modified')
      expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toBe('# 用户修改\n')
      expect(manager.list()).toMatchObject([{ targetPath: target, packageVersion: '1' }])
      const [result] = await manager.add({}, { backupLocalChanges: keepBackup })
      expect(result.action).toBe('reinstalled')
      if (keepBackup) {
        expect(readFileSync(join(result.backupPath!, 'SKILL.md'), 'utf8')).toBe('# 用户修改\n')
      }
      expect(manager.preview()[0]?.status).toBe('current')
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit')
        child.kill('SIGKILL')
        await exited
      }
      database.close()
      rmSync(root, { recursive: true, force: true })
    }
  },
  20000
)

it('中断的删除回滚文件与台账，已提交的删除只完成清理', async () => {
  const { randomUUID } = await import('node:crypto')
  const { renameSync } = await import('node:fs')
  const { beginSkillTransaction, commitSkillTransaction } = await import('../skill-transaction.js')
  const { transactionPath } = await import('../skill-files.js')
  const root = mkdtempSync(join(tmpdir(), 'loci-skill-remove-recovery-'))
  const database = createDatabase(join(root, 'loci.sqlite'))
  const homeDir = join(root, 'home')
  const target = join(homeDir, '.agents/skills/use-loci')
  const manager = new SkillManager({
    database,
    dataDir: join(root, 'data'),
    homeDir,
    skillResourceDir: resolve('../../.agents/skills/use-loci'),
    packageVersion: '1'
  })
  try {
    await manager.add()
    const previous = database.getSkillInstallationRecord(target)!
    const pending = {
      id: randomUUID(),
      action: 'remove' as const,
      committed: false,
      hadTarget: true,
      previous
    }
    beginSkillTransaction(target, pending)
    renameSync(target, transactionPath(target, 'remove', pending.id))
    database.deleteSkillInstallationRecord(target)
    expect(manager.preview()[0]?.status).toBe('current')
    expect(database.getSkillInstallationRecord(target)).toEqual(previous)

    const committed = { ...pending, id: randomUUID() }
    beginSkillTransaction(target, committed)
    renameSync(target, transactionPath(target, 'remove', committed.id))
    database.deleteSkillInstallationRecord(target)
    commitSkillTransaction(target, committed)
    expect(manager.preview()[0]?.status).toBe('absent')
    expect(database.getSkillInstallationRecord(target)).toBeUndefined()
    expect(existsSync(transactionPath(target, 'remove', committed.id))).toBe(false)
    await expect(manager.add()).resolves.toMatchObject([{ action: 'installed' }])
  } finally {
    database.close()
    rmSync(root, { recursive: true, force: true })
  }
})

it('首次安装在写入台账前中断时，可清理并重新安装', async () => {
  const { randomUUID } = await import('node:crypto')
  const { mkdirSync } = await import('node:fs')
  const { beginSkillTransaction } = await import('../skill-transaction.js')
  const { builtinSkillDigest, writeBuiltinSkill } = await import('../skill-files.js')
  const root = mkdtempSync(join(tmpdir(), 'loci-skill-first-recovery-'))
  const database = createDatabase(join(root, 'loci.sqlite'))
  const homeDir = join(root, 'home')
  const target = join(homeDir, '.agents/skills/use-loci')
  const resource = resolve('../../.agents/skills/use-loci')
  const manager = new SkillManager({
    database,
    dataDir: join(root, 'data'),
    homeDir,
    skillResourceDir: resource,
    packageVersion: '1'
  })
  try {
    mkdirSync(join(homeDir, '.agents/skills'), { recursive: true })
    beginSkillTransaction(target, {
      id: randomUUID(),
      action: 'add',
      committed: false,
      hadTarget: false,
      previous: null
    })
    writeBuiltinSkill(resource, target, '1', builtinSkillDigest(resource))
    expect(manager.preview()[0]?.status).toBe('absent')
    expect(existsSync(target)).toBe(false)
    await expect(manager.add()).resolves.toMatchObject([{ action: 'installed' }])
    expect(manager.list()).toHaveLength(1)
  } finally {
    database.close()
    rmSync(root, { recursive: true, force: true })
  }
})
