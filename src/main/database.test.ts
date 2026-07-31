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
        pageLimit: 1000
      })
      expect(source.url).toBe('https://react.dev/learn')
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
      expect(database.listSources()[0]).toMatchObject({ pages: 1 })
      expect(database.listDocumentUrls(source.id)).toEqual([source.url])
      database.updateResolvedSource(source.id, 'https://docs.react.dev/learn?from=redirect', 'http')
      expect(database.getSourceConfig(source.id)).toMatchObject({
        firstUrl: 'https://docs.react.dev/learn',
        hostname: 'docs.react.dev',
        fetchMode: 'http'
      })
      expect(database.listDocuments()).toHaveLength(1)
      expect(database.searchDocuments('Components')[0]?.title).toBe('Learn React')
    } finally {
      database.close()
    }
  })
})
