import type { DatabaseSync } from 'node:sqlite'
import {
  RESOURCE_REVISION_KEYS,
  type ResourceRevisionKey,
  type ResourceRevisions
} from '@loci/shared'
import type { LociDrizzleDatabase } from './drizzle-database.js'
import { resourceRevisions } from './drizzle-schema.js'

const TRIGGER_TARGETS: ReadonlyArray<{
  table: string
  resources: readonly ResourceRevisionKey[]
}> = [
  { table: 'document_sources', resources: ['sources'] },
  { table: 'documents', resources: ['sources', 'documents'] },
  { table: 'local_jobs', resources: ['jobs'] },
  { table: 'app_settings', resources: ['settings'] },
  { table: 'operation_logs', resources: ['logs'] }
]

const TRIGGER_ACTIONS = ['INSERT', 'UPDATE', 'DELETE'] as const

export interface ResourceRevisionDatabase {
  getResourceRevisions: () => ResourceRevisions
}

/**
 * revision 由数据库触发器维护，确保 CLI、MCP、worker 和 Web 的跨进程写入共享同一语义。
 * 表结构与触发器属于迁移职责；普通读取继续使用 Drizzle。
 */
export function initializeResourceRevisionDatabase(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS resource_revisions (
      resource TEXT PRIMARY KEY CHECK (resource IN ('sources', 'documents', 'jobs', 'settings', 'logs')),
      revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
    ) STRICT;
  `)
  upgradeResourceRevisionTable(database)
  const insert = database.prepare(
    'INSERT OR IGNORE INTO resource_revisions (resource, revision) VALUES (?, 0)'
  )
  for (const resource of RESOURCE_REVISION_KEYS) insert.run(resource)

  for (const target of TRIGGER_TARGETS) {
    const resources = target.resources.map((resource) => `'${resource}'`).join(', ')
    for (const action of TRIGGER_ACTIONS) {
      database.exec(`
        CREATE TRIGGER IF NOT EXISTS resource_revision_${target.table}_${action.toLowerCase()}
        AFTER ${action} ON ${target.table}
        BEGIN
          UPDATE resource_revisions
          SET revision = revision + 1
          WHERE resource IN (${resources});
        END;
      `)
    }
  }
}

/** 新增 revision 类别须重建 SQLite 的 CHECK 约束，保留已有类别的单调版本。 */
function upgradeResourceRevisionTable(database: DatabaseSync): void {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'resource_revisions'")
    .get() as { sql: string } | undefined
  if (row?.sql.includes("'logs'")) return

  database.exec('BEGIN IMMEDIATE')
  try {
    for (const target of TRIGGER_TARGETS) {
      for (const action of TRIGGER_ACTIONS) {
        database.exec(
          `DROP TRIGGER IF EXISTS resource_revision_${target.table}_${action.toLowerCase()}`
        )
      }
    }
    database.exec(`
      CREATE TABLE resource_revisions_next (
        resource TEXT PRIMARY KEY CHECK (resource IN ('sources', 'documents', 'jobs', 'settings', 'logs')),
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
      ) STRICT;
      INSERT INTO resource_revisions_next (resource, revision)
      SELECT resource, revision FROM resource_revisions;
      DROP TABLE resource_revisions;
      ALTER TABLE resource_revisions_next RENAME TO resource_revisions;
    `)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function createResourceRevisionDatabase(
  database: LociDrizzleDatabase
): ResourceRevisionDatabase {
  return {
    getResourceRevisions: () => {
      const revisions: ResourceRevisions = {
        sources: 0,
        documents: 0,
        jobs: 0,
        settings: 0,
        logs: 0
      }
      for (const row of database.select().from(resourceRevisions).all()) {
        revisions[row.resource] = row.revision
      }
      return revisions
    }
  }
}
