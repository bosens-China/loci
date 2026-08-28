import { randomUUID } from 'node:crypto'
import type {
  ServerAdminAuditLog,
  ServerAdminAuditLogPage,
  ServerAdminAuditMethod
} from '@loci/shared'
import { count, desc } from 'drizzle-orm'
import { adminAuditLogs } from './drizzle-schema.js'
import type { ServerDrizzleDatabase } from './drizzle-database.js'

export interface ServerAdminAuditDatabase {
  record: (input: {
    actor: string
    method: ServerAdminAuditMethod
    path: string
    statusCode: number
  }) => ServerAdminAuditLog
  list: (offset: number, limit: number) => ServerAdminAuditLogPage
}

/** 管理审计使用追加写入；读取按时间倒序分页，避免把请求正文持久化。 */
export function createServerAdminAuditDatabase(
  database: ServerDrizzleDatabase
): ServerAdminAuditDatabase {
  return {
    record: (input) => {
      const item: ServerAdminAuditLog = {
        id: randomUUID(),
        actor: input.actor,
        method: input.method,
        path: input.path,
        statusCode: input.statusCode,
        createdAt: new Date().toISOString()
      }
      database.insert(adminAuditLogs).values(item).run()
      return item
    },
    list: (offset, limit) => ({
      items: database
        .select()
        .from(adminAuditLogs)
        .orderBy(desc(adminAuditLogs.createdAt), desc(adminAuditLogs.id))
        .limit(limit)
        .offset(offset)
        .all(),
      total: database.select({ value: count() }).from(adminAuditLogs).get()?.value ?? 0,
      offset,
      limit
    })
  }
}
