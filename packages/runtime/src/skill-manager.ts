import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import type {
  ConcreteSkillAgent,
  SkillClearResult,
  SkillInstallation,
  SkillOperationInput,
  SkillOperationResult,
  SkillTargetPreview
} from '@loci/shared'
import { acquireRuntimeLock, RuntimeLockedError, type RuntimeLock } from './runtime-lock.js'
import type { LociDatabase } from './database.js'
import {
  CONCRETE_SKILL_AGENTS,
  DEFAULT_SKILL,
  builtinSkillDigest,
  compatibleAgents,
  digestSkillDirectory,
  parseSkillAgent,
  readSkillMarker,
  resolveProject,
  resolveSkillPath,
  skillLockKey,
  transactionPath,
  validSkillMarker,
  writeBuiltinSkill
} from './skill-files.js'

interface ResolvedTarget {
  name: string
  requestedAgent: ConcreteSkillAgent
  compatibleAgents: ConcreteSkillAgent[]
  scope: 'global' | 'project'
  projectRoot: string | null
  targetPath: string
}

export interface SkillManagerOptions {
  database: LociDatabase
  dataDir: string
  packageVersion: string
  skillResourceDir: string
  homeDir?: string
}

/** CLI 与后台服务共用的 Skill 文件事务和安装台账。 */
export class SkillManager {
  private readonly tasks = new Map<string, Promise<SkillOperationResult>>()

  constructor(private readonly options: SkillManagerOptions) {}

  list(input: SkillOperationInput = {}): SkillInstallation[] {
    const agent = input.agent ? parseSkillAgent(input.agent) : 'all'
    const projectRoot = input.project ? resolveProject(input.project) : undefined
    return this.options.database
      .listSkillInstallationRecords()
      .filter((record) => agent === 'all' || record.requestedAgent === agent)
      .filter((record) => projectRoot === undefined || record.projectRoot === projectRoot)
      .map((record) => {
        const target = this.targetFromRecord(record)
        const state = this.inspect(target)
        return {
          id: record.id,
          name: record.skillName,
          requestedAgent: record.requestedAgent,
          compatibleAgents: target.compatibleAgents,
          scope: record.scope,
          projectRoot: record.projectRoot,
          targetPath: record.resolvedTarget,
          packageVersion: record.packageVersion,
          contentDigest: record.contentDigest,
          status: state.status === 'absent' ? 'missing' : state.status,
          modified: state.modified,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt
        }
      })
  }

  preview(input: SkillOperationInput = {}): SkillTargetPreview[] {
    return this.resolveTargets(input).map((target) => ({ ...target, ...this.inspect(target) }))
  }

  add(input: SkillOperationInput = {}): Promise<SkillOperationResult[]> {
    return Promise.all(this.resolveTargets(input).map((target) => this.singleFlight(target, 'add')))
  }

  remove(input: SkillOperationInput = {}): Promise<SkillOperationResult[]> {
    return Promise.all(
      this.resolveTargets(input).map((target) => this.singleFlight(target, 'remove'))
    )
  }

  async clear(input: Omit<SkillOperationInput, 'name'> = {}): Promise<SkillClearResult> {
    const installations = this.list({ ...input, agent: input.agent ?? 'all' }).filter((item) =>
      input.project ? item.projectRoot !== null : item.scope === 'global'
    )
    const results = await Promise.allSettled(
      installations.map((item) => this.singleFlight(this.targetFromInstallation(item), 'remove'))
    )
    const summary: SkillClearResult = { removed: 0, missing: 0, failures: [] }
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        summary.failures.push({
          targetPath: installations[index]?.targetPath ?? '',
          message: result.reason instanceof Error ? result.reason.message : String(result.reason)
        })
      } else if (result.value.action === 'removed') summary.removed += 1
      else summary.missing += 1
    })
    return summary
  }

  private singleFlight(
    target: ResolvedTarget,
    action: 'add' | 'remove'
  ): Promise<SkillOperationResult> {
    const key = `${action}:${target.targetPath}`
    const existing = this.tasks.get(key)
    if (existing) return existing
    const task = Promise.resolve().then(() =>
      action === 'add' ? this.addOne(target) : this.removeOne(target)
    )
    this.tasks.set(key, task)
    void task.then(
      () => this.tasks.delete(key),
      () => this.tasks.delete(key)
    )
    return task
  }

  private async addOne(target: ResolvedTarget): Promise<SkillOperationResult> {
    const lock = await acquireSkillLock(
      this.options.dataDir,
      skillLockKey(target.targetPath),
      'Skills 写入'
    )
    try {
      const state = this.inspect(target)
      if (state.status === 'conflict')
        throw new Error(`目标不是 Loci 管理的目录：${target.targetPath}`)
      if (state.status === 'current') {
        return { action: 'unchanged', name: target.name, targetPath: target.targetPath }
      }
      mkdirSync(dirname(target.targetPath), { recursive: true })
      const temp = transactionPath(target.targetPath, 'tmp', randomUUID())
      const backup = transactionPath(target.targetPath, 'backup', randomUUID())
      const digest = builtinSkillDigest(this.options.skillResourceDir)
      const previousRecord = this.options.database.getSkillInstallationRecord(target.targetPath)
      let movedOld = false
      let movedNew = false
      try {
        writeBuiltinSkill(this.options.skillResourceDir, temp, this.options.packageVersion, digest)
        if (digestSkillDirectory(temp) !== digest) throw new Error('内置 Skill 写入校验失败')
        if (existsSync(target.targetPath)) {
          renameSync(target.targetPath, backup)
          movedOld = true
        }
        renameSync(temp, target.targetPath)
        movedNew = true
        const now = new Date().toISOString()
        this.options.database.saveSkillInstallationRecord({
          id: previousRecord?.id ?? randomUUID(),
          skillName: target.name,
          requestedAgent: target.requestedAgent,
          resolvedTarget: target.targetPath,
          scope: target.scope,
          projectRoot: target.projectRoot,
          packageVersion: this.options.packageVersion,
          contentDigest: digest,
          createdAt: previousRecord?.createdAt ?? now,
          updatedAt: now
        })
        rmSync(backup, { recursive: true, force: true })
        return {
          action: state.status === 'absent' ? 'installed' : 'reinstalled',
          name: target.name,
          targetPath: target.targetPath
        }
      } catch (error) {
        rmSync(temp, { recursive: true, force: true })
        if (movedNew && existsSync(target.targetPath))
          rmSync(target.targetPath, { recursive: true, force: true })
        if (movedOld && existsSync(backup)) renameSync(backup, target.targetPath)
        if (previousRecord) this.options.database.saveSkillInstallationRecord(previousRecord)
        else this.options.database.deleteSkillInstallationRecord(target.targetPath)
        throw error
      }
    } finally {
      lock.release()
    }
  }

  private async removeOne(target: ResolvedTarget): Promise<SkillOperationResult> {
    const lock = await acquireSkillLock(
      this.options.dataDir,
      skillLockKey(target.targetPath),
      'Skills 删除'
    )
    try {
      const record = this.options.database.getSkillInstallationRecord(target.targetPath)
      if (!record) {
        if (existsSync(target.targetPath)) {
          throw new Error(`目标存在但没有 Loci 安装记录：${target.targetPath}`)
        }
        return { action: 'missing', name: target.name, targetPath: target.targetPath }
      }
      if (!existsSync(target.targetPath)) {
        this.options.database.deleteSkillInstallationRecord(target.targetPath)
        return { action: 'missing', name: target.name, targetPath: target.targetPath }
      }
      if (!validSkillMarker(target.targetPath, target.name)) {
        throw new Error(`所有权标记无效，拒绝删除：${target.targetPath}`)
      }
      const quarantine = transactionPath(target.targetPath, 'remove', randomUUID())
      renameSync(target.targetPath, quarantine)
      try {
        this.options.database.deleteSkillInstallationRecord(target.targetPath)
      } catch (error) {
        renameSync(quarantine, target.targetPath)
        throw error
      }
      rmSync(quarantine, { recursive: true, force: true })
      return { action: 'removed', name: target.name, targetPath: target.targetPath }
    } finally {
      lock.release()
    }
  }

  private inspect(target: ResolvedTarget): {
    status: SkillTargetPreview['status']
    modified: boolean
  } {
    const record = this.options.database.getSkillInstallationRecord(target.targetPath)
    if (!existsSync(target.targetPath)) return { status: 'absent', modified: false }
    if (lstatSync(target.targetPath).isSymbolicLink() || !record) {
      return { status: 'conflict', modified: false }
    }
    const marker = readSkillMarker(target.targetPath)
    if (!marker || marker.name !== target.name) return { status: 'conflict', modified: false }
    const actual = digestSkillDirectory(target.targetPath)
    const modified = actual !== marker.contentDigest
    if (modified) return { status: 'modified', modified: true }
    return marker.contentDigest === builtinSkillDigest(this.options.skillResourceDir)
      ? { status: 'current', modified: false }
      : { status: 'outdated', modified: false }
  }

  private resolveTargets(input: SkillOperationInput): ResolvedTarget[] {
    const name = input.name ?? DEFAULT_SKILL
    if (name !== DEFAULT_SKILL) throw new Error(`未知的内置 Skill：${name}`)
    const agent = parseSkillAgent(input.agent)
    const projectRoot = input.project ? resolveProject(input.project) : null
    const scope = projectRoot ? ('project' as const) : ('global' as const)
    const home = resolve(this.options.homeDir ?? homedir())
    const agents = agent === 'all' ? CONCRETE_SKILL_AGENTS : [agent]
    const targets = agents.map((requestedAgent) => ({
      name,
      requestedAgent,
      compatibleAgents: [] as ConcreteSkillAgent[],
      scope,
      projectRoot,
      targetPath: resolveSkillPath(requestedAgent, name, projectRoot, home)
    }))
    const unique = new Map<string, ResolvedTarget>()
    for (const target of targets) {
      const existing = unique.get(target.targetPath)
      if (existing) existing.compatibleAgents.push(target.requestedAgent)
      else unique.set(target.targetPath, { ...target, compatibleAgents: [target.requestedAgent] })
    }
    return [...unique.values()]
  }

  private targetFromRecord(
    record: ReturnType<LociDatabase['listSkillInstallationRecords']>[number]
  ): ResolvedTarget {
    return {
      name: record.skillName,
      requestedAgent: record.requestedAgent,
      compatibleAgents: compatibleAgents(
        record.resolvedTarget,
        record.projectRoot,
        resolve(this.options.homeDir ?? homedir())
      ),
      scope: record.scope,
      projectRoot: record.projectRoot,
      targetPath: record.resolvedTarget
    }
  }

  private targetFromInstallation(item: SkillInstallation): ResolvedTarget {
    return {
      name: item.name,
      requestedAgent: item.requestedAgent,
      compatibleAgents: item.compatibleAgents,
      scope: item.scope,
      projectRoot: item.projectRoot,
      targetPath: item.targetPath
    }
  }
}

async function acquireSkillLock(dataDir: string, key: string, owner: string): Promise<RuntimeLock> {
  const deadline = Date.now() + 5000
  while (true) {
    try {
      return acquireRuntimeLock(dataDir, key, owner)
    } catch (error) {
      if (!(error instanceof RuntimeLockedError) || Date.now() >= deadline) throw error
      await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 50))
    }
  }
}
