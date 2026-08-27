import type { CreateOperationLogInput, OperationLog } from '@loci/shared'
import { and, count, desc, eq, gte, lt, type SQL } from 'drizzle-orm'
import type { LociDrizzleDatabase } from './drizzle-database.js'
import { operationLogs } from './drizzle-schema.js'

export interface OperationLogFilters {
  date?: string
  category?: OperationLog['category']
  level?: OperationLog['level']
  hostname?: string
  offset?: number
  limit?: number
}

export interface OperationLogPage {
  total: number
  items: OperationLog[]
}

export interface OperationLogDatabase {
  recordOperationLog: (input: CreateOperationLogInput) => OperationLog
  listOperationLogs: (filters?: OperationLogFilters) => OperationLogPage
}

/** 普通日志写入和筛选统一使用 Drizzle，避免把控制台文本当作操作契约。 */
export function createOperationLogDatabase(database: LociDrizzleDatabase): OperationLogDatabase {
  return {
    recordOperationLog: (input) => {
      const row = database
        .insert(operationLogs)
        .values({
          category: input.category,
          action: input.action,
          level: input.level,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          hostname: input.hostname,
          message: input.message,
          detailsJson: input.details ? JSON.stringify(input.details) : null,
          createdAt: input.createdAt ?? new Date().toISOString()
        })
        .returning()
        .get()
      return toOperationLog(row)
    },
    listOperationLogs: (filters = {}) => {
      const conditions = createConditions(filters)
      const where = conditions.length ? and(...conditions) : undefined
      const offset = Math.max(0, Math.trunc(filters.offset ?? 0))
      const limit = Math.max(1, Math.min(200, Math.trunc(filters.limit ?? 50)))
      const total =
        database.select({ value: count() }).from(operationLogs).where(where).get()?.value ?? 0
      const rows = database
        .select()
        .from(operationLogs)
        .where(where)
        .orderBy(desc(operationLogs.createdAt), desc(operationLogs.id))
        .limit(limit)
        .offset(offset)
        .all()
      return { total, items: rows.map(toOperationLog) }
    }
  }
}

function createConditions(filters: OperationLogFilters): SQL[] {
  const conditions: SQL[] = []
  if (filters.category) conditions.push(eq(operationLogs.category, filters.category))
  if (filters.level) conditions.push(eq(operationLogs.level, filters.level))
  if (filters.hostname) conditions.push(eq(operationLogs.hostname, filters.hostname.toLowerCase()))
  if (filters.date) {
    const start = new Date(`${filters.date}T00:00:00`)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    conditions.push(gte(operationLogs.createdAt, start.toISOString()))
    conditions.push(lt(operationLogs.createdAt, end.toISOString()))
  }
  return conditions
}

function toOperationLog(row: typeof operationLogs.$inferSelect): OperationLog {
  return {
    id: row.id,
    category: row.category,
    action: row.action,
    level: row.level,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    hostname: row.hostname,
    message: row.message,
    details: parseDetails(row.detailsJson),
    createdAt: row.createdAt
  }
}

function parseDetails(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
