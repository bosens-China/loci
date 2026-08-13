import type { DatabaseSync } from 'node:sqlite'
import type { ConcreteSkillAgent, SkillScope } from '@loci/shared'

export interface SkillInstallationRecord {
  id: string
  skillName: string
  requestedAgent: ConcreteSkillAgent
  resolvedTarget: string
  scope: SkillScope
  projectRoot: string | null
  packageVersion: string
  contentDigest: string
  createdAt: string
  updatedAt: string
}

interface SkillInstallationRow {
  id: string
  skill_name: string
  requested_agent: ConcreteSkillAgent
  resolved_target: string
  scope: SkillScope
  project_root: string | null
  package_version: string
  content_digest: string
  created_at: string
  updated_at: string
}

export interface SkillInstallationDatabase {
  listSkillInstallationRecords: () => SkillInstallationRecord[]
  getSkillInstallationRecord: (targetPath: string) => SkillInstallationRecord | undefined
  saveSkillInstallationRecord: (record: SkillInstallationRecord) => void
  deleteSkillInstallationRecord: (targetPath: string) => void
}

export function createSkillInstallationDatabase(database: DatabaseSync): SkillInstallationDatabase {
  return {
    listSkillInstallationRecords: () =>
      (
        database
          .prepare('SELECT * FROM skill_installations ORDER BY updated_at DESC, resolved_target')
          .all() as unknown as SkillInstallationRow[]
      ).map(toRecord),
    getSkillInstallationRecord: (targetPath) => {
      const row = database
        .prepare('SELECT * FROM skill_installations WHERE resolved_target = ?')
        .get(targetPath) as unknown as SkillInstallationRow | undefined
      return row ? toRecord(row) : undefined
    },
    saveSkillInstallationRecord: (record) => {
      database
        .prepare(
          `INSERT INTO skill_installations
           (id, skill_name, requested_agent, resolved_target, scope, project_root,
            package_version, content_digest, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(resolved_target) DO UPDATE SET
             skill_name = excluded.skill_name,
             requested_agent = excluded.requested_agent,
             scope = excluded.scope,
             project_root = excluded.project_root,
             package_version = excluded.package_version,
             content_digest = excluded.content_digest,
             updated_at = excluded.updated_at`
        )
        .run(
          record.id,
          record.skillName,
          record.requestedAgent,
          record.resolvedTarget,
          record.scope,
          record.projectRoot,
          record.packageVersion,
          record.contentDigest,
          record.createdAt,
          record.updatedAt
        )
    },
    deleteSkillInstallationRecord: (targetPath) => {
      database.prepare('DELETE FROM skill_installations WHERE resolved_target = ?').run(targetPath)
    }
  }
}

function toRecord(row: SkillInstallationRow): SkillInstallationRecord {
  return {
    id: row.id,
    skillName: row.skill_name,
    requestedAgent: row.requested_agent,
    resolvedTarget: row.resolved_target,
    scope: row.scope,
    projectRoot: row.project_root,
    packageVersion: row.package_version,
    contentDigest: row.content_digest,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
