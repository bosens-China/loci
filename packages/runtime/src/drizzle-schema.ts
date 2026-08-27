import type {
  AppSettings,
  ConcreteSkillAgent,
  CrawlFailure,
  ResolvedSourceDiscovery,
  ResourceRevisionKey,
  OperationLog,
  SkillScope
} from '@loci/shared'
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * 普通查询使用的类型化表映射。
 *
 * 数据库初始化和迁移仍由 database-schema.ts 与 user_version 体系负责；
 * FTS 虚拟表等 SQLite 特有结构不在这里重复表达。
 */
export const documentSources = sqliteTable('document_sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  firstUrl: text('first_url').notNull(),
  hostname: text('hostname').notNull(),
  fetchMode: text('fetch_mode').$type<'auto' | 'http' | 'browser'>().notNull(),
  pageLimit: integer('page_limit').notNull(),
  scopePath: text('scope_path').notNull(),
  excludePathPattern: text('exclude_path_pattern'),
  schedule: text('schedule'),
  httpConcurrency: integer('http_concurrency'),
  browserConcurrency: integer('browser_concurrency'),
  iconUrl: text('icon_url'),
  documentKind: text('document_kind').$type<'web' | 'github'>().notNull(),
  sourceIdentity: text('source_identity'),
  githubArchiveLimitMb: integer('github_archive_limit_mb'),
  githubMarkdownLimitMb: integer('github_markdown_limit_mb'),
  githubDefaultBranch: text('github_default_branch'),
  githubRevision: text('github_revision'),
  githubBlockedRevision: text('github_blocked_revision'),
  githubBlockedLimitKind: text('github_blocked_limit_kind').$type<'archive' | 'markdown'>(),
  githubBlockedLimitBytes: integer('github_blocked_limit_bytes'),
  discoveryMode: text('discovery_mode').$type<'site' | 'agent_review'>().notNull(),
  resolvedDiscovery: text('resolved_discovery').$type<ResolvedSourceDiscovery>(),
  reviewGoal: text('review_goal'),
  sourceType: text('source_type').$type<'local' | 'cloud'>().notNull(),
  cloudServerUrl: text('cloud_server_url'),
  cloudLibraryId: text('cloud_library_id'),
  cloudRevision: text('cloud_revision'),
  cloudAutoSync: integer('cloud_auto_sync').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  sourceId: text('source_id')
    .notNull()
    .references(() => documentSources.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  url: text('url').notNull(),
  crawledAt: text('crawled_at').notNull(),
  markdown: text('markdown').notNull(),
  language: text('language').notNull(),
  fetchMode: text('fetch_mode').$type<'http' | 'browser'>().notNull(),
  relativePath: text('relative_path')
})

export const crawlRuns = sqliteTable('crawl_runs', {
  id: text('id').primaryKey(),
  sourceId: text('source_id')
    .notNull()
    .references(() => documentSources.id, { onDelete: 'cascade' }),
  status: text('status').$type<'queued' | 'running' | 'completed' | 'failed'>().notNull(),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  discoveredCount: integer('discovered_count').notNull(),
  successCount: integer('success_count').notNull(),
  failureCount: integer('failure_count').notNull(),
  errorMessage: text('error_message'),
  progressJson: text('progress_json'),
  updatedAt: text('updated_at')
})

export const crawlFailures = sqliteTable('crawl_failures', {
  id: text('id').primaryKey(),
  runId: text('run_id')
    .notNull()
    .references(() => crawlRuns.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  reason: text('reason').$type<CrawlFailure['reason']>().notNull(),
  message: text('message').notNull(),
  retryable: integer('retryable').notNull(),
  statusCode: integer('status_code'),
  redirectUrl: text('redirect_url')
})

export const explicitPageTargets = sqliteTable(
  'explicit_page_targets',
  {
    sourceId: text('source_id')
      .notNull()
      .references(() => documentSources.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    status: text('status').$type<'pending' | 'current' | 'missing' | 'failed'>().notNull(),
    lastCrawledAt: text('last_crawled_at'),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => [primaryKey({ columns: [table.sourceId, table.url] })]
)

export const appSettings = sqliteTable('app_settings', {
  id: integer('id').primaryKey(),
  theme: text('theme').$type<AppSettings['theme']>().notNull(),
  httpConcurrency: integer('http_concurrency').notNull(),
  browserConcurrency: integer('browser_concurrency').notNull(),
  maxRetries: integer('max_retries').notNull(),
  batchIntervalSeconds: integer('batch_interval_seconds').notNull(),
  batchIntervalMaxSeconds: integer('batch_interval_max_seconds').notNull(),
  serverUrl: text('server_url').notNull(),
  serverUrlCustomized: integer('server_url_customized').notNull(),
  githubArchiveLimitMb: integer('github_archive_limit_mb').notNull(),
  githubMarkdownLimitMb: integer('github_markdown_limit_mb').notNull()
})

export const hostnameCrawlPolicies = sqliteTable('hostname_crawl_policies', {
  hostname: text('hostname').primaryKey(),
  httpConcurrency: integer('http_concurrency'),
  browserConcurrency: integer('browser_concurrency'),
  batchIntervalMinSeconds: integer('batch_interval_min_seconds'),
  batchIntervalMaxSeconds: integer('batch_interval_max_seconds'),
  updatedAt: text('updated_at').notNull()
})

export const operationLogs = sqliteTable('operation_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  category: text('category').$type<OperationLog['category']>().notNull(),
  action: text('action').notNull(),
  level: text('level').$type<OperationLog['level']>().notNull(),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
  hostname: text('hostname'),
  message: text('message').notNull(),
  detailsJson: text('details_json'),
  createdAt: text('created_at').notNull()
})

export const documentMoveOperations = sqliteTable('document_move_operations', {
  operationId: text('operation_id').primaryKey(),
  requestHash: text('request_hash').notNull(),
  targetSourceId: text('target_source_id').notNull(),
  movedCount: integer('moved_count').notNull(),
  deletedSourceIdsJson: text('deleted_source_ids_json').notNull(),
  createdAt: text('created_at').notNull()
})

export const interactionPreferences = sqliteTable(
  'interaction_preferences',
  {
    scope: text('scope').notNull(),
    preferenceKey: text('preference_key').notNull(),
    valueJson: text('value_json').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => [primaryKey({ columns: [table.scope, table.preferenceKey] })]
)

export const skillInstallations = sqliteTable('skill_installations', {
  id: text('id').primaryKey(),
  skillName: text('skill_name').notNull(),
  requestedAgent: text('requested_agent').$type<ConcreteSkillAgent>().notNull(),
  resolvedTarget: text('resolved_target').notNull().unique(),
  scope: text('scope').$type<SkillScope>().notNull(),
  projectRoot: text('project_root'),
  packageVersion: text('package_version').notNull(),
  contentDigest: text('content_digest').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export const resourceRevisions = sqliteTable('resource_revisions', {
  resource: text('resource').$type<ResourceRevisionKey>().primaryKey(),
  revision: integer('revision').notNull()
})
