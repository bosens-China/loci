import type { DatabaseSync } from 'node:sqlite'
import { isPathExcluded, isUrlInScope } from '@loci/core'

/** 编辑为更窄范围时，同步移除越界正文和全文索引。 */
export function deleteDocumentsOutsideScope(
  database: DatabaseSync,
  sourceId: string,
  hostname: string,
  scopePath: string,
  excludePathPattern?: string | null
): number {
  const documents = database
    .prepare(
      `SELECT d.id, d.url, t.url AS explicit_url FROM documents d
       LEFT JOIN explicit_page_targets t ON t.source_id = d.source_id AND t.url = d.url
       WHERE d.source_id = ?`
    )
    .all(sourceId) as unknown as Array<{ id: string; url: string; explicit_url: string | null }>
  const outside = documents.filter(
    (document) =>
      isPathExcluded(document.url, excludePathPattern) ||
      !isUrlInScope(document.url, hostname, document.explicit_url ? '/' : scopePath)
  )
  const deleteSearch = database.prepare('DELETE FROM documents_fts WHERE document_id = ?')
  const deleteDocument = database.prepare('DELETE FROM documents WHERE id = ?')
  for (const document of outside) {
    deleteSearch.run(document.id)
    deleteDocument.run(document.id)
  }
  const targets = database
    .prepare('SELECT url FROM explicit_page_targets WHERE source_id = ?')
    .all(sourceId) as unknown as Array<{ url: string }>
  const deleteTarget = database.prepare(
    'DELETE FROM explicit_page_targets WHERE source_id = ? AND url = ?'
  )
  for (const target of targets) {
    if (
      !isUrlInScope(target.url, hostname, '/') ||
      isPathExcluded(target.url, excludePathPattern)
    ) {
      deleteTarget.run(sourceId, target.url)
    }
  }
  return outside.length
}
