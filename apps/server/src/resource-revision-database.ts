import type { DatabaseSync } from 'node:sqlite'
import {
  SERVER_RESOURCE_REVISION_KEYS,
  type ServerResourceRevisionKey,
  type ServerResourceRevisions
} from '@loci/shared'
import type { ServerDrizzleDatabase } from './drizzle-database.js'
import { serverResourceRevisions } from './drizzle-schema.js'

const TRIGGER_TARGETS: ReadonlyArray<{
  table: string
  resources: readonly ServerResourceRevisionKey[]
}> = [
  { table: 'libraries', resources: ['libraries'] },
  { table: 'documents', resources: ['libraries'] },
  { table: 'library_snapshots', resources: ['libraries'] },
  { table: 'publish_requests', resources: ['libraries'] },
  { table: 'sync_jobs', resources: ['jobs'] },
  { table: 'hostname_crawl_policies', resources: ['hostnamePolicies'] },
  { table: 'server_crawl_settings', resources: ['crawlSettings'] },
  { table: 'admin_audit_logs', resources: ['auditLogs'] }
]

const TRIGGER_ACTIONS = ['INSERT', 'UPDATE', 'DELETE'] as const

export interface ServerResourceRevisionDatabase {
  get: () => ServerResourceRevisions
}

/**
 * Server revision 由 SQLite 触发器维护。它将多 Server 进程与后台任务的写入
 * 收束为一个可供 SSE 订阅者观察的持久边界。
 */
export function initializeServerResourceRevisionDatabase(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS server_resource_revisions (
      resource TEXT PRIMARY KEY CHECK (resource IN ('libraries', 'jobs', 'hostnamePolicies', 'crawlSettings', 'auditLogs')),
      revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
    ) STRICT;
  `)
  const insert = database.prepare(
    'INSERT OR IGNORE INTO server_resource_revisions (resource, revision) VALUES (?, 0)'
  )
  for (const resource of SERVER_RESOURCE_REVISION_KEYS) insert.run(resource)

  for (const target of TRIGGER_TARGETS) {
    const resources = target.resources.map((resource) => `'${resource}'`).join(', ')
    for (const action of TRIGGER_ACTIONS) {
      database.exec(`
        CREATE TRIGGER IF NOT EXISTS server_resource_revision_${target.table}_${action.toLowerCase()}
        AFTER ${action} ON ${target.table}
        BEGIN
          UPDATE server_resource_revisions
          SET revision = revision + 1
          WHERE resource IN (${resources});
        END;
      `)
    }
  }
}

export function createServerResourceRevisionDatabase(
  database: ServerDrizzleDatabase
): ServerResourceRevisionDatabase {
  return {
    get: () => {
      const revisions: ServerResourceRevisions = {
        libraries: 0,
        jobs: 0,
        hostnamePolicies: 0,
        crawlSettings: 0,
        auditLogs: 0
      }
      for (const row of database.select().from(serverResourceRevisions).all()) {
        revisions[row.resource] = row.revision
      }
      return revisions
    }
  }
}
