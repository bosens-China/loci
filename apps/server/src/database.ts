import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { getHostname, isUrlInScope, normalizeUrl } from '@loci/core'
import type { CrawledDocument, CrawlFailure, CrawlProgress } from '@loci/core'
import { and, eq, gt, inArray, ne, sql } from 'drizzle-orm'
import type { Library, LibraryInput, LibrarySnapshot, PublicLibrary } from './types.js'
import { initializeServerDatabase } from './database-schema.js'
import { createServerDrizzleDatabase, type ServerDrizzleDatabase } from './drizzle-database.js'
import {
  libraries,
  librarySnapshots,
  serverDocuments,
  syncJobs as syncJobsTable
} from './drizzle-schema.js'
import { normalizeLibraryScope } from './library-input.js'
import { selectLibraries } from './library-query.js'
import {
  createServerHostnamePolicyDatabase,
  type ServerHostnamePolicyDatabase
} from './hostname-policy-database.js'
import { listServerLibraryFiles, readServerLibraryFile } from './library-browser-database.js'
import { publishImportedLibrary } from './library-publish-database.js'
import type { LibraryPublishPayload } from '@loci/core'
import { ConflictError, NotFoundError } from './database-errors.js'
import {
  checkpointSyncJob,
  finishPartialSyncJob,
  readSyncJobResumeUrls,
  releasePausedSyncJob,
  requestSyncJobPause,
  requestSyncJobStop,
  resumeSyncJob,
  setSyncJobPriority
} from './sync-job-control-database.js'
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

/** 服务端 SQLite 是抓取工作区和公开快照的唯一权威存储。 */
export class ServerDatabase {
  readonly #database: DatabaseSync
  readonly #drizzle: ServerDrizzleDatabase
  readonly hostnamePolicies: ServerHostnamePolicyDatabase

  constructor(filename: string) {
    this.#database = new DatabaseSync(filename, {
      timeout: 5000,
      enableForeignKeyConstraints: true
    })
    initializeServerDatabase(this.#database)
    this.#drizzle = createServerDrizzleDatabase(this.#database)
    this.hostnamePolicies = createServerHostnamePolicyDatabase(this.#drizzle)
  }

  listLibraries(): Library[] {
    return selectLibraries(this.#drizzle)
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
    pause: (id: string) => requestSyncJobPause(this.#database, id),
    resume: (id: string, ownerId: string, leaseExpiresAt: string) =>
      resumeSyncJob(this.#database, id, ownerId, leaseExpiresAt),
    stop: (id: string) => requestSyncJobStop(this.#database, id),
    setPriority: (id: string, priority: number) => setSyncJobPriority(this.#database, id, priority),
    checkpoint: (
      id: string,
      ownerId: string,
      progress: CrawlProgress,
      pendingUrls: readonly string[],
      contentBytes: number
    ) => checkpointSyncJob(this.#database, id, ownerId, progress, pendingUrls, contentBytes),
    releasePaused: (id: string, ownerId: string) =>
      releasePausedSyncJob(this.#database, id, ownerId),
    finishPartial: (
      id: string,
      ownerId: string,
      progress: CrawlProgress | null,
      contentBytes: number
    ) => finishPartialSyncJob(this.#database, id, ownerId, progress, contentBytes),
    getResumeUrls: (id: string) => readSyncJobResumeUrls(this.#database, id),
    expire: () => expireSyncJobLeases(this.#database)
  }

  listPublishedLibraries(): PublicLibrary[] {
    return this.#drizzle
      .select({
        id: libraries.id,
        name: libraries.name,
        url: libraries.firstUrl,
        lastCrawledAt: libraries.lastCrawledAt,
        revision: librarySnapshots.revision,
        publishedAt: librarySnapshots.publishedAt,
        pages: librarySnapshots.pageCount,
        contentSize: librarySnapshots.byteSize
      })
      .from(libraries)
      .innerJoin(librarySnapshots, eq(librarySnapshots.libraryId, libraries.id))
      .where(gt(librarySnapshots.pageCount, 0))
      .orderBy(sql`${libraries.name} COLLATE NOCASE ASC`)
      .all()
  }

  getLibrary(id: string): Library {
    const library = selectLibraries(this.#drizzle, id)[0]
    if (!library) throw new NotFoundError('文档库不存在')
    return library
  }

  createLibrary(input: LibraryInput): Library {
    const url = normalizeUrl(input.url)
    const hostname = getHostname(url)
    const scopePath = normalizeLibraryScope(url, hostname, input.scopePath)
    const existing = this.#drizzle
      .select({ id: libraries.id })
      .from(libraries)
      .where(and(eq(libraries.hostname, hostname), eq(libraries.scopePath, scopePath)))
      .get()
    if (existing) return this.getLibrary(existing.id)
    const id = randomUUID()
    const now = new Date().toISOString()
    try {
      this.#drizzle
        .insert(libraries)
        .values({
          id,
          name: input.name.trim(),
          firstUrl: url,
          hostname,
          scopePath,
          pageLimit: input.pageLimit,
          schedule: input.schedule,
          createdAt: now,
          updatedAt: now
        })
        .run()
    } catch (error) {
      const duplicate = this.#drizzle
        .select({ id: libraries.id })
        .from(libraries)
        .where(and(eq(libraries.hostname, hostname), eq(libraries.scopePath, scopePath)))
        .get()
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
    const duplicate = this.#drizzle
      .select({ id: libraries.id })
      .from(libraries)
      .where(
        and(
          eq(libraries.hostname, hostname),
          eq(libraries.scopePath, scopePath),
          ne(libraries.id, id)
        )
      )
      .get()
    if (duplicate) throw new ConflictError('这个域名和收录范围已经存在于服务器文档库中')

    transaction(this.#database, () => {
      this.assertLibraryIdle(id)
      const resetGithubState = current.url !== url || current.pageLimit !== input.pageLimit
      this.#drizzle
        .update(libraries)
        .set({
          name: input.name.trim(),
          firstUrl: url,
          hostname,
          scopePath,
          pageLimit: input.pageLimit,
          schedule: input.schedule,
          ...(resetGithubState
            ? {
                githubRevision: null,
                githubBlockedRevision: null,
                githubBlockedLimitKind: null,
                githubBlockedLimitBytes: null
              }
            : {}),
          updatedAt: new Date().toISOString()
        })
        .where(eq(libraries.id, id))
        .run()
      if (current.url !== url || current.hostname !== hostname) {
        this.#drizzle.delete(serverDocuments).where(eq(serverDocuments.libraryId, id)).run()
      } else if (current.scopePath !== scopePath) {
        this.deleteDocumentsOutsideScope(id, hostname, scopePath)
      }
    })
    return this.getLibrary(id)
  }

  deleteLibrary(id: string): void {
    transaction(this.#database, () => {
      const existing = this.#drizzle
        .select({ id: libraries.id })
        .from(libraries)
        .where(eq(libraries.id, id))
        .get()
      if (!existing) return
      this.assertLibraryIdle(id)
      this.#drizzle.delete(libraries).where(eq(libraries.id, id)).run()
    })
  }

  private assertLibraryIdle(id: string): void {
    const active = this.#drizzle
      .select({ id: syncJobsTable.id })
      .from(syncJobsTable)
      .where(
        and(
          eq(syncJobsTable.libraryId, id),
          inArray(syncJobsTable.status, ['queued', 'running', 'canceling'])
        )
      )
      .limit(1)
      .get()
    if (active) throw new ConflictError('同步期间不能修改或删除文档库')
  }

  listDocumentUrls(libraryId: string): string[] {
    return listServerDocumentUrls(this.#database, libraryId)
  }

  listLibraryFiles(libraryId: string, offset?: number, limit?: number) {
    this.getLibrary(libraryId)
    return listServerLibraryFiles(this.#drizzle, libraryId, offset, limit)
  }

  readLibraryFile(libraryId: string, fileId: string, offset?: number, maxChars?: number) {
    this.getLibrary(libraryId)
    return readServerLibraryFile(this.#drizzle, libraryId, fileId, offset, maxChars)
  }

  publishImportedLibrary(payload: LibraryPublishPayload) {
    return publishImportedLibrary(this.#database, this.#drizzle, payload)
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
    const ids = this.#drizzle
      .select({ id: serverDocuments.id, url: serverDocuments.url })
      .from(serverDocuments)
      .where(eq(serverDocuments.libraryId, libraryId))
      .all()
      .filter((row) => !isUrlInScope(row.url, hostname, scopePath))
      .map((row) => row.id)
    if (!ids.length) return 0
    return Number(
      this.#drizzle.delete(serverDocuments).where(inArray(serverDocuments.id, ids)).run().changes
    )
  }

  finishCrawl(libraryId: string, error: string | null): void {
    const now = new Date().toISOString()
    this.#drizzle
      .update(libraries)
      .set({ lastCrawledAt: now, lastError: error, updatedAt: now })
      .where(eq(libraries.id, libraryId))
      .run()
  }

  updateGithubRevision(libraryId: string, revision: string): void {
    this.#drizzle
      .update(libraries)
      .set({
        githubRevision: revision,
        githubBlockedRevision: null,
        githubBlockedLimitKind: null,
        githubBlockedLimitBytes: null,
        updatedAt: new Date().toISOString()
      })
      .where(eq(libraries.id, libraryId))
      .run()
  }

  updateGithubBlocked(
    libraryId: string,
    blocked: { revision: string; kind: 'archive' | 'markdown'; limitBytes: number }
  ): void {
    this.#drizzle
      .update(libraries)
      .set({
        githubBlockedRevision: blocked.revision,
        githubBlockedLimitKind: blocked.kind,
        githubBlockedLimitBytes: blocked.limitBytes,
        updatedAt: new Date().toISOString()
      })
      .where(eq(libraries.id, libraryId))
      .run()
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
