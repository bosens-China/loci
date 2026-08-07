import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { DEFAULT_APP_SETTINGS } from '@loci/shared'
import { normalizeServerUrl } from '@loci/shared'
import { parseGithubRepositoryUrl } from '@loci/core'

const sourceSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    first_url: z.string().url(),
    hostname: z.string().min(1),
    fetch_mode: z.enum(['auto', 'http', 'browser']),
    page_limit: z.number().int().min(1).max(10000),
    scope_path: z.string().startsWith('/').optional(),
    schedule: z.string().nullable(),
    http_concurrency: z.number().int().min(1).max(32).nullable().optional(),
    browser_concurrency: z.number().int().min(1).max(32).nullable().optional(),
    concurrency: z.number().int().min(1).max(32).nullable().optional(),
    icon_url: z.string().nullable(),
    source_type: z.enum(['local', 'cloud']).optional(),
    cloud_server_url: z.string().nullable().optional(),
    cloud_library_id: z.string().nullable().optional(),
    cloud_revision: z.string().nullable().optional(),
    cloud_auto_sync: z.number().int().min(0).max(1).optional(),
    document_kind: z.enum(['web', 'github']).optional(),
    source_identity: z.string().nullable().optional(),
    github_archive_limit_mb: z.number().int().min(1).max(10240).nullable().optional(),
    github_markdown_limit_mb: z.number().int().min(1).max(10240).nullable().optional(),
    github_default_branch: z.string().nullable().optional(),
    github_revision: z.string().nullable().optional(),
    github_blocked_revision: z.string().nullable().optional(),
    github_blocked_limit_kind: z.enum(['archive', 'markdown']).nullable().optional(),
    github_blocked_limit_bytes: z.number().int().positive().nullable().optional(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime()
  })
  .strict()

const documentSchema = z
  .object({
    id: z.string().min(1),
    source_id: z.string().min(1),
    title: z.string(),
    url: z.string().url(),
    crawled_at: z.string().datetime(),
    markdown: z.string(),
    language: z.string(),
    fetch_mode: z.enum(['http', 'browser']),
    relative_path: z.string().nullable().optional()
  })
  .strict()

const crawlRunSchema = z
  .object({
    id: z.string().min(1),
    source_id: z.string().min(1),
    status: z.enum(['queued', 'running', 'completed', 'failed']),
    started_at: z.string().datetime().nullable(),
    finished_at: z.string().datetime().nullable(),
    discovered_count: z.number().int().nonnegative(),
    success_count: z.number().int().nonnegative(),
    failure_count: z.number().int().nonnegative(),
    error_message: z.string().nullable()
  })
  .strict()

const crawlFailureSchema = z
  .object({
    id: z.string().min(1),
    run_id: z.string().min(1),
    url: z.string().url(),
    reason: z.enum([
      'not_found',
      'out_of_scope_redirect',
      'http_error',
      'request_error',
      'git_lfs_unsupported'
    ]),
    message: z.string(),
    retryable: z.number().int().min(0).max(1),
    status_code: z.number().int().nullable(),
    redirect_url: z.string().url().nullable()
  })
  .strict()

const settingsSchema = z
  .object({
    mcp_port: z.number().int().min(1024).max(65535),
    theme: z.enum(['auto', 'light', 'dark']),
    http_concurrency: z.number().int().min(1).max(32),
    browser_concurrency: z.number().int().min(1).max(32),
    max_retries: z.number().int().min(0).max(10).optional(),
    batch_interval_seconds: z
      .number()
      .int()
      .refine((value) => value === 0 || (value >= 100 && value <= 3000))
      .optional(),
    server_url: z.string().url().optional(),
    github_archive_limit_mb: z.number().int().min(1).max(10240).optional(),
    github_markdown_limit_mb: z.number().int().min(1).max(10240).optional()
  })
  .strict()

export const lociBackupSchema = z
  .object({
    format: z.literal('loci-backup'),
    version: z.literal(1),
    exportedAt: z.string().datetime(),
    data: z
      .object({
        sources: z.array(sourceSchema),
        documents: z.array(documentSchema),
        crawlRuns: z.array(crawlRunSchema),
        crawlFailures: z.array(crawlFailureSchema).optional(),
        settings: settingsSchema
      })
      .strict()
  })
  .strict()
  .superRefine(({ data }, context) => {
    const sourceIds = new Set(data.sources.map((source) => source.id))
    validateUniqueIds(data.sources, ['data', 'sources'], context)
    validateUniqueIds(data.documents, ['data', 'documents'], context)
    validateUniqueIds(data.crawlRuns, ['data', 'crawlRuns'], context)
    validateUniqueIds(data.crawlFailures ?? [], ['data', 'crawlFailures'], context)
    const runIds = new Set(data.crawlRuns.map((run) => run.id))
    data.documents.forEach((document, index) => {
      if (!sourceIds.has(document.source_id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'documents', index, 'source_id'],
          message: '引用的文档源不存在'
        })
      }
    })
    data.crawlRuns.forEach((run, index) => {
      if (!sourceIds.has(run.source_id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'crawlRuns', index, 'source_id'],
          message: '引用的文档源不存在'
        })
      }
    })
    ;(data.crawlFailures ?? []).forEach((failure, index) => {
      if (!runIds.has(failure.run_id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'crawlFailures', index, 'run_id'],
          message: '引用的抓取记录不存在'
        })
      }
    })
  })

export type LociBackup = z.infer<typeof lociBackupSchema>

export interface BackupImportSummary {
  sources: number
  documents: number
}

export function exportDatabaseBackup(database: DatabaseSync): LociBackup {
  return lociBackupSchema.parse({
    format: 'loci-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      sources: database
        .prepare(
          `SELECT id, name, first_url, hostname, fetch_mode, page_limit, scope_path, schedule,
             http_concurrency, browser_concurrency, icon_url, source_type, cloud_server_url,
             cloud_library_id, cloud_revision, cloud_auto_sync, created_at, updated_at
             , document_kind, source_identity, github_archive_limit_mb, github_markdown_limit_mb,
             github_default_branch, github_revision, github_blocked_revision,
             github_blocked_limit_kind, github_blocked_limit_bytes
           FROM document_sources ORDER BY created_at`
        )
        .all(),
      documents: database.prepare('SELECT * FROM documents ORDER BY crawled_at').all(),
      crawlRuns: database
        .prepare(
          `SELECT id, source_id, status, started_at, finished_at, discovered_count,
             success_count, failure_count, error_message FROM crawl_runs ORDER BY rowid`
        )
        .all(),
      crawlFailures: database.prepare('SELECT * FROM crawl_failures ORDER BY rowid').all(),
      settings: database
        .prepare(
          `SELECT mcp_port, theme, http_concurrency, browser_concurrency, max_retries,
             batch_interval_seconds, server_url, github_archive_limit_mb,
             github_markdown_limit_mb FROM app_settings WHERE id = 1`
        )
        .get()
    }
  })
}

export function importDatabaseBackup(database: DatabaseSync, input: unknown): BackupImportSummary {
  const backup = parseLociBackup(input)
  const { sources, documents, crawlRuns, crawlFailures = [], settings } = backup.data

  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(`
      DELETE FROM documents_fts;
      DELETE FROM crawl_failures;
      DELETE FROM crawl_runs;
      DELETE FROM documents;
      DELETE FROM document_sources;
    `)

    const insertSource = database.prepare(
      `INSERT INTO document_sources
       (id, name, first_url, hostname, fetch_mode, page_limit, scope_path, schedule, http_concurrency,
        browser_concurrency, icon_url, source_type, cloud_server_url, cloud_library_id,
        cloud_revision, cloud_auto_sync, document_kind, source_identity, github_archive_limit_mb,
        github_markdown_limit_mb, github_default_branch, github_revision, github_blocked_revision,
        github_blocked_limit_kind, github_blocked_limit_bytes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const source of sources) {
      const sourceType = source.source_type ?? 'local'
      if (
        sourceType === 'cloud' &&
        (!source.cloud_server_url || !source.cloud_library_id || !source.cloud_revision)
      ) {
        throw new Error(`云文档来源信息不完整：${source.name}`)
      }
      const repository = parseGithubRepositoryUrl(source.first_url)
      const documentKind = source.document_kind ?? (repository ? 'github' : 'web')
      insertSource.run(
        source.id,
        source.name,
        source.first_url,
        source.hostname,
        source.fetch_mode,
        source.page_limit,
        source.scope_path ?? '/',
        source.schedule,
        source.http_concurrency ?? source.concurrency ?? null,
        source.browser_concurrency ?? source.concurrency ?? null,
        source.icon_url,
        sourceType,
        sourceType === 'cloud' ? normalizeServerUrl(source.cloud_server_url ?? '') : null,
        sourceType === 'cloud' ? (source.cloud_library_id ?? null) : null,
        sourceType === 'cloud' ? (source.cloud_revision ?? null) : null,
        sourceType === 'cloud' ? (source.cloud_auto_sync ?? 0) : 0,
        documentKind,
        source.source_identity ?? repository?.identity ?? source.hostname,
        source.github_archive_limit_mb ?? null,
        source.github_markdown_limit_mb ?? null,
        source.github_default_branch ?? null,
        source.github_revision ?? null,
        source.github_blocked_revision ?? null,
        source.github_blocked_limit_kind ?? null,
        source.github_blocked_limit_bytes ?? null,
        source.created_at,
        source.updated_at
      )
    }

    const insertDocument = database.prepare(
      `INSERT INTO documents
       (id, source_id, title, url, crawled_at, markdown, language, fetch_mode, relative_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insertSearch = database.prepare(
      'INSERT INTO documents_fts (document_id, source_id, title, markdown) VALUES (?, ?, ?, ?)'
    )
    for (const document of documents) {
      insertDocument.run(
        document.id,
        document.source_id,
        document.title,
        document.url,
        document.crawled_at,
        document.markdown,
        document.language,
        document.fetch_mode,
        document.relative_path ?? null
      )
      insertSearch.run(document.id, document.source_id, document.title, document.markdown)
    }

    const insertRun = database.prepare(
      `INSERT INTO crawl_runs
       (id, source_id, status, started_at, finished_at, discovered_count, success_count, failure_count, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const run of crawlRuns) {
      insertRun.run(
        run.id,
        run.source_id,
        run.status,
        run.started_at,
        run.finished_at,
        run.discovered_count,
        run.success_count,
        run.failure_count,
        run.error_message
      )
    }

    const insertFailure = database.prepare(
      `INSERT INTO crawl_failures
       (id, run_id, url, reason, message, retryable, status_code, redirect_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const failure of crawlFailures) {
      insertFailure.run(
        failure.id,
        failure.run_id,
        failure.url,
        failure.reason,
        failure.message,
        failure.retryable,
        failure.status_code,
        failure.redirect_url
      )
    }

    database
      .prepare(
        `UPDATE app_settings
         SET mcp_port = ?, theme = ?, http_concurrency = ?, browser_concurrency = ?,
             max_retries = ?, batch_interval_seconds = ?, server_url = ?,
             server_url_customized = ?, github_archive_limit_mb = ?,
             github_markdown_limit_mb = ?
         WHERE id = 1`
      )
      .run(
        settings.mcp_port,
        settings.theme,
        settings.http_concurrency,
        settings.browser_concurrency,
        settings.max_retries ?? DEFAULT_APP_SETTINGS.maxRetries,
        settings.batch_interval_seconds ?? DEFAULT_APP_SETTINGS.batchIntervalSeconds,
        normalizeServerUrl(settings.server_url ?? DEFAULT_APP_SETTINGS.serverUrl),
        settings.server_url ? 1 : 0,
        settings.github_archive_limit_mb ?? DEFAULT_APP_SETTINGS.githubArchiveLimitMb,
        settings.github_markdown_limit_mb ?? DEFAULT_APP_SETTINGS.githubMarkdownLimitMb
      )
    database.exec('COMMIT')
    return { sources: sources.length, documents: documents.length }
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function parseLociBackup(input: unknown): LociBackup {
  const result = lociBackupSchema.safeParse(input)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const path = issue?.path.join('.') || '根节点'
  throw new Error(`备份文件格式无效：${path} ${issue?.message ?? '未知错误'}`)
}

function validateUniqueIds(
  rows: Array<{ id: string }>,
  path: Array<string | number>,
  context: z.RefinementCtx
): void {
  const ids = new Set<string>()
  rows.forEach((row, index) => {
    if (ids.has(row.id)) {
      context.addIssue({ code: 'custom', path: [...path, index, 'id'], message: 'ID 重复' })
    }
    ids.add(row.id)
  })
}
