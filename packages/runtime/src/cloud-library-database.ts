import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { getHostname, normalizeUrl, parseGithubRepositoryUrl } from '@loci/core'
import { and, eq } from 'drizzle-orm'
import type { LociDrizzleDatabase } from './drizzle-database.js'
import { documentSources } from './drizzle-schema.js'
import { withImmediateTransaction as transaction } from './sqlite.js'

export interface CloudSnapshot {
  schemaVersion: 1
  library: {
    id: string
    name: string
    url: string
    revision: string
    publishedAt: string
  }
  documents: Array<{
    title: string
    url: string
    language: string
    markdown: string
    relativePath?: string | null
  }>
}

export interface CloudSourceRecord {
  sourceId: string
  serverUrl: string
  libraryId: string
  revision: string
  autoSync: boolean
}

export interface CloudLibraryDatabase {
  findCloudSource: (serverUrl: string, libraryId: string) => CloudSourceRecord | null
  getCloudSource: (sourceId: string) => CloudSourceRecord
  listCloudSourcesForSync: (serverUrl: string) => CloudSourceRecord[]
  replaceCloudSnapshot: (
    serverUrl: string,
    snapshot: CloudSnapshot,
    autoSync: boolean
  ) => { sourceId: string; updated: boolean }
  setCloudAutoSync: (sourceId: string, enabled: boolean) => void
}

/** 云端快照使用现有文档表和 FTS，保证下载完成后本地浏览与 MCP 无需特殊分支。 */
export function createCloudLibraryDatabase(
  database: DatabaseSync,
  drizzleDatabase: LociDrizzleDatabase
): CloudLibraryDatabase {
  const findCloudSource = (serverUrl: string, libraryId: string): CloudSourceRecord | null => {
    const row = drizzleDatabase
      .select(cloudSourceSelection)
      .from(documentSources)
      .where(
        and(
          eq(documentSources.sourceType, 'cloud'),
          eq(documentSources.cloudServerUrl, serverUrl),
          eq(documentSources.cloudLibraryId, libraryId)
        )
      )
      .get()
    return row ? toCloudSource(row) : null
  }

  return {
    findCloudSource,
    getCloudSource: (sourceId) => {
      const row = drizzleDatabase
        .select(cloudSourceSelection)
        .from(documentSources)
        .where(and(eq(documentSources.id, sourceId), eq(documentSources.sourceType, 'cloud')))
        .get()
      if (!row) throw new Error('云文档本地副本不存在')
      return toCloudSource(row)
    },
    listCloudSourcesForSync: (serverUrl) =>
      drizzleDatabase
        .select(cloudSourceSelection)
        .from(documentSources)
        .where(
          and(
            eq(documentSources.sourceType, 'cloud'),
            eq(documentSources.cloudServerUrl, serverUrl),
            eq(documentSources.cloudAutoSync, 1)
          )
        )
        .all()
        .map(toCloudSource),
    replaceCloudSnapshot: (serverUrl, snapshot, autoSync) => {
      const existing = findCloudSource(serverUrl, snapshot.library.id)
      if (existing?.revision === snapshot.library.revision) {
        return { sourceId: existing.sourceId, updated: false }
      }
      const sourceId = existing?.sourceId ?? randomUUID()
      const url = normalizeUrl(snapshot.library.url)
      const now = new Date().toISOString()
      transaction(database, () => {
        if (existing) {
          database
            .prepare(
              `UPDATE document_sources
               SET name = ?, first_url = ?, hostname = ?, page_limit = ?, cloud_revision = ?,
                 cloud_auto_sync = ?, document_kind = ?, updated_at = ? WHERE id = ?`
            )
            .run(
              snapshot.library.name,
              url,
              getHostname(url),
              Math.max(1, snapshot.documents.length),
              snapshot.library.revision,
              Number(autoSync),
              parseGithubRepositoryUrl(url) ? 'github' : 'web',
              now,
              sourceId
            )
          database.prepare('DELETE FROM documents_fts WHERE source_id = ?').run(sourceId)
          database.prepare('DELETE FROM documents WHERE source_id = ?').run(sourceId)
        } else {
          database
            .prepare(
              `INSERT INTO document_sources
               (id, name, first_url, hostname, fetch_mode, page_limit, schedule,
                http_concurrency, browser_concurrency, icon_url, source_type, cloud_server_url,
                cloud_library_id, cloud_revision, cloud_auto_sync, document_kind, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'http', ?, NULL, NULL, NULL, NULL, 'cloud', ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              sourceId,
              snapshot.library.name,
              url,
              getHostname(url),
              Math.max(1, snapshot.documents.length),
              serverUrl,
              snapshot.library.id,
              snapshot.library.revision,
              Number(autoSync),
              parseGithubRepositoryUrl(url) ? 'github' : 'web',
              now,
              now
            )
        }

        const insertDocument = database.prepare(
          `INSERT INTO documents
           (id, source_id, title, url, crawled_at, markdown, language, fetch_mode, relative_path)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'http', ?)`
        )
        const insertSearch = database.prepare(
          'INSERT INTO documents_fts (document_id, source_id, title, markdown) VALUES (?, ?, ?, ?)'
        )
        for (const document of snapshot.documents) {
          const documentId = randomUUID()
          insertDocument.run(
            documentId,
            sourceId,
            document.title,
            document.url,
            snapshot.library.publishedAt,
            document.markdown,
            document.language,
            document.relativePath ?? null
          )
          insertSearch.run(documentId, sourceId, document.title, document.markdown)
        }
      })
      return { sourceId, updated: true }
    },
    setCloudAutoSync: (sourceId, enabled) => {
      const result = drizzleDatabase
        .update(documentSources)
        .set({ cloudAutoSync: Number(enabled), updatedAt: new Date().toISOString() })
        .where(and(eq(documentSources.id, sourceId), eq(documentSources.sourceType, 'cloud')))
        .run()
      if (Number(result.changes) !== 1) throw new Error('云文档本地副本不存在')
    }
  }
}

const cloudSourceSelection = {
  sourceId: documentSources.id,
  serverUrl: documentSources.cloudServerUrl,
  libraryId: documentSources.cloudLibraryId,
  revision: documentSources.cloudRevision,
  autoSync: documentSources.cloudAutoSync
}

interface CloudSourceRow {
  sourceId: string
  serverUrl: string | null
  libraryId: string | null
  revision: string | null
  autoSync: number
}

function toCloudSource(row: CloudSourceRow): CloudSourceRecord {
  if (!row.serverUrl || !row.libraryId || !row.revision) {
    throw new Error('云文档本地副本数据不完整')
  }
  return {
    sourceId: row.sourceId,
    serverUrl: row.serverUrl,
    libraryId: row.libraryId,
    revision: row.revision,
    autoSync: Boolean(row.autoSync)
  }
}
