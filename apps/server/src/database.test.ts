import { afterEach, describe, expect, it } from 'vitest'
import { ServerDatabase } from './database.js'

describe('ServerDatabase', () => {
  const databases: ServerDatabase[] = []

  afterEach(() => {
    databases.splice(0).forEach((database) => database.close())
  })

  it('只在文档内容变化时发布新 revision', () => {
    const database = new ServerDatabase(':memory:')
    databases.push(database)
    const library = database.createLibrary({
      name: 'Hono',
      url: 'https://hono.dev/docs',
      pageLimit: 1000,
      schedule: null
    })
    database.saveDocument(library.id, {
      title: 'Node.js',
      url: 'https://hono.dev/docs/getting-started/nodejs',
      language: 'en-US',
      markdown: '# Node.js',
      crawledAt: '2026-08-02T00:00:00.000Z',
      fetchMode: 'http'
    })

    const first = database.publishSnapshot(library.id)
    database.saveDocument(library.id, {
      title: 'Node.js',
      url: 'https://hono.dev/docs/getting-started/nodejs',
      language: 'en-US',
      markdown: '# Node.js',
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
})
