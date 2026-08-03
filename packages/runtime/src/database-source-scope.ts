import type { DatabaseSync } from 'node:sqlite'
import { isUrlInScope } from '@loci/core'

/** 编辑为更窄范围时，同步移除越界正文和全文索引。 */
export function deleteDocumentsOutsideScope(
  database: DatabaseSync,
  sourceId: string,
  hostname: string,
  scopePath: string
): number {
  const documents = database
    .prepare('SELECT id, url FROM documents WHERE source_id = ?')
    .all(sourceId) as unknown as Array<{ id: string; url: string }>
  const outside = documents.filter((document) => !isUrlInScope(document.url, hostname, scopePath))
  const deleteSearch = database.prepare('DELETE FROM documents_fts WHERE document_id = ?')
  const deleteDocument = database.prepare('DELETE FROM documents WHERE id = ?')
  for (const document of outside) {
    deleteSearch.run(document.id)
    deleteDocument.run(document.id)
  }
  return outside.length
}
