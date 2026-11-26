import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  DOCUMENT_SOURCE_DEFAULTS,
  getHostname,
  isPathExcluded,
  isUrlInScope,
  normalizeExcludePathPattern,
  normalizeScopePath,
  normalizeUrl,
  parseGithubRepositoryUrl
} from '@loci/core'
import {
  DEFAULT_LIBRARY_CATEGORY,
  DEFAULT_LIBRARY_VERSION,
  type CreateSourceInput,
  type DocumentSource,
  type SourceKind,
  type UpdateSourceInput
} from '@loci/shared'
import { and, eq } from 'drizzle-orm'
import {
  assertLocalSourceIdentityAvailable,
  createWebSourceIdentity,
  findLocalSourceId,
  readDocumentSource,
  throwLocalHostnameConflict,
  withTransaction
} from './database-local-source.js'
import { ensureCategory } from './category-database.js'
import { deleteDocumentsOutsideScope } from './database-source-scope.js'
import { validateSourceInput } from './database-values.js'
import { deleteSourceDocuments } from './document-content-database.js'
import type { LociDrizzleDatabase } from './drizzle-database.js'
import { documentSources, explicitPageTargets } from './drizzle-schema.js'

type ReuseSource = (
  source: DocumentSource,
  save: (input: UpdateSourceInput) => DocumentSource
) => DocumentSource

export interface LocalSourceMutationDatabase {
  createSource: (input: CreateSourceInput) => DocumentSource
  upsertSource: (input: CreateSourceInput, reuse?: ReuseSource) => DocumentSource
  updateSource: (id: string, input: UpdateSourceInput) => DocumentSource
  deleteSource: (id: string) => void
}

/** 本地文档库的身份校验、事务写入集中在同一边界。 */
export function createLocalSourceMutationDatabase(
  database: DatabaseSync,
  drizzle: LociDrizzleDatabase
): LocalSourceMutationDatabase {
  const upsertSource: LocalSourceMutationDatabase['upsertSource'] = (input, reuse) =>
    withTransaction(database, () => createSourceInTransaction(database, drizzle, input, reuse))
  return {
    createSource: upsertSource,
    upsertSource,
    updateSource: (id, input) =>
      withTransaction(database, () => updateSourceInTransaction(database, drizzle, id, input)),
    deleteSource: (id) => deleteSource(database, drizzle, id)
  }
}

function sourceMetadata(drizzle: LociDrizzleDatabase, input: CreateSourceInput) {
  const category = input.category?.trim() || DEFAULT_LIBRARY_CATEGORY
  ensureCategory(drizzle, category)
  return { category, version: input.version?.trim() || DEFAULT_LIBRARY_VERSION }
}

/** 普通创建和移动文档共用调用方持有的写事务。 */
export function createSourceInTransaction(
  database: DatabaseSync,
  drizzle: LociDrizzleDatabase,
  input: CreateSourceInput,
  reuse?: ReuseSource
): DocumentSource {
  validateSourceInput(input)
  const resolved = resolveSourceInput(input)
  const metadata = sourceMetadata(drizzle, input)
  const existingId = findLocalSourceId(drizzle, resolved.identity, metadata.version)
  if (existingId && reuse) {
    // Runtime 可以在此处检查抓取锁，整次复用仍属于当前事务。
    return reuse(readDocumentSource(drizzle, existingId), (value) =>
      updateSourceInTransaction(database, drizzle, existingId, value)
    )
  }
  if (existingId) {
    const source = readDocumentSource(drizzle, existingId)
    if (metadata.category === source.category) return source
    drizzle
      .update(documentSources)
      .set({ ...metadata, updatedAt: new Date().toISOString() })
      .where(eq(documentSources.id, existingId))
      .run()
    return readDocumentSource(drizzle, existingId)
  }
  const now = new Date().toISOString()
  const id = randomUUID()
  try {
    drizzle
      .insert(documentSources)
      .values({
        id,
        ...metadata,
        name: input.name.trim(),
        firstUrl: resolved.url,
        hostname: resolved.hostname,
        fetchMode: resolved.mode,
        pageLimit: input.pageLimit,
        scopePath: resolved.scopePath,
        excludePathPattern: resolved.excludePathPattern,
        httpConcurrency: input.httpConcurrency,
        browserConcurrency: input.browserConcurrency,
        documentKind: resolved.kind,
        sourceIdentity: resolved.identity,
        githubArchiveLimitMb: input.githubArchiveLimitMb ?? null,
        githubMarkdownLimitMb: input.githubMarkdownLimitMb ?? null,
        sourceType: 'local',
        cloudAutoSync: 0,
        createdAt: now,
        updatedAt: now
      })
      .run()
  } catch (error) {
    throwLocalHostnameConflict(error)
  }
  return readDocumentSource(drizzle, id)
}

function updateSourceInTransaction(
  database: DatabaseSync,
  drizzle: LociDrizzleDatabase,
  id: string,
  input: UpdateSourceInput
): DocumentSource {
  validateSourceInput(input)
  const resolved = resolveSourceInput(input)
  const current = drizzle
    .select()
    .from(documentSources)
    .where(and(eq(documentSources.id, id), eq(documentSources.sourceType, 'local')))
    .get()
  if (!current) throw new Error('文档源不存在')
  const resetGithubState =
    current.firstUrl !== resolved.url ||
    current.pageLimit !== input.pageLimit ||
    current.githubArchiveLimitMb !== (input.githubArchiveLimitMb ?? null) ||
    current.githubMarkdownLimitMb !== (input.githubMarkdownLimitMb ?? null)
  const resetResolvedDiscovery =
    current.firstUrl !== resolved.url ||
    current.documentKind !== resolved.kind ||
    current.scopePath !== resolved.scopePath ||
    current.excludePathPattern !== resolved.excludePathPattern
  const clearDocuments =
    current.documentKind !== resolved.kind ||
    getHostname(current.firstUrl) !== resolved.hostname ||
    (resolved.kind === 'github' && current.firstUrl !== resolved.url)
  // 同一 GitHub 库只改配置时，保留上次抓取解析出的实际方式。
  const fetchMode =
    resolved.kind === 'github' && !clearDocuments ? current.fetchMode : resolved.mode
  try {
    const metadata = sourceMetadata(drizzle, input)
    assertLocalSourceIdentityAvailable(
      drizzle,
      resolved.identity,
      metadata.version,
      resolved.kind === 'github',
      id
    )
    const result = drizzle
      .update(documentSources)
      .set({
        ...metadata,
        name: input.name.trim(),
        firstUrl: resolved.url,
        hostname: resolved.hostname,
        fetchMode,
        pageLimit: input.pageLimit,
        scopePath: resolved.scopePath,
        excludePathPattern: resolved.excludePathPattern,
        httpConcurrency: input.httpConcurrency,
        browserConcurrency: input.browserConcurrency,
        documentKind: resolved.kind,
        sourceIdentity: resolved.identity,
        githubArchiveLimitMb: input.githubArchiveLimitMb ?? null,
        githubMarkdownLimitMb: input.githubMarkdownLimitMb ?? null,
        ...(resetResolvedDiscovery ? { resolvedDiscovery: null } : {}),
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
      .where(and(eq(documentSources.id, id), eq(documentSources.sourceType, 'local')))
      .run()
    if (Number(result.changes) !== 1) throw new Error('文档源不存在')
    if (clearDocuments) {
      deleteSourceDocuments(database, id)
      drizzle.delete(explicitPageTargets).where(eq(explicitPageTargets.sourceId, id)).run()
    } else if (
      resolved.kind === 'web' &&
      (current.scopePath !== resolved.scopePath ||
        current.excludePathPattern !== resolved.excludePathPattern)
    ) {
      deleteDocumentsOutsideScope(
        database,
        id,
        resolved.hostname,
        resolved.scopePath,
        resolved.excludePathPattern
      )
    } else if (resolved.kind === 'github') {
      drizzle.delete(explicitPageTargets).where(eq(explicitPageTargets.sourceId, id)).run()
    }
  } catch (error) {
    throwLocalHostnameConflict(error)
  }
  const source = readDocumentSource(drizzle, id)
  return source
}

function deleteSource(database: DatabaseSync, drizzle: LociDrizzleDatabase, id: string): void {
  const source = drizzle
    .select({
      id: documentSources.id,
      name: documentSources.name,
      hostname: documentSources.hostname
    })
    .from(documentSources)
    .where(eq(documentSources.id, id))
    .get()
  if (!source) return
  withTransaction(database, () => {
    // FTS5 虚拟表不由 Drizzle 表映射管理。
    database.prepare('DELETE FROM documents_fts WHERE source_id = ?').run(id)
    drizzle.delete(documentSources).where(eq(documentSources.id, id)).run()
  })
}

interface ResolvedSourceInput {
  kind: SourceKind
  url: string
  hostname: string
  mode: 'auto' | 'http' | 'browser'
  scopePath: string
  excludePathPattern: string | null
  identity: string
}

function resolveSourceInput(input: CreateSourceInput | UpdateSourceInput): ResolvedSourceInput {
  const repository = parseGithubRepositoryUrl(input.url)
  const kind = resolveSourceKind(input.kind, repository !== null)
  const url = kind === 'github' ? repository!.url : normalizeUrl(input.url)
  const hostname = getHostname(url)
  const mode = kind === 'github' ? DOCUMENT_SOURCE_DEFAULTS.mode : input.mode
  const scopePath =
    kind === 'github'
      ? DOCUMENT_SOURCE_DEFAULTS.scopePath
      : normalizeScopePath(input.scopePath ?? DOCUMENT_SOURCE_DEFAULTS.scopePath)
  const excludePathPattern =
    kind === 'github' ? null : normalizeExcludePathPattern(input.excludePathPattern)
  if (!isUrlInScope(url, hostname, scopePath)) throw new Error('起始页面不在收录范围内')
  if (isPathExcluded(url, excludePathPattern)) throw new Error('起始页面不能被排除路径正则命中')
  return {
    kind,
    url,
    hostname,
    mode,
    scopePath,
    excludePathPattern,
    identity:
      kind === 'github' ? repository!.identity : createWebSourceIdentity(hostname, scopePath)
  }
}

function resolveSourceKind(kind: SourceKind | undefined, githubUrl: boolean): SourceKind {
  const inferred = githubUrl ? 'github' : 'web'
  if (!kind) return inferred
  if (kind === 'github' && !githubUrl) throw new Error('GitHub 文档源必须使用公开仓库首页 URL')
  if (kind === 'web' && githubUrl) throw new Error('普通站点不能使用 GitHub 仓库首页 URL')
  return kind
}
