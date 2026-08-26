import type { ConcreteSkillAgent, SkillScope } from '@loci/shared'
import { asc, desc, eq } from 'drizzle-orm'
import type { LociDrizzleDatabase } from './drizzle-database.js'
import { skillInstallations } from './drizzle-schema.js'

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
