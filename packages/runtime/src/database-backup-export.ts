import type { DatabaseSync } from 'node:sqlite'
import { lociBackupSchema, type LociBackup } from './database-backup-schema.js'

export interface BackupExportOptions {
  categories?: readonly string[]
  libraryIds?: readonly string[]
}

/** 所有查询在调用方的同一个快照中读取。使用 JSON 参数避免大量筛选项超出 SQLite 参数上限。 */
export function exportDatabaseBackup(
  database: DatabaseSync,
  options: BackupExportOptions = {}
): LociBackup {
  const filtered = options.categories !== undefined || options.libraryIds !== undefined
  const predicate =
    'category IN (SELECT value FROM json_each(?)) OR id IN (SELECT value FROM json_each(?))'
  const selected = `SELECT id FROM document_sources WHERE ${predicate}`
  const params = filtered
    ? [
        JSON.stringify(options.categories?.map((name) => name.trim()) ?? []),
        JSON.stringify(options.libraryIds ?? [])
      ]
    : []
  const where = (condition: string) => (filtered ? ` WHERE ${condition}` : '')
  const sourceFilter = where(`source_id IN (${selected})`)
  const runFilter = where(`run_id IN (SELECT id FROM crawl_runs${sourceFilter})`)
  const rows = (query: string) => database.prepare(query).all(...params)
  return lociBackupSchema.parse({
    format: 'loci-backup',
    version: 1,
    scope: filtered ? 'filtered' : 'all',
    exportedAt: new Date().toISOString(),
    data: {
      categories: rows(
        `SELECT name, sort_order, created_at FROM categories${where(`name IN (SELECT category FROM document_sources WHERE ${predicate})`)} ORDER BY sort_order, name`
      ),
      sources:
        rows(`SELECT id, name, category, version, first_url, hostname, fetch_mode, page_limit, scope_path, exclude_path_pattern, schedule,
        http_concurrency, browser_concurrency, icon_url, source_type, cloud_server_url, cloud_library_id, cloud_revision, cloud_auto_sync,
        created_at, updated_at, document_kind, source_identity, github_archive_limit_mb, github_markdown_limit_mb, github_default_branch,
        github_revision, github_blocked_revision, github_blocked_limit_kind, github_blocked_limit_bytes, discovery_mode, resolved_discovery, review_goal
        FROM document_sources${where(predicate)} ORDER BY created_at`),
      documents: rows(`SELECT * FROM documents${sourceFilter} ORDER BY crawled_at`),
      explicitPageTargets: rows(
        `SELECT * FROM explicit_page_targets${sourceFilter} ORDER BY created_at, url`
      ),
      crawlRuns:
        rows(`SELECT id, source_id, status, started_at, finished_at, discovered_count, success_count, failure_count,
        error_message, progress_json FROM crawl_runs${sourceFilter} ORDER BY rowid`),
      crawlFailures: rows(`SELECT * FROM crawl_failures${runFilter} ORDER BY rowid`),
      ...(!filtered && {
        hostnameCrawlPolicies: database
          .prepare('SELECT * FROM hostname_crawl_policies ORDER BY hostname')
          .all(),
        settings: database
          .prepare(
            `SELECT theme, http_concurrency, browser_concurrency, max_retries, batch_interval_seconds,
          batch_interval_max_seconds, github_archive_limit_mb, github_markdown_limit_mb FROM app_settings WHERE id = 1`
          )
          .get()
      })
    }
  })
}
