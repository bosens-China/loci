import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { ServerDatabase } from '../database.js'

describe('ServerDatabase', () => {
  const databases: ServerDatabase[] = []
  const directories: string[] = []

  afterEach(() => {
    databases.splice(0).forEach((database) => database.close())
    directories
      .splice(0)
      .forEach((directory) => rmSync(directory, { recursive: true, force: true }))
  })

  it('只在文档内容变化时发布新 revision', () => {
    const database = new ServerDatabase(':memory:')
    databases.push(database)
    const library = database.createLibrary({
      name: 'Hono',
      url: 'https://hono.dev/docs',
      scopePath: '/docs',
      pageLimit: 1000,
      schedule: null
    })
    database.saveDocument(library.id, {
      title: 'Node.js',
      url: 'https://hono.dev/docs/getting-started/nodejs',
      language: 'en-US',
      markdown: '# Node.js\n\n中文🙂',
      crawledAt: '2026-08-02T00:00:00.000Z',
      fetchMode: 'http'
    })

    const first = database.publishSnapshot(library.id)
    expect(database.listPublishedLibraries()[0]?.contentSize).toBe(
      Buffer.byteLength('# Node.js\n\n中文🙂')
    )
    database.saveDocument(library.id, {
      title: 'Node.js',
      url: 'https://hono.dev/docs/getting-started/nodejs',
      language: 'en-US',
      markdown: '# Node.js\n\n中文🙂',
      crawledAt: '2026-08-03T00:00:00.000Z',
      fetchMode: 'http'
    })
    const unchanged = database.publishSnapshot(library.id)

    expect(unchanged.library.revision).toBe(first.library.revision)
    expect(unchanged.library.publishedAt).toBe(first.library.publishedAt)
    expect(database.listPublishedLibraries()).toHaveLength(1)

    database.saveDocument(library.id, {
      title: 'Node.js',
      url: 'https://hono.dev/docs/getting-started/nodejs',
      language: 'en-US',
      markdown: '# Node.js\n\nUpdated',
      crawledAt: '2026-08-04T00:00:00.000Z',
      fetchMode: 'http'
    })
    expect(database.publishSnapshot(library.id).library.revision).not.toBe(first.library.revision)
  })

  it('不公开也不发布零页面文档库', () => {
    const database = new ServerDatabase(':memory:')
    databases.push(database)
    const library = database.createLibrary({
      name: '空文档库',
      url: 'https://empty.example.com/docs',
      scopePath: '/docs',
      pageLimit: 100,
      schedule: null
    })

    expect(database.listPublishedLibraries()).toEqual([])
    expect(() => database.publishSnapshot(library.id)).toThrow()
  })

  it('重复创建和删除同一文档库时保持幂等', () => {
    const database = new ServerDatabase(':memory:')
    databases.push(database)
    const input = {
      name: 'Hono',
      url: 'https://hono.dev/docs',
      scopePath: '/docs',
      pageLimit: 100,
      schedule: null
    }

    const first = database.createLibrary(input)
    const duplicate = database.createLibrary({ ...input, name: '重复请求' })

    expect(duplicate.id).toBe(first.id)
    expect(database.listLibraries()).toHaveLength(1)
    database.deleteLibrary(first.id)
    expect(() => database.deleteLibrary(first.id)).not.toThrow()
    expect(database.listLibraries()).toEqual([])
  })

  it('缩小收录范围时删除范围外文档，并允许同域名不同范围', () => {
    const database = new ServerDatabase(':memory:')
    databases.push(database)
    const library = database.createLibrary({
      name: 'Hono 全站',
      url: 'https://hono.dev/docs',
      scopePath: '/',
      pageLimit: 1000,
      schedule: null
    })
    for (const url of ['https://hono.dev/docs/start', 'https://hono.dev/blog/news']) {
      database.saveDocument(library.id, {
        title: url,
        url,
        language: 'en',
        markdown: url,
        crawledAt: '2026-08-06T00:00:00.000Z',
        fetchMode: 'http'
      })
    }
    database.updateLibrary(library.id, {
      name: library.name,
      url: library.url,
      scopePath: '/docs',
      pageLimit: library.pageLimit,
      schedule: null
    })
    expect(database.listDocumentUrls(library.id)).toEqual(['https://hono.dev/docs/start'])
    expect(() =>
      database.createLibrary({
        name: 'Hono 博客',
        url: 'https://hono.dev/blog',
        scopePath: '/blog',
        pageLimit: 100,
        schedule: null
      })
    ).not.toThrow()
  })

  it('用仓库根路径区分同一 GitHub 域名下的公开仓库', () => {
    const database = new ServerDatabase(':memory:')
    databases.push(database)
    const vue = database.createLibrary({
      name: 'Vue Docs',
      url: 'https://github.com/vuejs/docs/tree/main/src',
      scopePath: '/',
      pageLimit: 1000,
      schedule: null
    })
    const vite = database.createLibrary({
      name: 'Vite',
      url: 'https://github.com/vitejs/vite',
      scopePath: '/',
      pageLimit: 1000,
      schedule: null
    })

    expect(vue.scopePath).toBe('/vuejs/docs')
    expect(vite.scopePath).toBe('/vitejs/vite')
  })

  it('把旧版 hostname 唯一表无损迁移为默认全站范围', () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-server-migration-'))
    directories.push(directory)
    const filename = join(directory, 'server.sqlite')
    const legacy = new DatabaseSync(filename)
    legacy.exec(`
      CREATE TABLE libraries (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, first_url TEXT NOT NULL,
        hostname TEXT NOT NULL UNIQUE, page_limit INTEGER NOT NULL, schedule TEXT,
        last_crawled_at TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO libraries VALUES
        ('one', '旧文档库', 'https://example.com/docs', 'example.com', 100, NULL,
          NULL, NULL, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
    `)
    legacy.close()

    const database = new ServerDatabase(filename)
    databases.push(database)
    expect(database.getLibrary('one').scopePath).toBe('/')
    expect(
      database.createLibrary({
        name: '子路径',
        url: 'https://example.com/guide',
        scopePath: '/guide',
        pageLimit: 100,
        schedule: null
      }).scopePath
    ).toBe('/guide')
  })
})
