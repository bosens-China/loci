import type { DatabaseSync } from 'node:sqlite'
import { parseGithubRepositoryUrl } from '@loci/core'
import { DEFAULT_APP_SETTINGS, normalizeServerUrl } from '@loci/shared'
import { lociBackupSchema, parseLociBackup, type LociBackup } from './database-backup-schema.js'

export { lociBackupSchema, parseLociBackup, type LociBackup } from './database-backup-schema.js'

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
          `SELECT id, name, first_url, hostname, fetch_mode, page_limit, scope_path, exclude_path_pattern, schedule,
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
          `SELECT theme, http_concurrency, browser_concurrency, max_retries,
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
       (id, name, first_url, hostname, fetch_mode, page_limit, scope_path, exclude_path_pattern, schedule, http_concurrency,
        browser_concurrency, icon_url, source_type, cloud_server_url, cloud_library_id,
        cloud_revision, cloud_auto_sync, document_kind, source_identity, github_archive_limit_mb,
        github_markdown_limit_mb, github_default_branch, github_revision, github_blocked_revision,
        github_blocked_limit_kind, github_blocked_limit_bytes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        source.exclude_path_pattern ?? null,
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
         SET theme = ?, http_concurrency = ?, browser_concurrency = ?,
             max_retries = ?, batch_interval_seconds = ?, server_url = ?,
             server_url_customized = ?, github_archive_limit_mb = ?,
             github_markdown_limit_mb = ?
         WHERE id = 1`
      )
      .run(
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
