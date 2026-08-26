import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { getHostname, isUrlInScope, normalizeUrl } from '@loci/core'
import type { CrawledDocument, CrawlFailure, CrawlProgress } from '@loci/core'
import type { Library, LibraryInput, LibrarySnapshot, PublicLibrary } from './types.js'
import { initializeServerDatabase } from './database-schema.js'
import { normalizeLibraryScope } from './library-input.js'
import { ConflictError, NotFoundError } from './database-errors.js'
import {
  expireSyncJobLeases,
  finishSyncJob,
  getOrCreateSyncJob,
  getSyncJob,
  heartbeatSyncJob,
  isLibrarySyncActive,
  listSyncJobs,
  markSyncJobRunning,
  requestSyncJobCancel
} from './sync-job-database.js'
import {
  commitServerCrawl,
  deleteServerDocument,
  getServerSnapshot,
  listServerDocumentUrls,
  publishServerSnapshot,
  replaceServerDocuments,
  saveServerDocument,
  type CrawlCommit
} from './server-document-database.js'
import { withImmediateTransaction as transaction } from './sqlite.js'

export { ConflictError, NotFoundError } from './database-errors.js'

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
  github_revision: string | null
  github_blocked_revision: string | null
  github_blocked_limit_kind: 'archive' | 'markdown' | null
  github_blocked_limit_bytes: number | null
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
          l.github_revision, l.github_blocked_revision, l.github_blocked_limit_kind,
          l.github_blocked_limit_bytes,
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

  readonly syncJobs = {
    getOrCreate: (libraryId: string, ownerId: string, leaseExpiresAt: string) =>
      getOrCreateSyncJob(this.#database, libraryId, ownerId, leaseExpiresAt),
    list: () => listSyncJobs(this.#database),
    get: (id: string) => getSyncJob(this.#database, id),
    isLibraryActive: (libraryId: string) => isLibrarySyncActive(this.#database, libraryId),
    markRunning: (id: string, ownerId: string, leaseExpiresAt: string) =>
      markSyncJobRunning(this.#database, id, ownerId, leaseExpiresAt),
    heartbeat: (
      id: string,
      ownerId: string,
      leaseExpiresAt: string,
      progress?: CrawlProgress | null
    ) => heartbeatSyncJob(this.#database, id, ownerId, leaseExpiresAt, progress),
    finish: (
      id: string,
      ownerId: string,
      status: 'canceled' | 'completed' | 'completed_with_errors' | 'failed',
      progress: CrawlProgress | null,
      failures: CrawlFailure[],
      error: string | null
    ) => finishSyncJob(this.#database, id, ownerId, status, progress, failures, error),
    cancel: (id: string) => requestSyncJobCancel(this.#database, id),
    expire: () => expireSyncJobLeases(this.#database)
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
    const existing = this.#database
      .prepare('SELECT id FROM libraries WHERE hostname = ? AND scope_path = ?')
      .get(hostname, scopePath) as unknown as { id: string } | undefined
    if (existing) return this.getLibrary(existing.id)
    const id = randomUUID()
    const now = new Date().toISOString()
    try {
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
    } catch (error) {
      const duplicate = this.#database
        .prepare('SELECT id FROM libraries WHERE hostname = ? AND scope_path = ?')
        .get(hostname, scopePath) as unknown as { id: string } | undefined
      if (duplicate) return this.getLibrary(duplicate.id)
      throw error
    }
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
      this.assertLibraryIdle(id)
      this.#database
        .prepare(
          `UPDATE libraries SET name = ?, first_url = ?, hostname = ?, scope_path = ?,
            page_limit = ?, schedule = ?, github_revision = CASE WHEN ? THEN NULL ELSE github_revision END,
            github_blocked_revision = CASE WHEN ? THEN NULL ELSE github_blocked_revision END,
            github_blocked_limit_kind = CASE WHEN ? THEN NULL ELSE github_blocked_limit_kind END,
            github_blocked_limit_bytes = CASE WHEN ? THEN NULL ELSE github_blocked_limit_bytes END,
            updated_at = ? WHERE id = ?`
        )
        .run(
          input.name.trim(),
          url,
          hostname,
          scopePath,
          input.pageLimit,
          input.schedule,
          current.url !== url || current.pageLimit !== input.pageLimit ? 1 : 0,
          current.url !== url || current.pageLimit !== input.pageLimit ? 1 : 0,
          current.url !== url || current.pageLimit !== input.pageLimit ? 1 : 0,
          current.url !== url || current.pageLimit !== input.pageLimit ? 1 : 0,
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
    transaction(this.#database, () => {
      const existing = this.#database.prepare('SELECT 1 FROM libraries WHERE id = ?').get(id)
      if (!existing) return
      this.assertLibraryIdle(id)
      this.#database.prepare('DELETE FROM libraries WHERE id = ?').run(id)
    })
  }

  private assertLibraryIdle(id: string): void {
    const active = this.#database
      .prepare(
        `SELECT 1 FROM sync_jobs WHERE library_id = ?
         AND status IN ('queued', 'running', 'canceling') LIMIT 1`
      )
      .get(id)
    if (active) throw new ConflictError('同步期间不能修改或删除文档库')
  }

  listDocumentUrls(libraryId: string): string[] {
    return listServerDocumentUrls(this.#database, libraryId)
  }

  saveDocument(libraryId: string, document: CrawledDocument): void {
    saveServerDocument(this.#database, libraryId, document)
  }

  replaceDocuments(libraryId: string, documents: CrawledDocument[]): void {
    replaceServerDocuments(this.#database, libraryId, documents)
  }

  deleteDocument(libraryId: string, url: string): void {
    deleteServerDocument(this.#database, libraryId, url)
  }

  /** 工作文档、成功提交和公开快照使用同一个事务提交。 */
  commitCrawl(libraryId: string, commit: CrawlCommit): LibrarySnapshot {
    return commitServerCrawl(this.#database, libraryId, commit, (id) => this.getLibrary(id))
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

  updateGithubRevision(libraryId: string, revision: string): void {
    this.#database
      .prepare(
        `UPDATE libraries SET github_revision = ?, github_blocked_revision = NULL,
          github_blocked_limit_kind = NULL, github_blocked_limit_bytes = NULL, updated_at = ?
         WHERE id = ?`
      )
      .run(revision, new Date().toISOString(), libraryId)
  }

  updateGithubBlocked(
    libraryId: string,
    blocked: { revision: string; kind: 'archive' | 'markdown'; limitBytes: number }
  ): void {
    this.#database
      .prepare(
        `UPDATE libraries SET github_blocked_revision = ?, github_blocked_limit_kind = ?,
          github_blocked_limit_bytes = ?, updated_at = ? WHERE id = ?`
      )
      .run(blocked.revision, blocked.kind, blocked.limitBytes, new Date().toISOString(), libraryId)
  }

  publishSnapshot(libraryId: string): LibrarySnapshot {
    return publishServerSnapshot(this.#database, libraryId, (id) => this.getLibrary(id))
  }

  getSnapshot(libraryId: string): { revision: string; content: string } {
    return getServerSnapshot(this.#database, libraryId)
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
    publishedAt: row.published_at,
    githubRevision: row.github_revision,
    githubBlocked:
      row.github_blocked_revision &&
      row.github_blocked_limit_kind &&
      row.github_blocked_limit_bytes !== null
        ? {
            revision: row.github_blocked_revision,
            kind: row.github_blocked_limit_kind,
            limitBytes: Number(row.github_blocked_limit_bytes)
          }
        : null
  }
}
