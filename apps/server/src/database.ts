import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { getHostname, isUrlInScope, normalizeScopePath, normalizeUrl } from '@loci/core'
import type { CrawledDocument } from '@loci/core'
import type {
  Library,
  LibraryInput,
  LibrarySnapshot,
  PublicLibrary,
  SnapshotDocument
} from './types.js'
import { initializeServerDatabase } from './database-schema.js'

interface LibraryRow {
  id: string
  name: string
  first_url: string
  hostname: string
  scope_path: string
  page_limit: number
  schedule: string | null
  page_count: number
  last_crawled_at: string | null
  last_error: string | null
  revision: string | null
  published_at: string | null
}

interface PublicLibraryRow {
  id: string
  name: string
  first_url: string
  revision: string
  page_count: number
  byte_size: number
  last_crawled_at: string | null
  published_at: string
}

interface SnapshotRow {
  revision: string
  content: string
}

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

/** 服务端 SQLite 是抓取工作区和公开快照的唯一权威存储。 */
export class ServerDatabase {
  readonly #database: DatabaseSync

  constructor(filename: string) {
    this.#database = new DatabaseSync(filename, {
      timeout: 5000,
      enableForeignKeyConstraints: true
    })
    initializeServerDatabase(this.#database)
  }

  listLibraries(): Library[] {
    const rows = this.#database
      .prepare(
        `SELECT l.id, l.name, l.first_url, l.hostname, l.scope_path, l.page_limit, l.schedule,
          COUNT(d.id) AS page_count, l.last_crawled_at, l.last_error,
          s.revision, s.published_at
        FROM libraries l
        LEFT JOIN documents d ON d.library_id = l.id
        LEFT JOIN library_snapshots s ON s.library_id = l.id
        GROUP BY l.id
        ORDER BY l.updated_at DESC`
      )
      .all() as unknown as LibraryRow[]
    return rows.map(toLibrary)
  }

  listPublishedLibraries(): PublicLibrary[] {
    const rows = this.#database
      .prepare(
        `SELECT l.id, l.name, l.first_url, l.last_crawled_at,
          s.revision, s.published_at, s.page_count, s.byte_size
        FROM libraries l
        JOIN library_snapshots s ON s.library_id = l.id
        WHERE s.page_count > 0
        ORDER BY l.name COLLATE NOCASE ASC`
      )
      .all() as unknown as PublicLibraryRow[]
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      url: row.first_url,
      revision: row.revision,
      pages: Number(row.page_count),
      contentSize: Number(row.byte_size),
      lastCrawledAt: row.last_crawled_at,
      publishedAt: row.published_at
    }))
  }

  getLibrary(id: string): Library {
    const library = this.listLibraries().find((item) => item.id === id)
    if (!library) throw new NotFoundError('文档库不存在')
    return library
  }

  createLibrary(input: LibraryInput): Library {
    const url = normalizeUrl(input.url)
    const hostname = getHostname(url)
    const scopePath = normalizeLibraryScope(url, hostname, input.scopePath)
    if (
      this.#database
        .prepare('SELECT 1 FROM libraries WHERE hostname = ? AND scope_path = ?')
        .get(hostname, scopePath)
    ) {
      throw new ConflictError('这个域名和收录范围已经存在于服务器文档库中')
    }
    const id = randomUUID()
    const now = new Date().toISOString()
    this.#database
      .prepare(
        `INSERT INTO libraries
          (id, name, first_url, hostname, scope_path, page_limit, schedule, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.name.trim(),
        url,
        hostname,
        scopePath,
        input.pageLimit,
        input.schedule,
        now,
        now
      )
    return this.getLibrary(id)
  }

  updateLibrary(id: string, input: LibraryInput): Library {
    const current = this.getLibrary(id)
    const url = normalizeUrl(input.url)
    const hostname = getHostname(url)
    const scopePath = normalizeLibraryScope(url, hostname, input.scopePath)
    const duplicate = this.#database
      .prepare('SELECT id FROM libraries WHERE hostname = ? AND scope_path = ? AND id <> ?')
      .get(hostname, scopePath, id)
    if (duplicate) throw new ConflictError('这个域名和收录范围已经存在于服务器文档库中')

    transaction(this.#database, () => {
      this.#database
        .prepare(
          `UPDATE libraries SET name = ?, first_url = ?, hostname = ?, scope_path = ?,
            page_limit = ?, schedule = ?, updated_at = ? WHERE id = ?`
        )
        .run(
          input.name.trim(),
          url,
          hostname,
          scopePath,
          input.pageLimit,
          input.schedule,
          new Date().toISOString(),
          id
        )
      if (current.url !== url || current.hostname !== hostname) {
        this.#database.prepare('DELETE FROM documents WHERE library_id = ?').run(id)
      } else if (current.scopePath !== scopePath) {
        this.deleteDocumentsOutsideScope(id, hostname, scopePath)
      }
    })
    return this.getLibrary(id)
  }

  deleteLibrary(id: string): void {
    const result = this.#database.prepare('DELETE FROM libraries WHERE id = ?').run(id)
    if (Number(result.changes) === 0) throw new NotFoundError('文档库不存在')
  }

  listDocumentUrls(libraryId: string): string[] {
    return (
      this.#database
        .prepare('SELECT url FROM documents WHERE library_id = ? ORDER BY url')
        .all(libraryId) as unknown as { url: string }[]
    ).map((row) => row.url)
  }

  saveDocument(libraryId: string, document: CrawledDocument): void {
    this.#database
      .prepare(
        `INSERT INTO documents
          (id, library_id, title, url, language, markdown, crawled_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(library_id, url) DO UPDATE SET
          title = excluded.title,
          language = excluded.language,
          markdown = excluded.markdown,
          crawled_at = excluded.crawled_at`
      )
      .run(
        randomUUID(),
        libraryId,
        document.title,
        document.url,
        document.language,
        document.markdown,
        document.crawledAt
      )
  }

  deleteDocument(libraryId: string, url: string): void {
    this.#database
      .prepare('DELETE FROM documents WHERE library_id = ? AND url = ?')
      .run(libraryId, url)
  }

  deleteDocumentsOutsideScope(libraryId: string, hostname: string, scopePath: string): number {
    const rows = this.#database
      .prepare('SELECT url FROM documents WHERE library_id = ?')
      .all(libraryId) as unknown as Array<{ url: string }>
    const statement = this.#database.prepare(
      'DELETE FROM documents WHERE library_id = ? AND url = ?'
    )
    let removed = 0
    for (const row of rows) {
      if (isUrlInScope(row.url, hostname, scopePath)) continue
      removed += Number(statement.run(libraryId, row.url).changes)
    }
    return removed
  }

  finishCrawl(libraryId: string, error: string | null): void {
    this.#database
      .prepare(
        'UPDATE libraries SET last_crawled_at = ?, last_error = ?, updated_at = ? WHERE id = ?'
      )
      .run(new Date().toISOString(), error, new Date().toISOString(), libraryId)
  }

  publishSnapshot(libraryId: string): LibrarySnapshot {
    const library = this.getLibrary(libraryId)
    const documents = this.#database
      .prepare(
        `SELECT id, title, url, language, markdown FROM documents
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
    const current = this.#database
      .prepare('SELECT revision, content FROM library_snapshots WHERE library_id = ?')
      .get(libraryId) as unknown as SnapshotRow | undefined
    if (current?.revision === revision) {
      this.#database
        .prepare('UPDATE library_snapshots SET byte_size = ? WHERE library_id = ?')
        .run(contentSize, libraryId)
      return JSON.parse(current.content) as LibrarySnapshot
    }

    const publishedAt = new Date().toISOString()
    const snapshot: LibrarySnapshot = {
      ...payload,
      library: { ...payload.library, revision, publishedAt }
    }
    const content = JSON.stringify(snapshot)
    // ponytail: 单库整包快照受 10,000 页上限保护；超出实际内存预算后再改为对象存储流式发布。
    this.#database
      .prepare(
        `INSERT INTO library_snapshots
          (library_id, revision, published_at, page_count, byte_size, content)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(library_id) DO UPDATE SET
          revision = excluded.revision,
          published_at = excluded.published_at,
          page_count = excluded.page_count,
          byte_size = excluded.byte_size,
          content = excluded.content`
      )
      .run(libraryId, revision, publishedAt, documents.length, contentSize, content)
    return snapshot
  }

  getSnapshot(libraryId: string): { revision: string; content: string } {
    const row = this.#database
      .prepare('SELECT revision, content FROM library_snapshots WHERE library_id = ?')
      .get(libraryId) as unknown as SnapshotRow | undefined
    if (!row) throw new NotFoundError('文档库尚未发布')
    return row
  }

  close(): void {
    this.#database.close()
  }
}

function toLibrary(row: LibraryRow): Library {
  return {
    id: row.id,
    name: row.name,
    url: row.first_url,
    hostname: row.hostname,
    scopePath: row.scope_path,
    pageLimit: Number(row.page_limit),
    schedule: row.schedule,
    pages: Number(row.page_count),
    lastCrawledAt: row.last_crawled_at,
    lastError: row.last_error,
    revision: row.revision,
    publishedAt: row.published_at
  }
}

function normalizeLibraryScope(url: string, hostname: string, input: string): string {
  const scopePath = normalizeScopePath(input)
  if (!isUrlInScope(url, hostname, scopePath)) {
    throw new ConflictError('收录范围必须包含第一个页面')
  }
  return scopePath
}

function transaction(database: DatabaseSync, action: () => void): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    action()
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
