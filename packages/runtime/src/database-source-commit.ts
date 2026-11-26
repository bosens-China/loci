import type { DatabaseSync } from 'node:sqlite'
import { and, eq } from 'drizzle-orm'
import { finishCrawlRunRecord } from './crawl-history-database.js'
import { throwLocalHostnameConflict, updateResolvedSourceRecord } from './database-local-source.js'
import type { SourceCrawlCommit } from './database-types.js'
import { createDrizzleDatabase } from './drizzle-database.js'
import { documents, explicitPageTargets } from './drizzle-schema.js'
import { deleteStoredDocument, storeDocument } from './document-content-database.js'
import { commitExplicitPageResults } from './explicit-page-database.js'
import { withImmediateTransaction } from './sqlite.js'

/** 调用方持有写事务；手工文档拥有其 URL 和逻辑路径，抓取只写入其余位置。 */
export function writeCrawlDocuments(
  database: DatabaseSync,
  id: string,
  commit: Pick<SourceCrawlCommit, 'documents' | 'deletedUrls' | 'replaceAll'>
): void {
  const db = createDrizzleDatabase(database)
  const manual = db
    .select({ url: documents.url, path: documents.relativePath })
    .from(documents)
    .where(and(eq(documents.sourceId, id), eq(documents.manual, 1)))
    .all()
  const manualUrls = new Set(manual.map((row) => row.url))
  const manualPaths = new Set(manual.map((row) => row.path))
  const incoming = commit.documents.filter(
    (doc) => !manualUrls.has(doc.url) && !(doc.relativePath && manualPaths.has(doc.relativePath))
  )
  if (commit.replaceAll) {
    // 保留同 URL 的文档 ID，以及单页补抓时暂时不可用的旧正文。
    const urls = new Set(incoming.map((doc) => doc.url))
    const targets = db
      .select({ url: explicitPageTargets.url })
      .from(explicitPageTargets)
      .where(eq(explicitPageTargets.sourceId, id))
      .all()
    for (const target of targets) urls.add(target.url)
    const previous = db
      .select({ url: documents.url })
      .from(documents)
      .where(and(eq(documents.sourceId, id), eq(documents.manual, 0)))
      .all()
    for (const row of previous) if (!urls.has(row.url)) deleteStoredDocument(database, id, row.url)
    // 快照可能互换逻辑路径，先批量释放即将变化的路径再统一写入。
    const reset = database.prepare(
      'UPDATE documents SET relative_path = NULL WHERE source_id = ? AND url = ? AND relative_path IS NOT ?'
    )
    for (const doc of incoming) reset.run(id, doc.url, doc.relativePath ?? null)
  } else {
    for (const url of new Set(commit.deletedUrls))
      if (!manualUrls.has(url)) deleteStoredDocument(database, id, url)
  }
  for (const doc of incoming) storeDocument(database, doc)
}

/** 抓取正文、来源解析结果必须在同一事务内提交。 */
export function commitSourceCrawl(
  database: DatabaseSync,
  id: string,
  commit: SourceCrawlCommit
): boolean {
  try {
    return withImmediateTransaction(database, () => {
      writeCrawlDocuments(database, id, commit)
      if (commit.explicitPages?.length) {
        commitExplicitPageResults(database, id, commit.explicitPages, commit.resolution.mode)
      }
      updateResolvedSourceRecord(
        database,
        id,
        commit.resolution.firstUrl,
        commit.resolution.mode,
        commit.resolution.iconUrl,
        commit.resolution.github,
        commit.resolution.discovery
      )
      if (
        commit.run &&
        !finishCrawlRunRecord(database, commit.run.id, 'completed', commit.run.progress, null)
      )
        throw new Error('抓取运行状态已变化')
      return true
    })
  } catch (error) {
    throwLocalHostnameConflict(error)
  }
}
