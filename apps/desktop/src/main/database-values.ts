import type { DatabaseSync } from 'node:sqlite'
import { normalizeCronSchedule } from '@loci/shared'
import type { AppSettings, CreateSourceInput, DocumentRecord, DocumentSource } from '@loci/shared'
import { normalizeServerUrl } from '@loci/shared'
import { normalizeScopePath } from './crawl/url'

export interface SourceRow {
  id: string
  name: string
  first_url: string
  fetch_mode: 'auto' | 'http' | 'browser'
  page_limit: number
  scope_path: string
  schedule: string | null
  http_concurrency: number | null
  browser_concurrency: number | null
  icon_url: string | null
  page_count: number
  last_crawled_at: string | null
  source_type: 'local' | 'cloud'
  cloud_server_url: string | null
  cloud_library_id: string | null
  cloud_revision: string | null
  cloud_auto_sync: number
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
}

export function validateSettings(settings: AppSettings): AppSettings {
  if (!Number.isInteger(settings.mcpPort) || settings.mcpPort < 1024 || settings.mcpPort > 65535) {
    throw new Error('MCP 端口必须是 1024 到 65535 之间的整数')
  }
  if (!['auto', 'light', 'dark'].includes(settings.theme)) throw new Error('不支持的主题设置')
  validateConcurrency(settings.httpConcurrency, 'HTTP 默认并发')
  validateConcurrency(settings.browserConcurrency, '浏览器默认并发')
  return { ...settings, serverUrl: normalizeServerUrl(settings.serverUrl) }
}

export function validateSourceInput(input: CreateSourceInput): string | null {
  if (!input.name.trim()) throw new Error('文档源名称不能为空')
  if (!Number.isInteger(input.pageLimit) || input.pageLimit < 1 || input.pageLimit > 10000) {
    throw new Error('页面上限必须在 1 到 10000 之间')
  }
  if (!['auto', 'http', 'browser'].includes(input.mode)) throw new Error('不支持的抓取方式')
  normalizeScopePath(input.scopePath ?? '/')
  if (input.httpConcurrency !== null) validateConcurrency(input.httpConcurrency, '文档源 HTTP 并发')
  if (input.browserConcurrency !== null) {
    validateConcurrency(input.browserConcurrency, '文档源浏览器并发')
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
    pageLimit: Number(row.page_limit),
    scopePath: row.scope_path,
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
        : null
  }
}

export function toDocumentRecord(row: DocumentRow): DocumentRecord {
  const path = new URL(row.url).pathname.split('/').filter(Boolean)
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

export function migrateDatabase(database: DatabaseSync): void {
  addColumn(database, 'document_sources', 'icon_url', 'TEXT')
  addColumn(database, 'document_sources', 'scope_path', "TEXT NOT NULL DEFAULT '/'")
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
  addColumn(database, 'app_settings', 'http_concurrency', 'INTEGER NOT NULL DEFAULT 9')
  addColumn(database, 'app_settings', 'browser_concurrency', 'INTEGER NOT NULL DEFAULT 2')
  addColumn(database, 'app_settings', 'server_url', "TEXT NOT NULL DEFAULT 'http://localhost:7001'")
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
  database.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS document_sources_cloud_origin
     ON document_sources(cloud_server_url, cloud_library_id)
     WHERE source_type = 'cloud'`
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
  if (!Number.isInteger(value) || value < 1 || value > 32) {
    throw new Error(`${label}必须是 1 到 32 之间的整数`)
  }
}

export function toFtsExpression(query: string): string {
  return query
    .trim()
    .split(/\s+/u)
    .map((token) => token.replace(/[^\p{L}\p{N}_-]/gu, ''))
    .filter(Boolean)
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(' AND ')
}
