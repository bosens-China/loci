import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createDatabase } from './database'

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
        concurrency: 6
      })
      expect(source.url).toBe('https://react.dev/learn')
      expect(source.schedule).toBe('0 2 * * *')
      expect(source.status).toBe('attention')
      expect(database.listSources()).toEqual([source])
      database.saveDocument({
        sourceId: source.id,
        url: source.url,
        title: 'Learn React',
        markdown: '# Learn React\n\nComponents are reusable.',
        language: 'en-US',
        fetchMode: 'http',
        crawledAt: new Date().toISOString()
      })
      expect(database.listSources()[0]).toMatchObject({ pages: 1, status: 'healthy' })
      expect(database.listDocumentUrls(source.id)).toEqual([source.url])
      expect(
        database.updateSource(source.id, {
          name: 'React',
          url: source.url,
          mode: 'auto',
          pageLimit: 1000,
          schedule: null,
          concurrency: null
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
      expect(database.searchDocuments('Components')[0]?.title).toBe('Learn React')
      expect(database.clearDocuments()).toBe(1)
      expect(database.listDocuments()).toEqual([])
      expect(database.searchDocuments('Components')).toEqual([])
      expect(database.listSources()[0]).toMatchObject({ pages: 0, status: 'attention' })
      expect(database.getSettings()).toEqual({
        mcpPort: 37373,
        theme: 'auto',
        httpConcurrency: 9,
        browserConcurrency: 2
      })
      expect(
        database.saveSettings({
          mcpPort: 41000,
          theme: 'dark',
          httpConcurrency: 12,
          browserConcurrency: 3
        })
      ).toEqual({
        mcpPort: 41000,
        theme: 'dark',
        httpConcurrency: 12,
        browserConcurrency: 3
      })
      expect(database.getSettings()).toEqual({
        mcpPort: 41000,
        theme: 'dark',
        httpConcurrency: 12,
        browserConcurrency: 3
      })
      database.deleteSource(source.id)
      expect(database.searchDocuments('Components')).toEqual([])
      expect(() =>
        database.saveSettings({
          mcpPort: 80,
          theme: 'auto',
          httpConcurrency: 9,
          browserConcurrency: 2
        })
      ).toThrow('MCP 端口必须是 1024 到 65535 之间的整数')
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
        fetch_mode TEXT NOT NULL, page_limit INTEGER NOT NULL, schedule TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE app_settings (
        id INTEGER PRIMARY KEY, mcp_port INTEGER NOT NULL, theme TEXT NOT NULL
      ) STRICT;
      INSERT INTO app_settings VALUES (1, 37373, 'auto');
    `)
    legacy.close()

    const database = createDatabase(filename)
    try {
      expect(database.getSettings()).toMatchObject({ httpConcurrency: 9, browserConcurrency: 2 })
      expect(
        database.createSource({
          name: 'Vue',
          url: 'https://vuejs.org',
          mode: 'auto',
          pageLimit: 1000,
          schedule: null,
          concurrency: null
        })
      ).toMatchObject({ concurrency: null, iconUrl: null })
    } finally {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
