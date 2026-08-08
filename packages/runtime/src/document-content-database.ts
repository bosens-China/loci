import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { DocumentRecord } from '@loci/shared'
import {
  type DocumentRow,
  toDocumentRecord,
  toFtsExpression,
  toSearchTokens
} from './database-values.js'

export type DocumentSearchMode = 'all' | 'any' | 'fuzzy'

export interface StoredDocument {
  sourceId: string
  url: string
  title: string
  markdown: string
  language: string
  fetchMode: 'http' | 'browser'
  crawledAt: string
  relativePath?: string
}

export interface DocumentContentDatabase {
  listDocumentUrls: (sourceId: string) => string[]
  saveDocument: (document: StoredDocument) => void
  replaceSourceDocuments: (sourceId: string, documents: StoredDocument[]) => void
  deleteDocument: (sourceId: string, url: string) => void
  clearDocuments: () => number
  clearSources: () => number
  listDocuments: () => DocumentRecord[]
  searchDocuments: (query: string, mode?: DocumentSearchMode) => DocumentRecord[]
}

export function createDocumentContentDatabase(database: DatabaseSync): DocumentContentDatabase {
  return {
    listDocumentUrls: (sourceId) =>
      (
        database
          .prepare('SELECT url FROM documents WHERE source_id = ? ORDER BY crawled_at ASC')
          .all(sourceId) as unknown as { url: string }[]
      ).map((row) => row.url),
    saveDocument: (document) =>
      withTransaction(database, () => {
        storeDocument(database, document)
      }),
    replaceSourceDocuments: (sourceId, documents) =>
      withTransaction(database, () => {
        database.prepare('DELETE FROM documents_fts WHERE source_id = ?').run(sourceId)
        database.prepare('DELETE FROM documents WHERE source_id = ?').run(sourceId)
        for (const document of documents) storeDocument(database, document)
      }),
    deleteDocument: (sourceId, url) => {
      deleteStoredDocument(database, sourceId, url)
    },
    clearDocuments: () =>
      withTransaction(database, () => {
        database.exec('DELETE FROM documents_fts')
        return Number(database.prepare('DELETE FROM documents').run().changes)
      }),
    clearSources: () =>
      withTransaction(database, () => {
        database.exec('DELETE FROM documents_fts')
        return Number(database.prepare('DELETE FROM document_sources').run().changes)
      }),
    listDocuments: () => {
      const rows = database
        .prepare(
          `SELECT d.id, d.source_id, s.name AS source_name, d.title, d.url,
             d.language, d.crawled_at, d.markdown, d.relative_path
           FROM documents d
           JOIN document_sources s ON s.id = d.source_id
           ORDER BY d.crawled_at DESC`
        )
        .all() as unknown as DocumentRow[]
      return rows.map(toDocumentRecord)
    },
    searchDocuments: (query, mode = 'all') =>
      (mode === 'fuzzy'
        ? searchDocumentMetadata(database, query)
        : searchFts(database, query, mode)
      ).map(toDocumentRecord)
  }
}

function searchFts(
  database: DatabaseSync,
  query: string,
  mode: Exclude<DocumentSearchMode, 'fuzzy'>
): DocumentRow[] {
  const expression = toFtsExpression(query, mode === 'all' ? 'AND' : 'OR')
  if (!expression) return []
  return database
    .prepare(
      `SELECT d.id, d.source_id, s.name AS source_name, d.title, d.url,
         d.language, d.crawled_at, d.markdown, d.relative_path
       FROM documents_fts f
       JOIN documents d ON d.id = f.document_id
       JOIN document_sources s ON s.id = d.source_id
       WHERE documents_fts MATCH ?
       ORDER BY bm25(documents_fts, 0, 0, 8, 1)`
    )
    .all(expression) as unknown as DocumentRow[]
}

function searchDocumentMetadata(database: DatabaseSync, query: string): DocumentRow[] {
  const tokens = toSearchTokens(query)
    .filter((token) => token.length >= 2)
    .slice(0, 10)
  if (!tokens.length) return []
  const conditions = tokens.map(() => `(d.title LIKE ? ESCAPE '\\' OR d.url LIKE ? ESCAPE '\\')`)
  const values = tokens.flatMap((token) => {
    const pattern = `%${escapeLike(token)}%`
    return [pattern, pattern]
  })
  return database
    .prepare(
      `SELECT d.id, d.source_id, s.name AS source_name, d.title, d.url,
         d.language, d.crawled_at, d.markdown, d.relative_path
       FROM documents d JOIN document_sources s ON s.id = d.source_id
       WHERE ${conditions.join(' OR ')}
       ORDER BY d.crawled_at DESC LIMIT 500`
    )
    .all(...values) as unknown as DocumentRow[]
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`)
}

export function storeDocument(database: DatabaseSync, document: StoredDocument): void {
  const id = randomUUID()
  database
    .prepare(
      `INSERT INTO documents
       (id, source_id, title, url, crawled_at, markdown, language, fetch_mode, relative_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_id, url) DO UPDATE SET
         title = excluded.title,
         crawled_at = excluded.crawled_at,
         markdown = excluded.markdown,
         language = excluded.language,
         fetch_mode = excluded.fetch_mode,
         relative_path = excluded.relative_path`
    )
    .run(
      id,
      document.sourceId,
      document.title,
      document.url,
      document.crawledAt,
      document.markdown,
      document.language,
      document.fetchMode,
      document.relativePath ?? null
    )
  const saved = database
    .prepare('SELECT id FROM documents WHERE source_id = ? AND url = ?')
    .get(document.sourceId, document.url) as unknown as { id: string }
  database.prepare('DELETE FROM documents_fts WHERE document_id = ?').run(saved.id)
  database
    .prepare(
      'INSERT INTO documents_fts (document_id, source_id, title, markdown) VALUES (?, ?, ?, ?)'
    )
    .run(saved.id, document.sourceId, document.title, document.markdown)
}

export function deleteStoredDocument(database: DatabaseSync, sourceId: string, url: string): void {
  const document = database
    .prepare('SELECT id FROM documents WHERE source_id = ? AND url = ?')
    .get(sourceId, url) as unknown as { id: string } | undefined
  if (!document) return
  database.prepare('DELETE FROM documents_fts WHERE document_id = ?').run(document.id)
  database.prepare('DELETE FROM documents WHERE id = ?').run(document.id)
}

function withTransaction<T>(database: DatabaseSync, work: () => T): T {
  database.exec('BEGIN')
  try {
    const result = work()
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
