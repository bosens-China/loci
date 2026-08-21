import { describe, expect, it } from 'vitest'
import { createDatabase } from '../database.js'

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
      expect(database.searchDocuments('reusable missing')).toEqual([])
      expect(database.searchDocuments('reusable,missing', 'any')[0]?.title).toBe('Learn React')
      expect(database.searchDocuments('learn missing', 'fuzzy')[0]?.title).toBe('Learn React')
      expect(database.clearDocuments()).toBe(1)
      expect(database.listDocuments()).toEqual([])
      expect(database.searchDocuments('reusable')).toEqual([])
      expect(database.listSources()[0]).toMatchObject({
        pages: 0,
        contentSize: 0,
        status: 'attention'
      })
      expect(database.getSettings()).toEqual({
        theme: 'auto',
        httpConcurrency: 9,
        browserConcurrency: 5,
        maxRetries: 3,
        batchIntervalSeconds: 0,
        serverUrl: 'https://loci.xiaowo.live',
        githubArchiveLimitMb: 200,
        githubMarkdownLimitMb: 100
      })
      expect(
        database.saveSettings({
          theme: 'dark',
          httpConcurrency: 12,
          browserConcurrency: 3,
          maxRetries: 4,
          batchIntervalSeconds: 100,
          serverUrl: 'https://docs.example.com/',
          githubArchiveLimitMb: 200,
          githubMarkdownLimitMb: 100
        })
      ).toEqual({
        theme: 'dark',
        httpConcurrency: 12,
        browserConcurrency: 3,
        maxRetries: 4,
        batchIntervalSeconds: 100,
        serverUrl: 'https://docs.example.com',
        githubArchiveLimitMb: 200,
        githubMarkdownLimitMb: 100
      })
      expect(database.getSettings()).toEqual({
        theme: 'dark',
        httpConcurrency: 12,
        browserConcurrency: 3,
        maxRetries: 4,
        batchIntervalSeconds: 100,
        serverUrl: 'https://docs.example.com',
        githubArchiveLimitMb: 200,
        githubMarkdownLimitMb: 100
      })
      expect(database.getInteractionPreference('cli', 'source-create')).toBeNull()
      database.setInteractionPreference('cli', 'source-create', {
        mode: 'browser',
        pageLimit: 500
      })
      expect(database.getInteractionPreference('cli', 'source-create')).toEqual({
        mode: 'browser',
        pageLimit: 500
      })
      database.deleteSource(source.id)
      expect(database.searchDocuments('Components')).toEqual([])
      expect(() =>
        database.saveSettings({
          theme: 'auto',
          httpConcurrency: 0,
          browserConcurrency: 5,
          maxRetries: 3,
          batchIntervalSeconds: 0,
          serverUrl: 'http://localhost:7001',
          githubArchiveLimitMb: 200,
          githubMarkdownLimitMb: 100
        })
      ).toThrow('HTTP 默认并发必须是')
    } finally {
      database.close()
    }
  })
})
