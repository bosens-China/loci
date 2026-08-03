import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { getHostname, normalizeUrl } from './crawl/url'

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
export function createCloudLibraryDatabase(database: DatabaseSync): CloudLibraryDatabase {
  const findCloudSource = (serverUrl: string, libraryId: string): CloudSourceRecord | null => {
    const row = database
      .prepare(
        `SELECT id, cloud_server_url, cloud_library_id, cloud_revision, cloud_auto_sync
         FROM document_sources
         WHERE source_type = 'cloud' AND cloud_server_url = ? AND cloud_library_id = ?`
      )
      .get(serverUrl, libraryId) as unknown as CloudSourceRow | undefined
    return row ? toCloudSource(row) : null
  }

  return {
    findCloudSource,
    getCloudSource: (sourceId) => {
      const row = database
        .prepare(
          `SELECT id, cloud_server_url, cloud_library_id, cloud_revision, cloud_auto_sync
           FROM document_sources WHERE id = ? AND source_type = 'cloud'`
        )
        .get(sourceId) as unknown as CloudSourceRow | undefined
      if (!row) throw new Error('云文档本地副本不存在')
      return toCloudSource(row)
    },
    listCloudSourcesForSync: (serverUrl) =>
      (
        database
          .prepare(
            `SELECT id, cloud_server_url, cloud_library_id, cloud_revision, cloud_auto_sync
             FROM document_sources
             WHERE source_type = 'cloud' AND cloud_server_url = ? AND cloud_auto_sync = 1`
          )
          .all(serverUrl) as unknown as CloudSourceRow[]
      ).map(toCloudSource),
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
                 cloud_auto_sync = ?, updated_at = ? WHERE id = ?`
            )
            .run(
              snapshot.library.name,
              url,
              getHostname(url),
              Math.max(1, snapshot.documents.length),
              snapshot.library.revision,
              Number(autoSync),
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
                cloud_library_id, cloud_revision, cloud_auto_sync, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'http', ?, NULL, NULL, NULL, NULL, 'cloud', ?, ?, ?, ?, ?, ?)`
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
              now,
              now
            )
        }

        const insertDocument = database.prepare(
          `INSERT INTO documents
           (id, source_id, title, url, crawled_at, markdown, language, fetch_mode)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'http')`
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
            document.language
          )
          insertSearch.run(documentId, sourceId, document.title, document.markdown)
        }
      })
      return { sourceId, updated: true }
    },
    setCloudAutoSync: (sourceId, enabled) => {
      const result = database
        .prepare(
          `UPDATE document_sources SET cloud_auto_sync = ?, updated_at = ?
           WHERE id = ? AND source_type = 'cloud'`
        )
        .run(Number(enabled), new Date().toISOString(), sourceId)
      if (Number(result.changes) !== 1) throw new Error('云文档本地副本不存在')
    }
  }
}

interface CloudSourceRow {
  id: string
  cloud_server_url: string
  cloud_library_id: string
  cloud_revision: string
  cloud_auto_sync: number
}

function toCloudSource(row: CloudSourceRow): CloudSourceRecord {
  return {
    sourceId: row.id,
    serverUrl: row.cloud_server_url,
    libraryId: row.cloud_library_id,
    revision: row.cloud_revision,
    autoSync: Boolean(row.cloud_auto_sync)
  }
}

function transaction(database: DatabaseSync, work: () => void): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    work()
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
