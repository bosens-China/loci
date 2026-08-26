import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { DocumentRecord, DocumentSummary } from '@loci/shared'
import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm'
import {
  type DocumentRow,
  type DocumentSummaryRow,
  toDocumentRecord,
  toDocumentSummary,
  toFtsExpression,
  toSearchTokens
} from './database-values.js'
import type { LociDrizzleDatabase } from './drizzle-database.js'
import { documents, documentSources } from './drizzle-schema.js'
import { withTransaction } from './sqlite.js'

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
  listDocumentCandidates: (sourceId: string) => Array<{ url: string; title: string }>
  saveDocument: (document: StoredDocument) => void
  replaceSourceDocuments: (sourceId: string, documents: StoredDocument[]) => void
  deleteDocument: (sourceId: string, url: string) => void
  clearDocuments: () => number
  clearSources: () => number
  listDocuments: () => DocumentRecord[]
  searchDocuments: (query: string, mode?: DocumentSearchMode) => DocumentRecord[]
  listDocumentSummaries: (sourceId?: string) => DocumentSummary[]
  searchDocumentSummaries: (
    query: string,
    sourceId?: string,
    mode?: DocumentSearchMode
  ) => DocumentSummary[]
  getDocument: (id: string) => DocumentRecord | null
}

const DOCUMENT_SUMMARY_COLUMNS = `d.id, d.source_id, s.name AS source_name, d.title, d.url,
  d.language, d.crawled_at, d.relative_path`

export function createDocumentContentDatabase(
  database: DatabaseSync,
  drizzleDatabase: LociDrizzleDatabase
): DocumentContentDatabase {
  return {
    listDocumentUrls: (sourceId) =>
      drizzleDatabase
        .select({ url: documents.url })
        .from(documents)
        .where(eq(documents.sourceId, sourceId))
        .orderBy(documents.crawledAt)
        .all()
        .map((row) => row.url),
    listDocumentCandidates: (sourceId) =>
      drizzleDatabase
        .select({ url: documents.url, title: documents.title })
        .from(documents)
        .where(eq(documents.sourceId, sourceId))
        .orderBy(documents.crawledAt)
        .all(),
    saveDocument: (document) =>
      withTransaction(database, () => {
        storeDocument(database, document)
      }),
    replaceSourceDocuments: (sourceId, documents) =>
      withTransaction(database, () => {
        deleteSourceDocuments(database, sourceId)
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
    listDocuments: () => selectDocumentRecords(drizzleDatabase).map(toDocumentRecord),
    searchDocuments: (query, mode = 'all') =>
      (mode === 'fuzzy'
        ? searchDocumentMetadata(drizzleDatabase, query)
        : searchFts(database, query, mode)
      ).map(toDocumentRecord),
    listDocumentSummaries: (sourceId) => listDocumentSummaries(drizzleDatabase, sourceId),
    searchDocumentSummaries: (query, sourceId, mode = 'all') =>
      (mode === 'fuzzy'
        ? searchDocumentMetadataSummaries(drizzleDatabase, query, sourceId)
        : searchFtsSummaries(database, query, mode, sourceId)
      ).map(toDocumentSummary),
    getDocument: (id) => {
      const row = drizzleDatabase
        .select(documentRecordSelection)
        .from(documents)
        .innerJoin(documentSources, eq(documentSources.id, documents.sourceId))
        .where(eq(documents.id, id))
        .get()
      return row ? toDocumentRecord(row) : null
    }
  }
}

const documentSummarySelection = {
  id: documents.id,
  source_id: documents.sourceId,
  source_name: documentSources.name,
  title: documents.title,
  url: documents.url,
  language: documents.language,
  crawled_at: documents.crawledAt,
  relative_path: documents.relativePath
}

const documentRecordSelection = {
  ...documentSummarySelection,
  markdown: documents.markdown
}

function selectDocumentRecords(database: LociDrizzleDatabase): DocumentRow[] {
  return database
    .select(documentRecordSelection)
    .from(documents)
    .innerJoin(documentSources, eq(documentSources.id, documents.sourceId))
    .orderBy(desc(documents.crawledAt))
    .all()
}

function listDocumentSummaries(
  database: LociDrizzleDatabase,
  sourceId?: string
): DocumentSummary[] {
  const rows = database
    .select(documentSummarySelection)
    .from(documents)
    .innerJoin(documentSources, eq(documentSources.id, documents.sourceId))
    .where(sourceId ? eq(documents.sourceId, sourceId) : undefined)
    .orderBy(desc(documents.crawledAt))
    .all()
  return rows.map(toDocumentSummary)
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

function searchFtsSummaries(
  database: DatabaseSync,
  query: string,
  mode: Exclude<DocumentSearchMode, 'fuzzy'>,
  sourceId?: string
): DocumentSummaryRow[] {
  const expression = toFtsExpression(query, mode === 'all' ? 'AND' : 'OR')
  if (!expression) return []
  const statement = database.prepare(
    `SELECT ${DOCUMENT_SUMMARY_COLUMNS}
     FROM documents_fts f
     JOIN documents d ON d.id = f.document_id
     JOIN document_sources s ON s.id = d.source_id
     WHERE documents_fts MATCH ?${sourceId ? ' AND d.source_id = ?' : ''}
     ORDER BY bm25(documents_fts, 0, 0, 8, 1)`
  )
  return (
    sourceId ? statement.all(expression, sourceId) : statement.all(expression)
  ) as DocumentSummaryRow[]
}

function searchDocumentMetadata(database: LociDrizzleDatabase, query: string): DocumentRow[] {
  const condition = metadataCondition(query)
  if (!condition) return []
  return database
    .select(documentRecordSelection)
    .from(documents)
    .innerJoin(documentSources, eq(documentSources.id, documents.sourceId))
    .where(condition)
    .orderBy(desc(documents.crawledAt))
    .limit(500)
    .all()
}

function searchDocumentMetadataSummaries(
  database: LociDrizzleDatabase,
  query: string,
  sourceId?: string
): DocumentSummaryRow[] {
  const condition = metadataCondition(query)
  if (!condition) return []
  return database
    .select(documentSummarySelection)
    .from(documents)
    .innerJoin(documentSources, eq(documentSources.id, documents.sourceId))
    .where(and(condition, sourceId ? eq(documents.sourceId, sourceId) : undefined))
    .orderBy(desc(documents.crawledAt))
    .limit(500)
    .all()
}

function metadataCondition(query: string): SQL | undefined {
  const tokens = toSearchTokens(query)
    .filter((token) => token.length >= 2)
    .slice(0, 10)
  if (!tokens.length) return undefined
  return or(
    ...tokens.flatMap((token) => {
      const pattern = `%${escapeLike(token)}%`
      return [
        sql`${documents.title} LIKE ${pattern} ESCAPE '\\'`,
        sql`${documents.url} LIKE ${pattern} ESCAPE '\\'`
      ]
    })
  )
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

export function deleteSourceDocuments(database: DatabaseSync, sourceId: string): number {
  database.prepare('DELETE FROM documents_fts WHERE source_id = ?').run(sourceId)
  return Number(database.prepare('DELETE FROM documents WHERE source_id = ?').run(sourceId).changes)
}
