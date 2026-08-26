import { count, desc, eq } from 'drizzle-orm'
import type { ServerDrizzleDatabase } from './drizzle-database.js'
import { libraries, librarySnapshots, serverDocuments } from './drizzle-schema.js'
import type { Library } from './types.js'

interface LibraryRow {
  id: string
  name: string
  firstUrl: string
  hostname: string
  scopePath: string
  pageLimit: number
  schedule: string | null
  pageCount: number
  lastCrawledAt: string | null
  lastError: string | null
  revision: string | null
  publishedAt: string | null
  githubRevision: string | null
  githubBlockedRevision: string | null
  githubBlockedLimitKind: 'archive' | 'markdown' | null
  githubBlockedLimitBytes: number | null
}

const librarySelection = {
  id: libraries.id,
  name: libraries.name,
  firstUrl: libraries.firstUrl,
  hostname: libraries.hostname,
  scopePath: libraries.scopePath,
  pageLimit: libraries.pageLimit,
  schedule: libraries.schedule,
  pageCount: count(serverDocuments.id),
  lastCrawledAt: libraries.lastCrawledAt,
  lastError: libraries.lastError,
  githubRevision: libraries.githubRevision,
  githubBlockedRevision: libraries.githubBlockedRevision,
  githubBlockedLimitKind: libraries.githubBlockedLimitKind,
  githubBlockedLimitBytes: libraries.githubBlockedLimitBytes,
  revision: librarySnapshots.revision,
  publishedAt: librarySnapshots.publishedAt
}

export function selectLibraries(database: ServerDrizzleDatabase, id?: string): Library[] {
  const rows = database
    .select(librarySelection)
    .from(libraries)
    .leftJoin(serverDocuments, eq(serverDocuments.libraryId, libraries.id))
    .leftJoin(librarySnapshots, eq(librarySnapshots.libraryId, libraries.id))
    .where(id ? eq(libraries.id, id) : undefined)
    .groupBy(libraries.id)
    .orderBy(desc(libraries.updatedAt))
    .all()
  return rows.map(toLibrary)
}

function toLibrary(row: LibraryRow): Library {
  return {
    id: row.id,
    name: row.name,
    url: row.firstUrl,
    hostname: row.hostname,
    scopePath: row.scopePath,
    pageLimit: row.pageLimit,
    schedule: row.schedule,
    pages: row.pageCount,
    lastCrawledAt: row.lastCrawledAt,
    lastError: row.lastError,
    revision: row.revision,
    publishedAt: row.publishedAt,
    githubRevision: row.githubRevision,
    githubBlocked:
      row.githubBlockedRevision &&
      row.githubBlockedLimitKind &&
      row.githubBlockedLimitBytes !== null
        ? {
            revision: row.githubBlockedRevision,
            kind: row.githubBlockedLimitKind,
            limitBytes: row.githubBlockedLimitBytes
          }
        : null
  }
}
