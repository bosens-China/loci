import type { DatabaseSync } from 'node:sqlite'
import { DEFAULT_APP_SETTINGS, type BackupImportSummary } from '@loci/shared'
import { parseLociBackup, type LociBackup } from './database-backup-schema.js'
import { lt } from 'drizzle-orm'
import { backupImportReceipts } from './drizzle-schema.js'
import { createDrizzleDatabase } from './drizzle-database.js'
import { prepareBackupImport } from './database-backup-import.js'
export { exportDatabaseBackup, type BackupExportOptions } from './database-backup-export.js'

export { lociBackupSchema, parseLociBackup, type LociBackup } from './database-backup-schema.js'

export interface BackupImportOptions {
  replaceAll?: boolean
}

export type { BackupImportSummary } from '@loci/shared'

export function importDatabaseBackup(
  database: DatabaseSync,
  input: unknown,
  options?: BackupImportOptions
): BackupImportSummary {
  return restoreDatabaseBackup(database, parseLociBackup(input), options)
}

/** 已校验的 ZIP 与 JSON 共用一次原子恢复。 */
export function restoreDatabaseBackup(
  database: DatabaseSync,
  backup: LociBackup,
  { replaceAll = false }: BackupImportOptions = {},
  operationId?: string
): BackupImportSummary {
  const {
    documents,
    explicitPageTargets = [],
    crawlRuns,
    crawlFailures = [],
    hostnameCrawlPolicies = [],
    settings
  } = backup.data

  database.exec('BEGIN IMMEDIATE')
  try {
    const { sources, replacedLibraries, categoriesCreated } = prepareBackupImport(
      database,
      backup,
      replaceAll
    )

    const insertSource = database.prepare(
      `INSERT INTO document_sources
       (id, name, first_url, hostname, fetch_mode, page_limit, scope_path, exclude_path_pattern, schedule, http_concurrency,
        browser_concurrency, icon_url, source_type, cloud_server_url, cloud_library_id,
        cloud_revision, cloud_auto_sync, document_kind, source_identity, github_archive_limit_mb,
        github_markdown_limit_mb, github_default_branch, github_revision, github_blocked_revision,
        github_blocked_limit_kind, github_blocked_limit_bytes, discovery_mode, resolved_discovery,
        review_goal,
        category, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const source of sources) {
      const sourceType = source.source_type ?? 'local'
      if (
        sourceType === 'cloud' &&
        (!source.cloud_server_url || !source.cloud_library_id || !source.cloud_revision)
      ) {
        throw new Error(`云文档来源信息不完整：${source.name}`)
      }
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
        sourceType === 'cloud' ? (source.cloud_server_url ?? null) : null,
        sourceType === 'cloud' ? (source.cloud_library_id ?? null) : null,
        sourceType === 'cloud' ? (source.cloud_revision ?? null) : null,
        sourceType === 'cloud' ? (source.cloud_auto_sync ?? 0) : 0,
        source.document_kind,
        source.source_identity,
        source.github_archive_limit_mb ?? null,
        source.github_markdown_limit_mb ?? null,
        source.github_default_branch ?? null,
        source.github_revision ?? null,
        source.github_blocked_revision ?? null,
        source.github_blocked_limit_kind ?? null,
        source.github_blocked_limit_bytes ?? null,
        source.discovery_mode ?? 'site',
        source.resolved_discovery ?? null,
        source.review_goal ?? null,
        source.category,
        source.version,
        source.created_at,
        source.updated_at
      )
    }

    const insertDocument = database.prepare(
      `INSERT INTO documents
       (id, source_id, title, url, crawled_at, markdown, language, fetch_mode, relative_path, manual)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        document.relative_path ?? null,
        document.manual ?? 0
      )
      insertSearch.run(document.id, document.source_id, document.title, document.markdown)
    }

    const insertTarget = database.prepare(
      `INSERT INTO explicit_page_targets
       (source_id, url, status, last_crawled_at, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    for (const target of explicitPageTargets) {
      insertTarget.run(
        target.source_id,
        target.url,
        target.status,
        target.last_crawled_at,
        target.last_error,
        target.created_at,
        target.updated_at
      )
    }

    const insertRun = database.prepare(
      `INSERT INTO crawl_runs
       (id, source_id, status, started_at, finished_at, discovered_count, success_count, failure_count, error_message, progress_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        run.error_message,
        run.progress_json ?? null
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

    const insertPolicy = database.prepare(
      `INSERT INTO hostname_crawl_policies
       (hostname, http_concurrency, browser_concurrency, batch_interval_min_seconds,
        batch_interval_max_seconds, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    )
    for (const policy of replaceAll ? hostnameCrawlPolicies : []) {
      insertPolicy.run(
        policy.hostname,
        policy.http_concurrency,
        policy.browser_concurrency,
        policy.batch_interval_min_seconds,
        policy.batch_interval_max_seconds,
        policy.updated_at
      )
    }

    if (replaceAll && settings)
      database
        .prepare(
          `UPDATE app_settings
         SET theme = ?, http_concurrency = ?, browser_concurrency = ?,
             max_retries = ?, batch_interval_seconds = ?, batch_interval_max_seconds = ?,
             github_archive_limit_mb = ?,
             github_markdown_limit_mb = ?
         WHERE id = 1`
        )
        .run(
          settings.theme,
          settings.http_concurrency,
          settings.browser_concurrency,
          settings.max_retries ?? DEFAULT_APP_SETTINGS.maxRetries,
          settings.batch_interval_seconds ?? DEFAULT_APP_SETTINGS.batchIntervalSeconds,
          settings.batch_interval_max_seconds ?? DEFAULT_APP_SETTINGS.batchIntervalMaxSeconds,
          settings.github_archive_limit_mb ?? DEFAULT_APP_SETTINGS.githubArchiveLimitMb,
          settings.github_markdown_limit_mb ?? DEFAULT_APP_SETTINGS.githubMarkdownLimitMb
        )
    const summary: BackupImportSummary = {
      mode: replaceAll ? 'replace' : 'merge',
      importedLibraries: sources.length,
      replacedLibraries,
      importedDocuments: documents.length,
      categoriesCreated,
      sources: sources.length,
      documents: documents.length
    }
    // 回执与业务数据一起提交，持锁进程意外退出后，跟随者仍能读取同一结果。
    if (operationId) {
      const db = createDrizzleDatabase(database)
      const now = Date.now()
      db.delete(backupImportReceipts)
        .where(lt(backupImportReceipts.createdAt, now - 86_400_000))
        .run()
      db.insert(backupImportReceipts).values({ operationId, summary, createdAt: now }).run()
    }
    database.exec('COMMIT')
    return summary
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
