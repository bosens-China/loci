import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** 仅描述 Server 普通查询所需的实体；DDL 仍由 database-schema.ts 负责。 */
export const libraries = sqliteTable('libraries', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  firstUrl: text('first_url').notNull(),
  hostname: text('hostname').notNull(),
  scopePath: text('scope_path').notNull(),
  pageLimit: integer('page_limit').notNull(),
  schedule: text('schedule'),
  lastCrawledAt: text('last_crawled_at'),
  lastError: text('last_error'),
  githubRevision: text('github_revision'),
  githubBlockedRevision: text('github_blocked_revision'),
  githubBlockedLimitKind: text('github_blocked_limit_kind').$type<'archive' | 'markdown'>(),
  githubBlockedLimitBytes: integer('github_blocked_limit_bytes'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export const serverDocuments = sqliteTable('documents', {
  id: text('id').primaryKey(),
  libraryId: text('library_id')
    .notNull()
    .references(() => libraries.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  url: text('url').notNull(),
  language: text('language').notNull(),
  markdown: text('markdown').notNull(),
  crawledAt: text('crawled_at').notNull(),
  relativePath: text('relative_path')
})

export const librarySnapshots = sqliteTable('library_snapshots', {
  libraryId: text('library_id')
    .primaryKey()
    .references(() => libraries.id, { onDelete: 'cascade' }),
  revision: text('revision').notNull(),
  publishedAt: text('published_at').notNull(),
  pageCount: integer('page_count').notNull(),
  byteSize: integer('byte_size').notNull(),
  content: text('content').notNull()
})

export const syncJobs = sqliteTable('sync_jobs', {
  id: text('id').primaryKey(),
  libraryId: text('library_id')
    .notNull()
    .references(() => libraries.id, { onDelete: 'cascade' }),
  status: text('status')
    .$type<
      | 'queued'
      | 'running'
      | 'canceling'
      | 'canceled'
      | 'completed'
      | 'completed_with_errors'
      | 'failed'
    >()
    .notNull()
})
