import type { DatabaseSync } from 'node:sqlite'
import type { ClearDataCounts, ClearDataScope, ClearDataSummary } from '@loci/shared'
import { and, count, eq, isNotNull, lt, ne, or } from 'drizzle-orm'
import type { LociDrizzleDatabase } from './drizzle-database.js'
import {
  clearDataReceipts,
  documentMoveOperations,
  documents,
  documentSources,
  explicitPageTargets
} from './drizzle-schema.js'
import { withImmediateTransaction, withTransaction } from './sqlite.js'

/** 在一个事务内清除正文、索引和失效回执，并保留用于重新抓取的来源信息。 */
export function createClearDataDatabase(sqlite: DatabaseSync, db: LociDrizzleDatabase) {
  const counts = (): ClearDataCounts => ({
    libraries: db.select({ total: count() }).from(documentSources).get()!.total,
    documents: db.select({ total: count() }).from(documents).get()!.total
  })
  return {
    getClearDataCounts: () => withTransaction(sqlite, counts),
    clearData: (scope: ClearDataScope, operationId?: string): ClearDataSummary =>
      withImmediateTransaction(sqlite, () => {
        const current = counts()
        const summary = {
          scope,
          libraries: scope === 'sources' ? current.libraries : 0,
          documents: current.documents
        }
        // FTS5 虚拟表无法通过 Drizzle 或外键级联清理。
        sqlite.exec('DELETE FROM documents_fts')
        db.delete(documentMoveOperations).run()
        if (scope === 'sources') {
          db.delete(documentSources).run()
        } else {
          const now = new Date().toISOString()
          // 旧审查库以已有文档为白名单，清空前把曾批准的 URL 保留下来。
          const reviewed = db
            .select({ sourceId: documents.sourceId, url: documents.url })
            .from(documents)
            .innerJoin(documentSources, eq(documents.sourceId, documentSources.id))
            .where(
              and(
                eq(documentSources.discoveryMode, 'agent_review'),
                eq(documentSources.sourceType, 'local'),
                eq(documents.manual, 0)
              )
            )
            .all()
          for (const target of reviewed) {
            db.insert(explicitPageTargets)
              .values({ ...target, status: 'pending', createdAt: now, updatedAt: now })
              .onConflictDoNothing()
              .run()
          }
          db.delete(documents).run()
          db.update(explicitPageTargets)
            .set({ status: 'pending', lastCrawledAt: null, lastError: null, updatedAt: now })
            .where(
              or(
                ne(explicitPageTargets.status, 'pending'),
                isNotNull(explicitPageTargets.lastCrawledAt),
                isNotNull(explicitPageTargets.lastError)
              )
            )
            .run()
          // 清空后即使远端 SHA 未变，也应重新下载快照。
          db.update(documentSources)
            .set({
              githubRevision: null,
              githubBlockedRevision: null,
              githubBlockedLimitKind: null,
              githubBlockedLimitBytes: null
            })
            .where(eq(documentSources.documentKind, 'github'))
            .run()
        }
        if (operationId) {
          const now = Date.now()
          db.delete(clearDataReceipts)
            .where(lt(clearDataReceipts.createdAt, now - 86_400_000))
            .run()
          db.insert(clearDataReceipts).values({ operationId, summary, createdAt: now }).run()
        }
        return summary
      }),
    getClearDataSummary: (operationId: string) =>
      db
        .select({ summary: clearDataReceipts.summary })
        .from(clearDataReceipts)
        .where(eq(clearDataReceipts.operationId, operationId))
        .get()?.summary
  }
}

export type ClearDataDatabase = ReturnType<typeof createClearDataDatabase>
