import type { DatabaseSync } from 'node:sqlite'
import type { GithubBlockedState } from '@loci/core'
import { getHostname, normalizeUrl } from '@loci/core'
import type { DocumentSource } from '@loci/shared'
import { type SourceRow, toDocumentSource } from './database-values.js'

export interface SourceConfig {
  id: string
  firstUrl: string
  hostname: string
  fetchMode: 'auto' | 'http' | 'browser'
  pageLimit: number
  scopePath: string
  httpConcurrency: number | null
  browserConcurrency: number | null
  kind: 'web' | 'github'
  githubArchiveLimitMb: number | null
  githubMarkdownLimitMb: number | null
  githubDefaultBranch: string | null
  githubRevision: string | null
  githubBlocked: GithubBlockedState | null
}

interface SourceConfigRow {
  id: string
  first_url: string
  hostname: string
  fetch_mode: SourceConfig['fetchMode']
  page_limit: number
  scope_path: string
  http_concurrency: number | null
  browser_concurrency: number | null
  source_type: 'local' | 'cloud'
  document_kind: SourceConfig['kind']
  github_archive_limit_mb: number | null
  github_markdown_limit_mb: number | null
  github_default_branch: string | null
  github_revision: string | null
  github_blocked_revision: string | null
  github_blocked_limit_kind: 'archive' | 'markdown' | null
  github_blocked_limit_bytes: number | null
}

export function readSourceConfig(database: DatabaseSync, id: string): SourceConfig {
  const source = database
    .prepare(
      `SELECT id, first_url, hostname, fetch_mode, page_limit, scope_path, http_concurrency,
         browser_concurrency, source_type, document_kind, github_archive_limit_mb,
         github_markdown_limit_mb, github_default_branch, github_revision,
         github_blocked_revision, github_blocked_limit_kind, github_blocked_limit_bytes
       FROM document_sources WHERE id = ?`
    )
    .get(id) as unknown as SourceConfigRow | undefined
  if (!source) throw new Error('文档源不存在')
  if (source.source_type !== 'local') throw new Error('云文档只能从来源服务器更新')
  return {
    id: source.id,
    firstUrl: source.first_url,
    hostname: source.hostname,
    fetchMode: source.fetch_mode,
    pageLimit: Number(source.page_limit),
    scopePath: source.scope_path,
    httpConcurrency: source.http_concurrency === null ? null : Number(source.http_concurrency),
    browserConcurrency:
      source.browser_concurrency === null ? null : Number(source.browser_concurrency),
    kind: source.document_kind,
    githubArchiveLimitMb:
      source.github_archive_limit_mb === null ? null : Number(source.github_archive_limit_mb),
    githubMarkdownLimitMb:
      source.github_markdown_limit_mb === null ? null : Number(source.github_markdown_limit_mb),
    githubDefaultBranch: source.github_default_branch,
    githubRevision: source.github_revision,
    githubBlocked:
      source.github_blocked_revision &&
      source.github_blocked_limit_kind &&
      source.github_blocked_limit_bytes !== null
        ? {
            revision: source.github_blocked_revision,
            kind: source.github_blocked_limit_kind,
            limitBytes: Number(source.github_blocked_limit_bytes)
          }
        : null
  }
}

export function assertLocalSourceIdentityAvailable(
  database: DatabaseSync,
  identity: string,
  github: boolean,
  excludedId?: string
): void {
  const duplicate = excludedId
    ? database
        .prepare(
          "SELECT 1 FROM document_sources WHERE source_identity = ? AND source_type = 'local' AND id <> ?"
        )
        .get(identity, excludedId)
    : database
        .prepare(
          "SELECT 1 FROM document_sources WHERE source_identity = ? AND source_type = 'local'"
        )
        .get(identity)
  if (duplicate) {
    throw new Error(github ? '这个 GitHub 仓库已经存在于文档源中' : '这个域名已经存在于文档源中')
  }
}

export function throwLocalHostnameConflict(error: unknown): never {
  if (
    error instanceof Error &&
    (error.message.includes('document_sources_local_hostname') ||
      error.message.includes('document_sources_local_identity') ||
      error.message.includes('UNIQUE constraint failed: document_sources.hostname'))
  ) {
    throw new Error('这个域名已经存在于文档源中')
  }
  throw error
}

export function withTransaction<T>(database: DatabaseSync, work: () => T): T {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function updateResolvedSourceRecord(
  database: DatabaseSync,
  id: string,
  firstUrl: string,
  mode: 'http' | 'browser',
  iconUrl: string | null,
  github?: { defaultBranch: string; revision: string }
): void {
  const url = normalizeUrl(firstUrl)
  database
    .prepare(
      `UPDATE document_sources
       SET first_url = ?, hostname = ?, fetch_mode = ?, icon_url = COALESCE(?, icon_url),
           source_identity = CASE WHEN document_kind = 'web' THEN ? ELSE source_identity END,
           github_default_branch = COALESCE(?, github_default_branch),
           github_revision = COALESCE(?, github_revision),
           github_blocked_revision = CASE WHEN ? IS NULL THEN github_blocked_revision ELSE NULL END,
           github_blocked_limit_kind = CASE WHEN ? IS NULL THEN github_blocked_limit_kind ELSE NULL END,
           github_blocked_limit_bytes = CASE WHEN ? IS NULL THEN github_blocked_limit_bytes ELSE NULL END,
           updated_at = ?
       WHERE id = ?`
    )
    .run(
      url,
      getHostname(url),
      mode,
      iconUrl,
      getHostname(url),
      github?.defaultBranch ?? null,
      github?.revision ?? null,
      github?.revision ?? null,
      github?.revision ?? null,
      github?.revision ?? null,
      new Date().toISOString(),
      id
    )
}

export function findLocalSourceId(database: DatabaseSync, identity: string): string | undefined {
  const row = database
    .prepare("SELECT id FROM document_sources WHERE source_identity = ? AND source_type = 'local'")
    .get(identity) as unknown as { id: string } | undefined
  return row?.id
}

export function readDocumentSource(database: DatabaseSync, id: string): DocumentSource {
  const row = database
    .prepare(
      `SELECT s.id, s.name, s.first_url, s.fetch_mode, s.page_limit, s.scope_path, s.schedule,
         s.http_concurrency, s.browser_concurrency, s.icon_url, s.source_type,
         s.cloud_server_url, s.cloud_library_id, s.cloud_revision, s.cloud_auto_sync,
         s.document_kind, s.github_archive_limit_mb, s.github_markdown_limit_mb,
         s.github_default_branch, s.github_revision,
         COUNT(d.id) AS page_count,
         COALESCE(SUM(length(CAST(d.markdown AS BLOB))), 0) AS content_size,
         MAX(d.crawled_at) AS last_crawled_at
       FROM document_sources s LEFT JOIN documents d ON d.source_id = s.id
       WHERE s.id = ? GROUP BY s.id`
    )
    .get(id) as unknown as SourceRow | undefined
  if (!row) throw new Error('文档源不存在')
  return toDocumentSource(row)
}
