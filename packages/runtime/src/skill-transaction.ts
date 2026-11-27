import { existsSync, lstatSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'
import { SKILL_AGENTS } from '@loci/shared'
import { writeFileAtomically } from './atomic-file.js'
import type { SkillInstallationDatabase } from './skill-database.js'
import { transactionPath } from './skill-files.js'

const recordSchema = z.object({
  id: z.string(),
  skillName: z.string(),
  requestedAgent: z.enum(SKILL_AGENTS.filter((v) => v !== 'all')),
  resolvedTarget: z.string(),
  scope: z.enum(['global', 'project']),
  projectRoot: z.string().nullable(),
  packageVersion: z.string(),
  contentDigest: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
})
const journalSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(['add', 'remove']),
  committed: z.boolean(),
  hadTarget: z.boolean(),
  keepBackup: z.boolean().optional(),
  previous: recordSchema.nullable()
})
type Journal = z.infer<typeof journalSchema>

function journalPath(target: string): string {
  return transactionPath(target, 'journal', 'transaction')
}

export function hasSkillTransaction(target: string): boolean {
  return existsSync(journalPath(target))
}

/** 日志先于目录变更落盘，重启后在相同资源锁内完成回滚或清理。 */
export function beginSkillTransaction(target: string, journal: Journal): void {
  writeFileAtomically(journalPath(target), JSON.stringify(journal))
}

export function commitSkillTransaction(target: string, journal: Journal): void {
  beginSkillTransaction(target, { ...journal, committed: true })
}

/** 保留的备份放在客户端的 Skill 扫描目录之外。 */
export function skillBackupPath(target: string, id: string): string {
  return join(dirname(dirname(target)), '.loci-skill-backups', `${basename(target)}.${id}`)
}

export function recoverSkillTransaction(target: string, database: SkillInstallationDatabase): void {
  const path = journalPath(target)
  if (!existsSync(path)) return
  const journal = journalSchema.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown)
  if (journal.previous && journal.previous.resolvedTarget !== target)
    throw new Error('Skill 事务记录路径不匹配')
  const temp = transactionPath(target, 'tmp', journal.id)
  const backup = journal.keepBackup
    ? skillBackupPath(target, journal.id)
    : transactionPath(target, journal.action === 'add' ? 'backup' : 'remove', journal.id)
  if (!journal.committed) {
    if (lstatSync(backup, { throwIfNoEntry: false })) {
      rmSync(target, { recursive: true, force: true })
      renameSync(backup, target)
    } else if (!journal.hadTarget && journal.action === 'add' && !existsSync(temp)) {
      rmSync(target, { recursive: true, force: true })
    }
    if (journal.previous) database.saveSkillInstallationRecord(journal.previous)
    else database.deleteSkillInstallationRecord(target)
  }
  rmSync(temp, { recursive: true, force: true })
  if (!journal.keepBackup) rmSync(backup, { recursive: true, force: true })
  rmSync(path, { force: true })
}
