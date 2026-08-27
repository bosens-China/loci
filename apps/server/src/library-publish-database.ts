import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { getHostname, normalizeUrl, type LibraryPublishPayload } from '@loci/core'
import { and, eq, inArray, ne } from 'drizzle-orm'
import type { ServerDrizzleDatabase } from './drizzle-database.js'
import { ConflictError, NotFoundError } from './database-errors.js'
import { libraries, publishRequests, serverDocuments, syncJobs } from './drizzle-schema.js'
import { normalizeLibraryScope } from './library-input.js'
import { selectLibraries } from './library-query.js'
import { publishServerSnapshot, saveServerDocument } from './server-document-database.js'
import { withImmediateTransaction } from './sqlite.js'
import type { Library, LibrarySnapshot } from './types.js'

export interface ServerPublishResult {
  library: Library
  snapshot: LibrarySnapshot
  reused: boolean
}

/** 发布 ID 与全部替换、快照切换在同一个 IMMEDIATE 事务内完成。 */
export function publishImportedLibrary(
  database: DatabaseSync,
  drizzle: ServerDrizzleDatabase,
  payload: LibraryPublishPayload
): ServerPublishResult {
  return withImmediateTransaction(database, () => {
    const previous = drizzle
      .select()
      .from(publishRequests)
      .where(eq(publishRequests.publishId, payload.publishId))
      .get()
    if (previous) {
      if (previous.checksum !== payload.checksum)
        throw new ConflictError('发布 ID 的内容校验不一致')
      return existingResult(database, drizzle, previous.libraryId)
    }

    const url = normalizeUrl(payload.source.url)
    const hostname = getHostname(url)
    const scopePath = normalizeLibraryScope(url, hostname, payload.source.scopePath)
    const libraryId =
      payload.mode === 'replace' ? requireTarget(payload.targetLibraryId) : randomUUID()
    assertIdleAndUnique(drizzle, libraryId, hostname, scopePath, payload.mode)
    const now = new Date().toISOString()
    if (payload.mode === 'create') {
      drizzle
        .insert(libraries)
        .values({
          id: libraryId,
          name: payload.source.name,
          firstUrl: url,
          hostname,
          scopePath,
          pageLimit: payload.source.pageLimit,
          schedule: null,
          createdAt: now,
          updatedAt: now
        })
        .run()
    } else {
      drizzle
        .update(libraries)
        .set({
          name: payload.source.name,
          firstUrl: url,
          hostname,
          scopePath,
          pageLimit: payload.source.pageLimit,
          lastCrawledAt: now,
          lastError: null,
          updatedAt: now
        })
        .where(eq(libraries.id, libraryId))
        .run()
    }

    drizzle.delete(serverDocuments).where(eq(serverDocuments.libraryId, libraryId)).run()
    for (const document of payload.documents) {
      saveServerDocument(database, libraryId, {
        url: document.url,
        title: document.title,
        language: document.language,
        markdown: document.markdown,
        crawledAt: document.crawledAt,
        fetchMode: 'http',
        ...(document.relativePath ? { relativePath: document.relativePath } : {})
      })
    }
    drizzle
      .update(libraries)
      .set({ lastCrawledAt: now, lastError: null, updatedAt: now })
      .where(eq(libraries.id, libraryId))
      .run()
    const snapshot = publishServerSnapshot(database, libraryId, (id) => readLibrary(drizzle, id))
    drizzle
      .insert(publishRequests)
      .values({
        publishId: payload.publishId,
        checksum: payload.checksum,
        libraryId,
        revision: snapshot.library.revision,
        createdAt: now
      })
      .run()
    return { library: readLibrary(drizzle, libraryId), snapshot, reused: false }
  })
}

function assertIdleAndUnique(
  database: ServerDrizzleDatabase,
  id: string,
  hostname: string,
  scopePath: string,
  mode: 'create' | 'replace'
): void {
  if (mode === 'replace') {
    readLibrary(database, id)
    const active = database
      .select({ id: syncJobs.id })
      .from(syncJobs)
      .where(
        and(
          eq(syncJobs.libraryId, id),
          inArray(syncJobs.status, ['queued', 'running', 'canceling'])
        )
      )
      .get()
    if (active) throw new ConflictError('同步期间不能覆盖发布文档库')
  }
  const duplicate = database
    .select({ id: libraries.id })
    .from(libraries)
    .where(
      and(
        eq(libraries.hostname, hostname),
        eq(libraries.scopePath, scopePath),
        ...(mode === 'replace' ? [ne(libraries.id, id)] : [])
      )
    )
    .get()
  if (duplicate) throw new ConflictError('目标范围已经存在；请选择显式覆盖该 Server 文档库')
}

function existingResult(
  database: DatabaseSync,
  drizzle: ServerDrizzleDatabase,
  libraryId: string
): ServerPublishResult {
  const snapshot = publishServerSnapshot(database, libraryId, (id) => readLibrary(drizzle, id))
  return { library: readLibrary(drizzle, libraryId), snapshot, reused: true }
}

function readLibrary(database: ServerDrizzleDatabase, id: string): Library {
  const library = selectLibraries(database, id)[0]
  if (!library) throw new NotFoundError('目标 Server 文档库不存在')
  return library
}

function requireTarget(value: string | null): string {
  if (!value) throw new ConflictError('覆盖发布必须明确指定目标 Server 文档库')
  return value
}
