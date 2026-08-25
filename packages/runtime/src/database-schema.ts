import { DOCUMENT_SOURCE_DEFAULTS, DOCUMENT_SOURCE_LIMITS } from '@loci/core'
import { APP_SETTINGS_LIMITS, DEFAULT_APP_SETTINGS, PRODUCTION_SERVER_URL } from '@loci/shared'

export const LOCI_SCHEMA_VERSION = 13

// 基础表结构集中维护，具体子模块的增量表由各自初始化函数负责。
export const LOCI_DATABASE_SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS document_sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    first_url TEXT NOT NULL,
    hostname TEXT NOT NULL,
    fetch_mode TEXT NOT NULL CHECK (fetch_mode IN ('auto', 'http', 'browser')),
    page_limit INTEGER NOT NULL DEFAULT ${DOCUMENT_SOURCE_DEFAULTS.pageLimit} CHECK (page_limit BETWEEN ${DOCUMENT_SOURCE_LIMITS.pageLimit.min} AND ${DOCUMENT_SOURCE_LIMITS.pageLimit.max}),
    scope_path TEXT NOT NULL DEFAULT '${DOCUMENT_SOURCE_DEFAULTS.scopePath}',
    exclude_path_pattern TEXT,
    schedule TEXT,
    http_concurrency INTEGER CHECK (http_concurrency IS NULL OR http_concurrency BETWEEN ${DOCUMENT_SOURCE_LIMITS.concurrency.min} AND ${DOCUMENT_SOURCE_LIMITS.concurrency.max}),
    browser_concurrency INTEGER CHECK (browser_concurrency IS NULL OR browser_concurrency BETWEEN ${DOCUMENT_SOURCE_LIMITS.concurrency.min} AND ${DOCUMENT_SOURCE_LIMITS.concurrency.max}),
    icon_url TEXT,
    document_kind TEXT NOT NULL DEFAULT 'web' CHECK (document_kind IN ('web', 'github')),
    source_identity TEXT,
    github_archive_limit_mb INTEGER CHECK (github_archive_limit_mb IS NULL OR github_archive_limit_mb BETWEEN ${DOCUMENT_SOURCE_LIMITS.githubSizeMb.min} AND ${DOCUMENT_SOURCE_LIMITS.githubSizeMb.max}),
    github_markdown_limit_mb INTEGER CHECK (github_markdown_limit_mb IS NULL OR github_markdown_limit_mb BETWEEN ${DOCUMENT_SOURCE_LIMITS.githubSizeMb.min} AND ${DOCUMENT_SOURCE_LIMITS.githubSizeMb.max}),
    github_default_branch TEXT,
    github_revision TEXT,
    github_blocked_revision TEXT,
    github_blocked_limit_kind TEXT CHECK (github_blocked_limit_kind IS NULL OR github_blocked_limit_kind IN ('archive', 'markdown')),
    github_blocked_limit_bytes INTEGER,
    source_type TEXT NOT NULL DEFAULT 'local' CHECK (source_type IN ('local', 'cloud')),
    cloud_server_url TEXT,
    cloud_library_id TEXT,
    cloud_revision TEXT,
    cloud_auto_sync INTEGER NOT NULL DEFAULT 0 CHECK (cloud_auto_sync IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES document_sources(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    crawled_at TEXT NOT NULL,
    markdown TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'und',
    fetch_mode TEXT NOT NULL CHECK (fetch_mode IN ('http', 'browser')),
    relative_path TEXT,
    UNIQUE(source_id, url)
  ) STRICT;

  CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    document_id UNINDEXED,
    source_id UNINDEXED,
    title,
    markdown
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    theme TEXT NOT NULL CHECK (theme IN ('auto', 'light', 'dark')),
    http_concurrency INTEGER NOT NULL DEFAULT ${DEFAULT_APP_SETTINGS.httpConcurrency} CHECK (http_concurrency BETWEEN ${APP_SETTINGS_LIMITS.concurrency.min} AND ${APP_SETTINGS_LIMITS.concurrency.max}),
    browser_concurrency INTEGER NOT NULL DEFAULT ${DEFAULT_APP_SETTINGS.browserConcurrency} CHECK (browser_concurrency BETWEEN ${APP_SETTINGS_LIMITS.concurrency.min} AND ${APP_SETTINGS_LIMITS.concurrency.max}),
    max_retries INTEGER NOT NULL DEFAULT ${DEFAULT_APP_SETTINGS.maxRetries} CHECK (max_retries BETWEEN ${APP_SETTINGS_LIMITS.maxRetries.min} AND ${APP_SETTINGS_LIMITS.maxRetries.max}),
    batch_interval_seconds INTEGER NOT NULL DEFAULT ${APP_SETTINGS_LIMITS.batchIntervalSeconds.disabled} CHECK (
      batch_interval_seconds = ${APP_SETTINGS_LIMITS.batchIntervalSeconds.disabled} OR batch_interval_seconds BETWEEN ${APP_SETTINGS_LIMITS.batchIntervalSeconds.min} AND ${APP_SETTINGS_LIMITS.batchIntervalSeconds.max}
    ),
    server_url TEXT NOT NULL DEFAULT '${PRODUCTION_SERVER_URL}',
    server_url_customized INTEGER NOT NULL DEFAULT 0 CHECK (server_url_customized IN (0, 1)),
    github_archive_limit_mb INTEGER NOT NULL DEFAULT ${DEFAULT_APP_SETTINGS.githubArchiveLimitMb} CHECK (github_archive_limit_mb BETWEEN ${APP_SETTINGS_LIMITS.githubSizeMb.min} AND ${APP_SETTINGS_LIMITS.githubSizeMb.max}),
    github_markdown_limit_mb INTEGER NOT NULL DEFAULT ${DEFAULT_APP_SETTINGS.githubMarkdownLimitMb} CHECK (github_markdown_limit_mb BETWEEN ${APP_SETTINGS_LIMITS.githubSizeMb.min} AND ${APP_SETTINGS_LIMITS.githubSizeMb.max})
  ) STRICT;

  CREATE TABLE IF NOT EXISTS interaction_preferences (
    scope TEXT NOT NULL,
    preference_key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(scope, preference_key)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS skill_installations (
    id TEXT PRIMARY KEY,
    skill_name TEXT NOT NULL,
    requested_agent TEXT NOT NULL CHECK (
      requested_agent IN ('universal', 'codex', 'cursor', 'claude-code', 'vscode', 'antigravity')
    ),
    resolved_target TEXT NOT NULL UNIQUE,
    scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
    project_root TEXT,
    package_version TEXT NOT NULL,
    content_digest TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      (scope = 'global' AND project_root IS NULL) OR
      (scope = 'project' AND project_root IS NOT NULL)
    )
  ) STRICT;
`
