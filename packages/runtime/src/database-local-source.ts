import type { DatabaseSync } from 'node:sqlite'
import type { GithubBlockedState } from '@loci/core'
import { getHostname, normalizeScopePath, normalizeUrl } from '@loci/core'
import type { DocumentSource, ResolvedSourceDiscovery } from '@loci/shared'
import { and, count, desc, eq, max, ne, sql } from 'drizzle-orm'
import { toDocumentSource } from './database-values.js'
import type { LociDrizzleDatabase } from './drizzle-database.js'
import { documents, documentSources } from './drizzle-schema.js'

export { withImmediateTransaction as withTransaction } from './sqlite.js'

export interface SourceConfig {
  id: string
  firstUrl: string
  hostname: string
  fetchMode: 'auto' | 'http' | 'browser'
  pageLimit: number
  scopePath: string
  excludePathPattern: string | null
  httpConcurrency: number | null
  browserConcurrency: number | null
  kind: 'web' | 'github'
  githubArchiveLimitMb: number | null
  githubMarkdownLimitMb: number | null
  githubDefaultBranch: string | null
  githubRevision: string | null
  githubBlocked: GithubBlockedState | null
  discoveryMode: 'site' | 'agent_review'
  reviewGoal: string | null
}

export function createWebSourceIdentity(hostname: string, scopePath: string): string {
  return `${hostname.toLowerCase()}|${normalizeScopePath(scopePath)}`
}

export function readSourceConfig(database: LociDrizzleDatabase, id: string): SourceConfig {
  const source = database.select().from(documentSources).where(eq(documentSources.id, id)).get()
  if (!source) throw new Error('文档源不存在')
  if (source.sourceType !== 'local') throw new Error('云文档只能从来源服务器更新')
  return {
    id: source.id,
    firstUrl: source.firstUrl,
    hostname: source.hostname,
    fetchMode: source.fetchMode,
    pageLimit: source.pageLimit,
    scopePath: source.scopePath,
    excludePathPattern: source.excludePathPattern,
    httpConcurrency: source.httpConcurrency,
    browserConcurrency:
      source.browserConcurrency === null ? null : Number(source.browserConcurrency),
    kind: source.documentKind,
    githubArchiveLimitMb: source.githubArchiveLimitMb,
    githubMarkdownLimitMb: source.githubMarkdownLimitMb,
    githubDefaultBranch: source.githubDefaultBranch,
    githubRevision: source.githubRevision,
    discoveryMode: source.discoveryMode,
    reviewGoal: source.reviewGoal,
    githubBlocked:
      source.githubBlockedRevision &&
      source.githubBlockedLimitKind &&
      source.githubBlockedLimitBytes !== null
        ? {
            revision: source.githubBlockedRevision,
            kind: source.githubBlockedLimitKind,
            limitBytes: source.githubBlockedLimitBytes
          }
        : null
  }
}

export function assertLocalSourceIdentityAvailable(
  database: LociDrizzleDatabase,
  identity: string,
  github: boolean,
  excludedId?: string
): void {
  const conditions = [
    eq(documentSources.sourceIdentity, identity),
    eq(documentSources.sourceType, 'local')
  ]
  if (excludedId) conditions.push(ne(documentSources.id, excludedId))
  const duplicate = database
    .select({ id: documentSources.id })
    .from(documentSources)
    .where(and(...conditions))
    .get()
  if (duplicate) {
    throw new Error(
      github ? '这个 GitHub 仓库已经存在于文档源中' : '这个域名和收录范围已经存在于文档源中'
    )
  }
}

export function throwLocalHostnameConflict(error: unknown): never {
  if (
    error instanceof Error &&
    (error.message.includes('document_sources_local_hostname') ||
      error.message.includes('document_sources_local_identity') ||
      error.message.includes('UNIQUE constraint failed: document_sources.hostname'))
  ) {
    throw new Error('这个域名和收录范围已经存在于文档源中')
  }
  throw error
}

export function updateResolvedSourceRecord(
  database: DatabaseSync,
  id: string,
  firstUrl: string,
  mode: 'http' | 'browser',
  iconUrl: string | null,
  github?: { defaultBranch: string; revision: string },
  discovery?: ResolvedSourceDiscovery
): void {
  const url = normalizeUrl(firstUrl)
  database
    .prepare(
      `UPDATE document_sources
       SET first_url = ?, hostname = ?, fetch_mode = ?, icon_url = COALESCE(?, icon_url),
           resolved_discovery = COALESCE(?, resolved_discovery),
            source_identity = CASE WHEN document_kind = 'web' THEN ? || '|' || scope_path ELSE source_identity END,
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
      discovery ?? null,
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

export function findLocalSourceId(
  database: LociDrizzleDatabase,
  identity: string
): string | undefined {
  const row = database
    .select({ id: documentSources.id })
    .from(documentSources)
    .where(
      and(eq(documentSources.sourceIdentity, identity), eq(documentSources.sourceType, 'local'))
    )
    .get()
  return row?.id
}

const sourceSelection = {
  id: documentSources.id,
  name: documentSources.name,
  first_url: documentSources.firstUrl,
  fetch_mode: documentSources.fetchMode,
  page_limit: documentSources.pageLimit,
  scope_path: documentSources.scopePath,
  exclude_path_pattern: documentSources.excludePathPattern,
  schedule: documentSources.schedule,
  http_concurrency: documentSources.httpConcurrency,
  browser_concurrency: documentSources.browserConcurrency,
  icon_url: documentSources.iconUrl,
  page_count: count(documents.id),
  content_size: sql<number>`coalesce(sum(length(cast(${documents.markdown} as blob))), 0)`.mapWith(
    Number
  ),
  last_crawled_at: max(documents.crawledAt),
  source_type: documentSources.sourceType,
  cloud_server_url: documentSources.cloudServerUrl,
  cloud_library_id: documentSources.cloudLibraryId,
  cloud_revision: documentSources.cloudRevision,
  cloud_auto_sync: documentSources.cloudAutoSync,
  document_kind: documentSources.documentKind,
  github_archive_limit_mb: documentSources.githubArchiveLimitMb,
  github_markdown_limit_mb: documentSources.githubMarkdownLimitMb,
  github_default_branch: documentSources.githubDefaultBranch,
  github_revision: documentSources.githubRevision,
  discovery_mode: documentSources.discoveryMode,
  resolved_discovery: documentSources.resolvedDiscovery,
  review_goal: documentSources.reviewGoal
}

export function listDocumentSources(database: LociDrizzleDatabase): DocumentSource[] {
  const rows = database
    .select(sourceSelection)
    .from(documentSources)
    .leftJoin(documents, eq(documents.sourceId, documentSources.id))
    .groupBy(documentSources.id)
    .orderBy(desc(documentSources.updatedAt))
    .all()
  return rows.map(toDocumentSource)
}

export function readDocumentSource(database: LociDrizzleDatabase, id: string): DocumentSource {
  const row = database
    .select(sourceSelection)
    .from(documentSources)
    .leftJoin(documents, eq(documents.sourceId, documentSources.id))
    .where(eq(documentSources.id, id))
    .groupBy(documentSources.id)
    .get()
  if (!row) throw new Error('文档源不存在')
  return toDocumentSource(row)
}
