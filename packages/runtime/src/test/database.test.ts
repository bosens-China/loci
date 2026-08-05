import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createDatabase, databaseNeedsMigration, LOCI_SCHEMA_VERSION } from '../database.js'

describe('createDatabase', () => {
  it('creates and lists a document source', () => {
    const database = createDatabase(':memory:')
    try {
      const source = database.createSource({
        name: 'React',
        url: 'https://react.dev/learn#start',
        mode: 'auto',
        pageLimit: 1000,
        schedule: '0 2 * * *',
        httpConcurrency: 6,
        browserConcurrency: 3
      })
      expect(source.url).toBe('https://react.dev/learn')
      expect(source.schedule).toBe('0 2 * * *')
      expect(source.status).toBe('attention')
      expect(database.listSources()).toEqual([source])
      const markdown = '# Learn React\n\n组件🙂 are reusable.'
      database.saveDocument({
        sourceId: source.id,
        url: source.url,
        title: 'Learn React',
        markdown,
        language: 'en-US',
        fetchMode: 'http',
        crawledAt: new Date().toISOString()
      })
      expect(database.listSources()[0]).toMatchObject({
        pages: 1,
        contentSize: Buffer.byteLength(markdown),
        status: 'healthy'
      })
      expect(database.listDocumentUrls(source.id)).toEqual([source.url])
      expect(
        database.updateSource(source.id, {
          name: 'React',
          url: source.url,
          mode: 'auto',
          pageLimit: 1000,
          schedule: null,
          httpConcurrency: null,
          browserConcurrency: null
        }).schedule
      ).toBeNull()
      database.updateResolvedSource(
        source.id,
        'https://docs.react.dev/learn?from=redirect',
        'http',
        'https://docs.react.dev/favicon.ico'
      )
      expect(database.getSourceConfig(source.id)).toMatchObject({
        firstUrl: 'https://docs.react.dev/learn',
        hostname: 'docs.react.dev',
        fetchMode: 'http'
      })
      expect(database.listDocuments()).toHaveLength(1)
      expect(database.searchDocuments('reusable')[0]?.title).toBe('Learn React')
      expect(database.clearDocuments()).toBe(1)
      expect(database.listDocuments()).toEqual([])
      expect(database.searchDocuments('reusable')).toEqual([])
      expect(database.listSources()[0]).toMatchObject({
        pages: 0,
        contentSize: 0,
        status: 'attention'
      })
      expect(database.getSettings()).toEqual({
        mcpPort: 37373,
        theme: 'auto',
        httpConcurrency: 9,
        browserConcurrency: 5,
        maxRetries: 3,
        batchIntervalSeconds: 0,
        serverUrl: 'https://loci.xiaowo.live'
      })
      expect(
        database.saveSettings({
          mcpPort: 41000,
          theme: 'dark',
          httpConcurrency: 12,
          browserConcurrency: 3,
          maxRetries: 4,
          batchIntervalSeconds: 100,
          serverUrl: 'https://docs.example.com/'
        })
      ).toEqual({
        mcpPort: 41000,
        theme: 'dark',
        httpConcurrency: 12,
        browserConcurrency: 3,
        maxRetries: 4,
        batchIntervalSeconds: 100,
        serverUrl: 'https://docs.example.com'
      })
      expect(database.getSettings()).toEqual({
        mcpPort: 41000,
        theme: 'dark',
        httpConcurrency: 12,
        browserConcurrency: 3,
        maxRetries: 4,
        batchIntervalSeconds: 100,
        serverUrl: 'https://docs.example.com'
      })
      database.deleteSource(source.id)
      expect(database.searchDocuments('Components')).toEqual([])
      expect(() =>
        database.saveSettings({
          mcpPort: 80,
          theme: 'auto',
          httpConcurrency: 9,
          browserConcurrency: 5,
          maxRetries: 3,
          batchIntervalSeconds: 0,
          serverUrl: 'http://localhost:7001'
        })
      ).toThrow('MCP 端口必须是 1024 到 65535 之间的整数')
    } finally {
      database.close()
    }
  })

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

    expect(() => createDatabase(filename)).toThrow('请升级 Loci 后重试')
    rmSync(directory, { recursive: true, force: true })
  })

  it('区分生产默认地址、开发覆盖与用户自定义地址', () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-server-url-'))
    const filename = join(directory, 'loci.sqlite')
    const development = createDatabase(filename, {
      serverUrl: 'http://localhost:7001',
      overrideServerUrl: true
    })
    expect(development.getSettings().serverUrl).toBe('http://localhost:7001')
    development.close()

    const production = createDatabase(filename)
    expect(production.getSettings().serverUrl).toBe('https://loci.xiaowo.live')
    production.saveSettings({
      ...production.getSettings(),
      serverUrl: 'https://custom.example.com'
    })
    production.close()

    const overridden = createDatabase(filename, {
      serverUrl: 'http://localhost:7001',
      overrideServerUrl: true
    })
    expect(overridden.getSettings().serverUrl).toBe('http://localhost:7001')
    overridden.saveSettings({ ...overridden.getSettings(), theme: 'dark' })
    overridden.close()

    const reopened = createDatabase(filename)
    expect(reopened.getSettings().serverUrl).toBe('https://custom.example.com')
    expect(reopened.getSettings().theme).toBe('dark')
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
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
          schedule: null,
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
        id INTEGER PRIMARY KEY, mcp_port INTEGER NOT NULL, theme TEXT NOT NULL,
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
        batchIntervalSeconds: 0,
        serverUrl: 'https://loci.xiaowo.live'
      })
      expect(
        database.createSource({
          name: 'Vue',
          url: 'https://vuejs.org',
          mode: 'auto',
          pageLimit: 1000,
          schedule: null,
          httpConcurrency: null,
          browserConcurrency: null
        })
      ).toMatchObject({ httpConcurrency: null, browserConcurrency: null, iconUrl: null })
      expect(database.listSources().find((source) => source.id === 'legacy-source')).toMatchObject({
        httpConcurrency: 5,
        browserConcurrency: 5
      })
    } finally {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('缩小收录范围时删除越界页面和全文索引', () => {
    const database = createDatabase(':memory:')
    try {
      const source = database.createSource({
        name: 'Docs',
        url: 'https://docs.example.com/guide/start',
        mode: 'http',
        pageLimit: 100,
        scopePath: '/',
        schedule: null,
        httpConcurrency: null,
        browserConcurrency: null
      })
      for (const [url, title] of [
        ['https://docs.example.com/guide/start', 'Guide'],
        ['https://docs.example.com/api/index', 'API']
      ]) {
        database.saveDocument({
          sourceId: source.id,
          url,
          title,
          markdown: `# ${title}`,
          language: 'en',
          fetchMode: 'http',
          crawledAt: new Date().toISOString()
        })
      }
      const updated = database.updateSource(source.id, {
        name: source.name,
        url: source.url,
        mode: source.mode,
        pageLimit: source.pageLimit,
        scopePath: '/guide',
        schedule: null,
        httpConcurrency: null,
        browserConcurrency: null
      })
      expect(updated).toMatchObject({ scopePath: '/guide', pages: 1 })
      expect(database.searchDocuments('API')).toEqual([])
      expect(database.listDocumentUrls(source.id)).toEqual(['https://docs.example.com/guide/start'])
    } finally {
      database.close()
    }
  })
})
