import type { DatabaseSync } from 'node:sqlite'
import {
  APP_SETTINGS_LIMITS,
  DEFAULT_APP_SETTINGS,
  isValidBatchIntervalSeconds,
  normalizeCronSchedule,
  PRODUCTION_SERVER_URL
} from '@loci/shared'
import type { AppSettings, CreateSourceInput, DocumentRecord, DocumentSource } from '@loci/shared'
import { normalizeServerUrl } from '@loci/shared'
import {
  DOCUMENT_SOURCE_DEFAULTS,
  DOCUMENT_SOURCE_LIMITS,
  normalizeExcludePathPattern,
  normalizeScopePath
} from '@loci/core'

export interface SourceRow {
  id: string
  name: string
  first_url: string
  fetch_mode: 'auto' | 'http' | 'browser'
  page_limit: number
  scope_path: string
  exclude_path_pattern: string | null
  schedule: string | null
  http_concurrency: number | null
  browser_concurrency: number | null
  icon_url: string | null
  page_count: number
  content_size: number
  last_crawled_at: string | null
  source_type: 'local' | 'cloud'
  cloud_server_url: string | null
  cloud_library_id: string | null
  cloud_revision: string | null
  cloud_auto_sync: number
  document_kind: 'web' | 'github'
  github_archive_limit_mb: number | null
  github_markdown_limit_mb: number | null
  github_default_branch: string | null
  github_revision: string | null
}

export interface DocumentRow {
  id: string
  source_id: string
  source_name: string
  title: string
  url: string
  language: string
  crawled_at: string
  markdown: string
  relative_path: string | null
}

export function validateSettings(settings: AppSettings): AppSettings {
  if (!['auto', 'light', 'dark'].includes(settings.theme)) throw new Error('不支持的主题设置')
  validateConcurrency(settings.httpConcurrency, 'HTTP 默认并发')
  validateConcurrency(settings.browserConcurrency, '浏览器默认并发')
  if (
    !Number.isInteger(settings.maxRetries) ||
    settings.maxRetries < APP_SETTINGS_LIMITS.maxRetries.min ||
    settings.maxRetries > APP_SETTINGS_LIMITS.maxRetries.max
  ) {
    throw new Error(
      `失败重试次数必须是 ${APP_SETTINGS_LIMITS.maxRetries.min} 到 ${APP_SETTINGS_LIMITS.maxRetries.max} 之间的整数`
    )
  }
  if (!isValidBatchIntervalSeconds(settings.batchIntervalSeconds)) {
    throw new Error(
      `批次间隔必须为 ${APP_SETTINGS_LIMITS.batchIntervalSeconds.disabled}，或 ${APP_SETTINGS_LIMITS.batchIntervalSeconds.min} 到 ${APP_SETTINGS_LIMITS.batchIntervalSeconds.max} 之间的整数秒`
    )
  }
  validateMegabytes(settings.githubArchiveLimitMb, 'GitHub ZIP 默认上限')
  validateMegabytes(settings.githubMarkdownLimitMb, 'GitHub Markdown 默认上限')
  return { ...settings, serverUrl: normalizeServerUrl(settings.serverUrl) }
}

export function validateSourceInput(input: CreateSourceInput): string | null {
  const nameLength = input.name.trim().length
  if (nameLength < DOCUMENT_SOURCE_LIMITS.nameLength.min) throw new Error('文档源名称不能为空')
  if (nameLength > DOCUMENT_SOURCE_LIMITS.nameLength.max) {
    throw new Error(`文档源名称不能超过 ${DOCUMENT_SOURCE_LIMITS.nameLength.max} 个字符`)
  }
  if (
    !Number.isInteger(input.pageLimit) ||
    input.pageLimit < DOCUMENT_SOURCE_LIMITS.pageLimit.min ||
    input.pageLimit > DOCUMENT_SOURCE_LIMITS.pageLimit.max
  ) {
    throw new Error(
      `页面上限必须在 ${DOCUMENT_SOURCE_LIMITS.pageLimit.min} 到 ${DOCUMENT_SOURCE_LIMITS.pageLimit.max} 之间`
    )
  }
  if (!['auto', 'http', 'browser'].includes(input.mode)) throw new Error('不支持的抓取方式')
  normalizeScopePath(input.scopePath ?? DOCUMENT_SOURCE_DEFAULTS.scopePath)
  normalizeExcludePathPattern(input.excludePathPattern)
  if (input.httpConcurrency !== null) validateConcurrency(input.httpConcurrency, '文档源 HTTP 并发')
  if (input.browserConcurrency !== null) {
    validateConcurrency(input.browserConcurrency, '文档源浏览器并发')
  }
  if (input.githubArchiveLimitMb != null) {
    validateMegabytes(input.githubArchiveLimitMb, 'GitHub ZIP 上限')
  }
  if (input.githubMarkdownLimitMb != null) {
    validateMegabytes(input.githubMarkdownLimitMb, 'GitHub Markdown 上限')
  }
  return normalizeCronSchedule(input.schedule)
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value)
  )
}

export function toDocumentSource(row: SourceRow): DocumentSource {
  return {
    id: row.id,
    name: row.name,
    url: row.first_url,
    mode: row.fetch_mode,
    status: Number(row.page_count) > 0 ? 'healthy' : 'attention',
    pages: Number(row.page_count),
    contentSize: Number(row.content_size),
    pageLimit: Number(row.page_limit),
    scopePath: row.scope_path,
    excludePathPattern: row.exclude_path_pattern ?? null,
    lastUpdated: row.last_crawled_at ? formatDate(row.last_crawled_at) : '尚未更新',
    schedule: row.schedule,
    httpConcurrency: row.http_concurrency === null ? null : Number(row.http_concurrency),
    browserConcurrency: row.browser_concurrency === null ? null : Number(row.browser_concurrency),
    iconUrl: row.icon_url,
    cloud:
      row.source_type === 'cloud' &&
      row.cloud_server_url &&
      row.cloud_library_id &&
      row.cloud_revision
        ? {
            serverUrl: row.cloud_server_url,
            libraryId: row.cloud_library_id,
            revision: row.cloud_revision,
            autoSync: Boolean(row.cloud_auto_sync)
          }
        : null,
    kind: row.document_kind,
    githubArchiveLimitMb:
      row.github_archive_limit_mb === null ? null : Number(row.github_archive_limit_mb),
    githubMarkdownLimitMb:
      row.github_markdown_limit_mb === null ? null : Number(row.github_markdown_limit_mb),
    githubDefaultBranch: row.github_default_branch,
    githubRevision: row.github_revision
  }
}

export function toDocumentRecord(row: DocumentRow): DocumentRecord {
  const path = row.relative_path
    ? row.relative_path.split('/').filter(Boolean)
    : new URL(row.url).pathname.split('/').filter(Boolean)
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    title: row.title,
    url: row.url,
    folder: path.slice(0, -1).join(' / ') || row.source_name,
    language: row.language,
    updatedAt: formatDate(row.crawled_at),
    content: row.markdown
  }
}

export function migrateDatabase(database: DatabaseSync, previousVersion = 0): void {
  if (previousVersion < 12 && hasColumn(database, 'app_settings', 'mcp_port')) {
    database.exec('ALTER TABLE app_settings DROP COLUMN mcp_port')
  }
  addColumn(database, 'document_sources', 'icon_url', 'TEXT')
  addColumn(
    database,
    'document_sources',
    'scope_path',
    `TEXT NOT NULL DEFAULT '${DOCUMENT_SOURCE_DEFAULTS.scopePath}'`
  )
  addColumn(database, 'document_sources', 'exclude_path_pattern', 'TEXT')
  const hasLegacyConcurrency = hasColumn(database, 'document_sources', 'concurrency')
  if (
    addColumn(database, 'document_sources', 'http_concurrency', 'INTEGER') &&
    hasLegacyConcurrency
  ) {
    database.exec('UPDATE document_sources SET http_concurrency = concurrency')
  }
  if (
    addColumn(database, 'document_sources', 'browser_concurrency', 'INTEGER') &&
    hasLegacyConcurrency
  ) {
    database.exec('UPDATE document_sources SET browser_concurrency = concurrency')
  }
  addColumn(
    database,
    'app_settings',
    'http_concurrency',
    `INTEGER NOT NULL DEFAULT ${DEFAULT_APP_SETTINGS.httpConcurrency}`
  )
  addColumn(
    database,
    'app_settings',
    'browser_concurrency',
    `INTEGER NOT NULL DEFAULT ${DEFAULT_APP_SETTINGS.browserConcurrency}`
  )
  const addedCrawlDefaults = addColumn(
    database,
    'app_settings',
    'max_retries',
    `INTEGER NOT NULL DEFAULT ${DEFAULT_APP_SETTINGS.maxRetries}`
  )
  addColumn(
    database,
    'app_settings',
    'batch_interval_seconds',
    `INTEGER NOT NULL DEFAULT ${APP_SETTINGS_LIMITS.batchIntervalSeconds.disabled}`
  )
  if (addedCrawlDefaults) {
    database.exec(
      `UPDATE app_settings SET browser_concurrency = ${DEFAULT_APP_SETTINGS.browserConcurrency} WHERE browser_concurrency = 2`
    )
  }
  addColumn(
    database,
    'app_settings',
    'server_url',
    `TEXT NOT NULL DEFAULT '${PRODUCTION_SERVER_URL}'`
  )
  addColumn(
    database,
    'app_settings',
    'server_url_customized',
    'INTEGER NOT NULL DEFAULT 0 CHECK (server_url_customized IN (0, 1))'
  )
  addColumn(
    database,
    'document_sources',
    'source_type',
    "TEXT NOT NULL DEFAULT 'local' CHECK (source_type IN ('local', 'cloud'))"
  )
  addColumn(database, 'document_sources', 'cloud_server_url', 'TEXT')
  addColumn(database, 'document_sources', 'cloud_library_id', 'TEXT')
  addColumn(database, 'document_sources', 'cloud_revision', 'TEXT')
  addColumn(
    database,
    'document_sources',
    'cloud_auto_sync',
    'INTEGER NOT NULL DEFAULT 0 CHECK (cloud_auto_sync IN (0, 1))'
  )
  addColumn(
    database,
    'document_sources',
    'document_kind',
    "TEXT NOT NULL DEFAULT 'web' CHECK (document_kind IN ('web', 'github'))"
  )
  addColumn(database, 'document_sources', 'source_identity', 'TEXT')
  addColumn(database, 'document_sources', 'github_archive_limit_mb', 'INTEGER')
  addColumn(database, 'document_sources', 'github_markdown_limit_mb', 'INTEGER')
  addColumn(database, 'document_sources', 'github_default_branch', 'TEXT')
  addColumn(database, 'document_sources', 'github_revision', 'TEXT')
  addColumn(database, 'document_sources', 'github_blocked_revision', 'TEXT')
  addColumn(database, 'document_sources', 'github_blocked_limit_kind', 'TEXT')
  addColumn(database, 'document_sources', 'github_blocked_limit_bytes', 'INTEGER')
  addColumn(database, 'documents', 'relative_path', 'TEXT')
  addColumn(
    database,
    'app_settings',
    'github_archive_limit_mb',
    `INTEGER NOT NULL DEFAULT ${DEFAULT_APP_SETTINGS.githubArchiveLimitMb}`
  )
  addColumn(
    database,
    'app_settings',
    'github_markdown_limit_mb',
    `INTEGER NOT NULL DEFAULT ${DEFAULT_APP_SETTINGS.githubMarkdownLimitMb}`
  )
  database.exec(
    `UPDATE document_sources SET source_identity = hostname
     WHERE source_type = 'local' AND source_identity IS NULL`
  )
  if (previousVersion < 7) {
    database.exec(
      `UPDATE document_sources SET source_identity = hostname || '|' || scope_path
       WHERE source_type = 'local' AND document_kind = 'web'`
    )
  }
  database.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS document_sources_cloud_origin
     ON document_sources(cloud_server_url, cloud_library_id)
     WHERE source_type = 'cloud'`
  )
  database.exec('DROP INDEX IF EXISTS document_sources_local_hostname')
  database.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS document_sources_local_identity
     ON document_sources(source_identity)
     WHERE source_type = 'local'`
  )
  database.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS documents_relative_path
     ON documents(source_id, relative_path)
     WHERE relative_path IS NOT NULL`
  )
}

function addColumn(
  database: DatabaseSync,
  table: string,
  column: string,
  definition: string
): boolean {
  if (hasColumn(database, table, column)) return false
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  return true
}

function hasColumn(database: DatabaseSync, table: string, column: string): boolean {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as unknown as {
    name: string
  }[]
  return columns.some((item) => item.name === column)
}

function validateConcurrency(value: number, label: string): void {
  if (
    !Number.isInteger(value) ||
    value < APP_SETTINGS_LIMITS.concurrency.min ||
    value > APP_SETTINGS_LIMITS.concurrency.max
  ) {
    throw new Error(
      `${label}必须是 ${APP_SETTINGS_LIMITS.concurrency.min} 到 ${APP_SETTINGS_LIMITS.concurrency.max} 之间的整数`
    )
  }
}

function validateMegabytes(value: number, label: string): void {
  if (
    !Number.isInteger(value) ||
    value < APP_SETTINGS_LIMITS.githubSizeMb.min ||
    value > APP_SETTINGS_LIMITS.githubSizeMb.max
  ) {
    throw new Error(
      `${label}必须是 ${APP_SETTINGS_LIMITS.githubSizeMb.min} 到 ${APP_SETTINGS_LIMITS.githubSizeMb.max} 之间的整数 MB`
    )
  }
}

export function toSearchTokens(query: string): string[] {
  return [
    ...new Set(
      query
        .normalize('NFKC')
        .trim()
        .split(/[^\p{L}\p{N}_-]+/u)
        .filter(Boolean)
    )
  ]
}

export function toFtsExpression(query: string, operator: 'AND' | 'OR' = 'AND'): string {
  return toSearchTokens(query)
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(` ${operator} `)
}
