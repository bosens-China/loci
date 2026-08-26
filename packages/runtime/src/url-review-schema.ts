import type { DatabaseSync } from 'node:sqlite'

export function initializeUrlReviewDatabase(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS url_review_runs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES document_sources(id) ON DELETE CASCADE,
      goal TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('discovering', 'awaiting_review', 'completed', 'failed', 'cancelled')),
      discovery TEXT NOT NULL DEFAULT 'new' CHECK (discovery IN ('new', 'llms', 'openapi', 'sitemap', 'pages')),
      fetch_mode TEXT NOT NULL CHECK (fetch_mode IN ('auto', 'http', 'browser')),
      first_url TEXT NOT NULL,
      icon_url TEXT,
      limit_reached INTEGER NOT NULL DEFAULT 0 CHECK (limit_reached IN (0, 1)),
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS url_review_runs_active_source
      ON url_review_runs(source_id)
      WHERE status IN ('discovering', 'awaiting_review');
    CREATE TABLE IF NOT EXISTS url_review_candidates (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES url_review_runs(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      title_source TEXT NOT NULL CHECK (title_source IN ('provided', 'stored', 'link_text', 'llms', 'openapi', 'pathname')),
      discovered_from TEXT,
      decision TEXT NOT NULL CHECK (decision IN ('pending', 'approved', 'excluded')),
      batch_id TEXT,
      processed_at TEXT,
      document_json TEXT,
      failure_json TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(run_id, url)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS url_review_candidates_batch
      ON url_review_candidates(run_id, batch_id, decision);
  `)
}
