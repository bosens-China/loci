import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CrawledDocument } from '@loci/core'
import { ConflictError, NotFoundError } from './database-errors.js'
import { assertSyncJobOwned } from './sync-job-database.js'
import { withImmediateTransaction as transaction } from './sqlite.js'
import type { Library, LibrarySnapshot, SnapshotDocument } from './types.js'

interface SnapshotRow {
  revision: string
  content: string
}

export interface CrawlCommit {
  jobId: string
  ownerId: string
  documents: CrawledDocument[]
  deletedUrls: string[]
  replaceAll: boolean
  githubRevision?: string
}

export function listServerDocumentUrls(database: DatabaseSync, libraryId: string): string[] {
  return (
    database
      .prepare('SELECT url FROM documents WHERE library_id = ? ORDER BY url')
      .all(libraryId) as unknown as { url: string }[]
  ).map((row) => row.url)
}

export function saveServerDocument(
  database: DatabaseSync,
  libraryId: string,
  document: CrawledDocument
): void {
  database
    .prepare(
      `INSERT INTO documents
        (id, library_id, title, url, language, markdown, crawled_at, relative_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(library_id, url) DO UPDATE SET
        title = excluded.title, language = excluded.language, markdown = excluded.markdown,
        crawled_at = excluded.crawled_at, relative_path = excluded.relative_path`
    )
    .run(
      randomUUID(),
      libraryId,
      document.title,
      document.url,
      document.language,
      document.markdown,
      document.crawledAt,
      document.relativePath ?? null
    )
}

export function replaceServerDocuments(
  database: DatabaseSync,
  libraryId: string,
  documents: CrawledDocument[]
): void {
  transaction(database, () => {
    database.prepare('DELETE FROM documents WHERE library_id = ?').run(libraryId)
    for (const document of documents) saveServerDocument(database, libraryId, document)
  })
}

export function deleteServerDocument(database: DatabaseSync, libraryId: string, url: string): void {
  database.prepare('DELETE FROM documents WHERE library_id = ? AND url = ?').run(libraryId, url)
}

export function commitServerCrawl(
  database: DatabaseSync,
  libraryId: string,
  commit: CrawlCommit,
  getLibrary: (id: string) => Library
): LibrarySnapshot {
  let snapshot: LibrarySnapshot | undefined
  transaction(database, () => {
    assertSyncJobOwned(database, commit.jobId, commit.ownerId)
    if (commit.replaceAll) {
      database.prepare('DELETE FROM documents WHERE library_id = ?').run(libraryId)
    } else {
      for (const url of new Set(commit.deletedUrls)) deleteServerDocument(database, libraryId, url)
    }
    for (const document of commit.documents) saveServerDocument(database, libraryId, document)
    updateSuccessfulCrawl(database, libraryId, commit.githubRevision)
    snapshot = publishServerSnapshot(database, libraryId, getLibrary)
  })
  if (!snapshot) throw new Error('快照提交失败')
  return snapshot
}

export function publishServerSnapshot(
  database: DatabaseSync,
  libraryId: string,
  getLibrary: (id: string) => Library
): LibrarySnapshot {
  const library = getLibrary(libraryId)
  const documents = database
    .prepare(
      `SELECT id, title, url, language, markdown, relative_path AS relativePath FROM documents
       WHERE library_id = ? ORDER BY url`
    )
    .all(libraryId) as unknown as SnapshotDocument[]
  if (!documents.length) throw new ConflictError('文档库没有可发布页面')
  const payload = {
    schemaVersion: 1 as const,
    library: { id: library.id, name: library.name, url: library.url },
    documents
  }
  const contentSize = documents.reduce(
    (total, document) => total + Buffer.byteLength(document.markdown),
    0
  )
  const revision = `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`
  const current = database
    .prepare('SELECT revision, content FROM library_snapshots WHERE library_id = ?')
    .get(libraryId) as unknown as SnapshotRow | undefined
  if (current?.revision === revision) {
    database
      .prepare('UPDATE library_snapshots SET byte_size = ? WHERE library_id = ?')
      .run(contentSize, libraryId)
    return JSON.parse(current.content) as LibrarySnapshot
  }
  const publishedAt = new Date().toISOString()
  const snapshot: LibrarySnapshot = {
    ...payload,
    library: { ...payload.library, revision, publishedAt }
  }
  database
    .prepare(
      `INSERT INTO library_snapshots
        (library_id, revision, published_at, page_count, byte_size, content)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(library_id) DO UPDATE SET
        revision = excluded.revision, published_at = excluded.published_at,
        page_count = excluded.page_count, byte_size = excluded.byte_size,
        content = excluded.content`
    )
    .run(libraryId, revision, publishedAt, documents.length, contentSize, JSON.stringify(snapshot))
  return snapshot
}

export function getServerSnapshot(
  database: DatabaseSync,
  libraryId: string
): { revision: string; content: string } {
  const row = database
    .prepare('SELECT revision, content FROM library_snapshots WHERE library_id = ?')
    .get(libraryId) as unknown as SnapshotRow | undefined
  if (!row) throw new NotFoundError('文档库尚未发布')
  return row
}

function updateSuccessfulCrawl(
  database: DatabaseSync,
  libraryId: string,
  githubRevision?: string
): void {
  const now = new Date().toISOString()
  database
    .prepare(
      `UPDATE libraries SET last_crawled_at = ?, last_error = NULL,
         github_revision = COALESCE(?, github_revision),
         github_blocked_revision = CASE WHEN ? IS NULL THEN github_blocked_revision ELSE NULL END,
         github_blocked_limit_kind = CASE WHEN ? IS NULL THEN github_blocked_limit_kind ELSE NULL END,
         github_blocked_limit_bytes = CASE WHEN ? IS NULL THEN github_blocked_limit_bytes ELSE NULL END,
         updated_at = ? WHERE id = ?`
    )
    .run(
      now,
      githubRevision ?? null,
      githubRevision ?? null,
      githubRevision ?? null,
      githubRevision ?? null,
      now,
      libraryId
    )
}
