import { Buffer } from 'node:buffer'
import type { LibraryFileRecord, LibraryFileSummary } from '@loci/shared'
import { and, asc, count, eq } from 'drizzle-orm'
import type { ServerDrizzleDatabase } from './drizzle-database.js'
import { serverDocuments } from './drizzle-schema.js'

export function listServerLibraryFiles(
  database: ServerDrizzleDatabase,
  libraryId: string,
  offset = 0,
  limit = 100
): { total: number; items: LibraryFileSummary[] } {
  const safeOffset = Math.max(0, Math.trunc(offset))
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)))
  const total =
    database
      .select({ value: count() })
      .from(serverDocuments)
      .where(eq(serverDocuments.libraryId, libraryId))
      .get()?.value ?? 0
  const rows = database
    .select({
      id: serverDocuments.id,
      libraryId: serverDocuments.libraryId,
      title: serverDocuments.title,
      url: serverDocuments.url,
      relativePath: serverDocuments.relativePath,
      language: serverDocuments.language,
      crawledAt: serverDocuments.crawledAt
    })
    .from(serverDocuments)
    .where(eq(serverDocuments.libraryId, libraryId))
    .orderBy(asc(serverDocuments.url))
    .limit(safeLimit)
    .offset(safeOffset)
    .all()
  return { total, items: rows.map(toSummary) }
}

export function readServerLibraryFile(
  database: ServerDrizzleDatabase,
  libraryId: string,
  fileId: string,
  offset = 0,
  maxChars = 20_000
): LibraryFileRecord | undefined {
  const row = database
    .select()
    .from(serverDocuments)
    .where(and(eq(serverDocuments.libraryId, libraryId), eq(serverDocuments.id, fileId)))
    .get()
  if (!row) return undefined
  const safeOffset = Math.max(0, Math.min(row.markdown.length, Math.trunc(offset)))
  const safeLimit = Math.max(1_000, Math.min(50_000, Math.trunc(maxChars)))
  const end = Math.min(row.markdown.length, safeOffset + safeLimit)
  return {
    ...toSummary(row),
    content: row.markdown.slice(safeOffset, end),
    contentBytes: Buffer.byteLength(row.markdown, 'utf8'),
    offset: safeOffset,
    ...(end < row.markdown.length ? { nextOffset: end } : {}),
    totalChars: row.markdown.length,
    truncated: end < row.markdown.length
  }
}

function toSummary(row: {
  id: string
  libraryId: string
  title: string
  url: string
  relativePath: string | null
  language: string
  crawledAt: string
}): LibraryFileSummary {
  return {
    id: row.id,
    libraryId: row.libraryId,
    title: row.title,
    url: row.url,
    path: row.relativePath ?? new URL(row.url).pathname,
    language: row.language,
    updatedAt: row.crawledAt
  }
}
