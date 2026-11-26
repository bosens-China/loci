import type { DatabaseSync } from 'node:sqlite'
import type { ConcreteSkillAgent, SkillScope } from '@loci/shared'
import { asc, desc, eq } from 'drizzle-orm'
import { SKILL_INSTALLATIONS_SCHEMA } from './database-schema.js'
import type { LociDrizzleDatabase } from './drizzle-database.js'
import { skillInstallations } from './drizzle-schema.js'
import { hasColumn } from './sqlite.js'

/** SQLite 需在数据库迁移事务中重建安装台账，才能扩展 Agent 的 CHECK 约束。 */
export function migrateSkillInstallationsForPi(database: DatabaseSync): void {
  if (!hasColumn(database, 'skill_installations', 'requested_agent')) return
  const columns = `id, skill_name, requested_agent, resolved_target, scope, project_root,
    package_version, content_digest, created_at, updated_at`
  database.exec(`
    ALTER TABLE skill_installations RENAME TO skill_installations_before_pi;
    ${SKILL_INSTALLATIONS_SCHEMA}
    INSERT INTO skill_installations (${columns})
      SELECT ${columns} FROM skill_installations_before_pi;
    DROP TABLE skill_installations_before_pi;
  `)
}

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

export interface SkillInstallationDatabase {
  listSkillInstallationRecords: () => SkillInstallationRecord[]
  getSkillInstallationRecord: (targetPath: string) => SkillInstallationRecord | undefined
  saveSkillInstallationRecord: (record: SkillInstallationRecord) => void
  deleteSkillInstallationRecord: (targetPath: string) => void
}

export function createSkillInstallationDatabase(
  database: LociDrizzleDatabase
): SkillInstallationDatabase {
  return {
    listSkillInstallationRecords: () =>
      database
        .select()
        .from(skillInstallations)
        .orderBy(desc(skillInstallations.updatedAt), asc(skillInstallations.resolvedTarget))
        .all(),
    getSkillInstallationRecord: (targetPath) => {
      const row = database
        .select()
        .from(skillInstallations)
        .where(eq(skillInstallations.resolvedTarget, targetPath))
        .get()
      return row
    },
    saveSkillInstallationRecord: (record) => {
      database
        .insert(skillInstallations)
        .values(record)
        .onConflictDoUpdate({
          target: skillInstallations.resolvedTarget,
          set: {
            skillName: record.skillName,
            requestedAgent: record.requestedAgent,
            scope: record.scope,
            projectRoot: record.projectRoot,
            packageVersion: record.packageVersion,
            contentDigest: record.contentDigest,
            updatedAt: record.updatedAt
          }
        })
        .run()
    },
    deleteSkillInstallationRecord: (targetPath) => {
      database
        .delete(skillInstallations)
        .where(eq(skillInstallations.resolvedTarget, targetPath))
        .run()
    }
  }
}
