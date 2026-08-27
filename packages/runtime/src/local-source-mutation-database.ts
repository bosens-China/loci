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
import type { CreateSourceInput, DocumentSource, SourceKind, UpdateSourceInput } from '@loci/shared'
import { and, eq } from 'drizzle-orm'
import {
  assertLocalSourceIdentityAvailable,
  createWebSourceIdentity,
  findLocalSourceId,
  readDocumentSource,
  throwLocalHostnameConflict,
  withTransaction
} from './database-local-source.js'
import { deleteDocumentsOutsideScope } from './database-source-scope.js'
import { validateSourceInput } from './database-values.js'
import { deleteSourceDocuments } from './document-content-database.js'
import type { LociDrizzleDatabase } from './drizzle-database.js'
import { documentSources, explicitPageTargets } from './drizzle-schema.js'
import type { OperationLogDatabase } from './operation-log-database.js'

export interface LocalSourceMutationDatabase {
  createSource: (input: CreateSourceInput) => DocumentSource
  updateSource: (id: string, input: UpdateSourceInput) => DocumentSource
  deleteSource: (id: string) => void
}

/** 本地文档库的身份校验、事务写入和操作日志集中在同一边界。 */
export function createLocalSourceMutationDatabase(
  database: DatabaseSync,
  drizzle: LociDrizzleDatabase,
  logs: OperationLogDatabase
): LocalSourceMutationDatabase {
  return {
    createSource: (input) => createSource(drizzle, logs, input),
    updateSource: (id, input) => updateSource(database, drizzle, logs, id, input),
    deleteSource: (id) => deleteSource(database, drizzle, logs, id)
  }
}

function createSource(
  drizzle: LociDrizzleDatabase,
  logs: OperationLogDatabase,
  input: CreateSourceInput
): DocumentSource {
  const schedule = validateSourceInput(input)
  const resolved = resolveSourceInput(input)
  const existingId = findLocalSourceId(drizzle, resolved.identity)
  if (existingId) return readDocumentSource(drizzle, existingId)
  const now = new Date().toISOString()
  const id = randomUUID()
  try {
    drizzle
      .insert(documentSources)
      .values({
        id,
        name: input.name.trim(),
        firstUrl: resolved.url,
        hostname: resolved.hostname,
        fetchMode: resolved.mode,
        pageLimit: input.pageLimit,
        scopePath: resolved.scopePath,
        excludePathPattern: resolved.excludePathPattern,
        schedule,
        httpConcurrency: input.httpConcurrency,
        browserConcurrency: input.browserConcurrency,
        documentKind: resolved.kind,
        sourceIdentity: resolved.identity,
        githubArchiveLimitMb: input.githubArchiveLimitMb ?? null,
        githubMarkdownLimitMb: input.githubMarkdownLimitMb ?? null,
        discoveryMode: input.discoveryMode ?? 'site',
        reviewGoal:
          input.discoveryMode === 'agent_review' ? (input.reviewGoal?.trim() ?? null) : null,
        sourceType: 'local',
        cloudAutoSync: 0,
        createdAt: now,
        updatedAt: now
      })
      .run()
  } catch (error) {
    const duplicateId = findLocalSourceId(drizzle, resolved.identity)
    if (duplicateId) return readDocumentSource(drizzle, duplicateId)
    throwLocalHostnameConflict(error)
  }
  const source = readDocumentSource(drizzle, id)
  recordSourceLog(logs, 'library.create', source, '已创建文档库')
  return source
}

function updateSource(
  database: DatabaseSync,
  drizzle: LociDrizzleDatabase,
  logs: OperationLogDatabase,
  id: string,
  input: UpdateSourceInput
): DocumentSource {
  const schedule = validateSourceInput(input)
  const resolved = resolveSourceInput(input)
  const current = drizzle
    .select()
    .from(documentSources)
    .where(and(eq(documentSources.id, id), eq(documentSources.sourceType, 'local')))
    .get()
  if (!current) throw new Error('文档源不存在')
  const discoveryMode = input.discoveryMode ?? current.discoveryMode
  const requestedReviewGoal = input.reviewGoal === undefined ? current.reviewGoal : input.reviewGoal
  const reviewGoal = discoveryMode === 'agent_review' ? requestedReviewGoal : null
  validateDiscovery(resolved.kind, discoveryMode, reviewGoal)
  const resetGithubState =
    current.firstUrl !== resolved.url ||
    current.pageLimit !== input.pageLimit ||
    current.githubArchiveLimitMb !== (input.githubArchiveLimitMb ?? null) ||
    current.githubMarkdownLimitMb !== (input.githubMarkdownLimitMb ?? null)
  const resetResolvedDiscovery =
    current.firstUrl !== resolved.url ||
    current.documentKind !== resolved.kind ||
    current.scopePath !== resolved.scopePath ||
    current.excludePathPattern !== resolved.excludePathPattern ||
    current.discoveryMode !== discoveryMode
  const clearDocuments =
    current.documentKind !== resolved.kind ||
    getHostname(current.firstUrl) !== resolved.hostname ||
    (resolved.kind === 'github' && current.firstUrl !== resolved.url)
  try {
    withTransaction(database, () => {
      assertLocalSourceIdentityAvailable(drizzle, resolved.identity, resolved.kind === 'github', id)
      const result = drizzle
        .update(documentSources)
        .set({
          name: input.name.trim(),
          firstUrl: resolved.url,
          hostname: resolved.hostname,
          fetchMode: resolved.mode,
          pageLimit: input.pageLimit,
          scopePath: resolved.scopePath,
          excludePathPattern: resolved.excludePathPattern,
          schedule,
          httpConcurrency: input.httpConcurrency,
          browserConcurrency: input.browserConcurrency,
          documentKind: resolved.kind,
          sourceIdentity: resolved.identity,
          githubArchiveLimitMb: input.githubArchiveLimitMb ?? null,
          githubMarkdownLimitMb: input.githubMarkdownLimitMb ?? null,
          discoveryMode,
          reviewGoal: reviewGoal?.trim() || null,
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
      } else if (resolved.kind === 'web') {
        deleteDocumentsOutsideScope(
          database,
          id,
          resolved.hostname,
          resolved.scopePath,
          resolved.excludePathPattern
        )
      } else {
        drizzle.delete(explicitPageTargets).where(eq(explicitPageTargets.sourceId, id)).run()
      }
    })
  } catch (error) {
    throwLocalHostnameConflict(error)
  }
  const source = readDocumentSource(drizzle, id)
  recordSourceLog(logs, 'library.update', source, '已更新文档库')
  return source
}

function deleteSource(
  database: DatabaseSync,
  drizzle: LociDrizzleDatabase,
  logs: OperationLogDatabase,
  id: string
): void {
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
  recordSourceLog(logs, 'library.delete', source, '已删除文档库', 'warning')
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
  validateDiscovery(kind, input.discoveryMode ?? 'site', input.reviewGoal)
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

function validateDiscovery(
  kind: SourceKind,
  discoveryMode: 'site' | 'agent_review',
  reviewGoal?: string | null
): void {
  if (kind === 'github' && discoveryMode === 'agent_review') {
    throw new Error('Agent URL 审查模式暂不支持 GitHub 仓库')
  }
  if (discoveryMode === 'agent_review' && !reviewGoal?.trim()) {
    throw new Error('Agent 审查模式需要说明收录目标')
  }
}

function resolveSourceKind(kind: SourceKind | undefined, githubUrl: boolean): SourceKind {
  const inferred = githubUrl ? 'github' : 'web'
  if (!kind) return inferred
  if (kind === 'github' && !githubUrl) throw new Error('GitHub 文档源必须使用公开仓库首页 URL')
  if (kind === 'web' && githubUrl) throw new Error('普通站点不能使用 GitHub 仓库首页 URL')
  return kind
}

function recordSourceLog(
  logs: OperationLogDatabase,
  action: string,
  source: { id: string; name: string; hostname?: string; url?: string },
  message: string,
  level: 'info' | 'warning' = 'info'
): void {
  logs.recordOperationLog({
    category: 'library',
    action,
    level,
    resourceType: 'library',
    resourceId: source.id,
    hostname: source.hostname ?? (source.url ? getHostname(source.url) : undefined),
    message: `${message}：${source.name}`
  })
}
