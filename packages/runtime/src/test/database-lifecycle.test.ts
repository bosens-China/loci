import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createDatabase, databaseNeedsMigration, LOCI_SCHEMA_VERSION } from '../database.js'

describe('database lifecycle', () => {
  it('records the schema version and rejects a database from a newer client', () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-version-'))
    const filename = join(directory, 'future.sqlite')
    expect(databaseNeedsMigration(filename)).toBe(true)
    const current = createDatabase(filename)
    expect(current.schemaVersion).toBe(LOCI_SCHEMA_VERSION)
    current.close()
    expect(databaseNeedsMigration(filename)).toBe(false)

    const future = new DatabaseSync(filename)
    future.exec(`PRAGMA user_version = ${LOCI_SCHEMA_VERSION + 1}`)
    future.close()

    expect(() => createDatabase(filename)).toThrow()
    rmSync(directory, { recursive: true, force: true })
  })

  it('保留旧版审查库的正文、ID、FTS 索引和附加表', () => {
    const root = mkdtempSync(join(tmpdir(), 'loci-review-migration-'))
    const filename = join(root, 'loci.sqlite')
    try {
      const original = createDatabase(filename)
      const source = original.createSource({
        name: 'Legacy',
        url: 'https://legacy.test',
        mode: 'http',
        pageLimit: 1,
        httpConcurrency: null,
        browserConcurrency: null
      })
      original.saveDocument({
        sourceId: source.id,
        url: source.url,
        title: 'Stored',
        markdown: 'retained content',
        fetchMode: 'http',
        language: 'en',
        crawledAt: new Date().toISOString()
      })
      const id = original.listDocumentSummaries(source.id)[0]!.id
      original.close()
      const old = new DatabaseSync(filename)
      old.exec(
        'ALTER TABLE documents DROP COLUMN manual; PRAGMA user_version = 19; CREATE TABLE url_review_runs (id TEXT PRIMARY KEY, source_id TEXT REFERENCES document_sources(id) ON DELETE CASCADE)'
      )
      old.prepare('INSERT INTO url_review_runs VALUES (?,?)').run('review', source.id)
      old
        .prepare(
          "UPDATE document_sources SET discovery_mode='agent_review', review_goal='Legacy goal', schedule='0 1 * * *' WHERE id=?"
        )
        .run(source.id)
      old.close()
      const migrated = createDatabase(filename)
      try {
        expect(migrated.getDocument(id)?.content).toBe('retained content')
        expect(migrated.searchDocumentSummaries('retained', source.id)[0]?.id).toBe(id)
        expect(migrated.exportBackup().data.documents[0]).toMatchObject({ id, manual: 0 })
        expect(migrated.exportBackup().data.sources[0]).toMatchObject({
          discovery_mode: 'agent_review',
          review_goal: 'Legacy goal'
        })
      } finally {
        migrated.close()
      }
      const check = new DatabaseSync(filename, { readOnly: true })
      try {
        expect(check.prepare('SELECT id FROM url_review_runs').get()?.id).toBe('review')
      } finally {
        check.close()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('清空全部文档源及其关联数据但保留设置', () => {
    const database = createDatabase(':memory:')
    try {
      for (const [name, url] of [
        ['React', 'https://react.dev'],
        ['Vue', 'https://vuejs.org']
      ]) {
        const source = database.createSource({
          name,
          url,
          mode: 'http',
          pageLimit: 100,
          httpConcurrency: null,
          browserConcurrency: null
        })
        database.saveDocument({
          sourceId: source.id,
          url,
          title: name,
          markdown: `# ${name} Components`,
          language: 'en',
          fetchMode: 'http',
          crawledAt: new Date().toISOString()
        })
        database.startCrawlRun(source.id)
      }

      const settings = database.getSettings()
      expect(database.clearSources()).toBe(2)
      expect(database.listSources()).toEqual([])
      expect(database.listDocuments()).toEqual([])
      expect(database.searchDocuments('Components')).toEqual([])
      expect(database.listCrawlHistory()).toEqual([])
      expect(database.getSettings()).toEqual(settings)
    } finally {
      database.close()
    }
  })

  it('migrates existing settings and document source tables', () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-'))
    const filename = join(directory, 'legacy.sqlite')
    const legacy = new DatabaseSync(filename)
    legacy.exec(`
      CREATE TABLE document_sources (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, first_url TEXT NOT NULL, hostname TEXT NOT NULL,
        fetch_mode TEXT NOT NULL, page_limit INTEGER NOT NULL, schedule TEXT, concurrency INTEGER,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE app_settings (
        id INTEGER PRIMARY KEY, mcp_port INTEGER NOT NULL CHECK (mcp_port BETWEEN 1024 AND 65535), theme TEXT NOT NULL,
        http_concurrency INTEGER NOT NULL, browser_concurrency INTEGER NOT NULL
      ) STRICT;
      INSERT INTO app_settings VALUES (1, 37373, 'auto', 9, 2);
      INSERT INTO document_sources VALUES (
        'legacy-source', 'Legacy', 'https://example.com', 'example.com', 'auto', 1000, NULL, 5,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
    `)
    legacy.close()

    const database = createDatabase(filename)
    try {
      expect(database.getSettings()).toMatchObject({
        httpConcurrency: 9,
        browserConcurrency: 5,
        maxRetries: 3,
        batchIntervalSeconds: 0
      })
      expect(
        database.createSource({
          name: 'Vue',
          url: 'https://vuejs.org',
          mode: 'auto',
          pageLimit: 1000,
          httpConcurrency: null,
          browserConcurrency: null
        })
      ).toMatchObject({ httpConcurrency: null, browserConcurrency: null, iconUrl: null })
      expect(database.listSources().find((source) => source.id === 'legacy-source')).toMatchObject({
        httpConcurrency: 5,
        browserConcurrency: 5,
        excludePathPattern: null,
        resolvedDiscovery: null
      })
    } finally {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('把旧版 hostname 标识迁移为 hostname 与收录范围组合', () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-scope-'))
    const filename = join(directory, 'scope.sqlite')
    const initial = createDatabase(filename)
    const root = initial.createSource({
      name: 'Vite',
      url: 'https://vite.dev/guide',
      mode: 'http',
      pageLimit: 100,
      scopePath: '/',
      httpConcurrency: null,
      browserConcurrency: null
    })
    initial.close()

    const legacy = new DatabaseSync(filename)
    legacy.exec(`UPDATE document_sources SET source_identity = hostname; PRAGMA user_version = 6`)
    legacy.close()

    const migrated = createDatabase(filename)
    try {
      const api = migrated.createSource({
        name: 'Vite API',
        url: 'https://vite.dev/api',
        mode: 'http',
        pageLimit: 100,
        scopePath: '/api',
        httpConcurrency: null,
        browserConcurrency: null
      })
      expect(api.id).not.toBe(root.id)
      expect(
        migrated.createSource({
          name: 'Vite Duplicate',
          url: 'https://vite.dev/start',
          mode: 'http',
          pageLimit: 100,
          scopePath: '/',
          httpConcurrency: null,
          browserConcurrency: null
        }).id
      ).toBe(root.id)
    } finally {
      migrated.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
