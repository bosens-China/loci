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
  { table: 'app_settings', resources: ['settings'] }
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
      resource TEXT PRIMARY KEY CHECK (resource IN ('sources', 'documents', 'jobs', 'settings')),
      revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
    ) STRICT;
  `)
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

export function createResourceRevisionDatabase(
  database: LociDrizzleDatabase
): ResourceRevisionDatabase {
  return {
    getResourceRevisions: () => {
      const revisions: ResourceRevisions = { sources: 0, documents: 0, jobs: 0, settings: 0 }
      for (const row of database.select().from(resourceRevisions).all()) {
        revisions[row.resource] = row.revision
      }
      return revisions
    }
  }
}
