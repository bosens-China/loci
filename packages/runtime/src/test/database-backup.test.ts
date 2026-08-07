import { describe, expect, it } from 'vitest'
import { createDatabase } from '../database.js'

describe('database backup', () => {
  it('validates and restores all searchable data', () => {
    const sourceDatabase = createDatabase(':memory:')
    const targetDatabase = createDatabase(':memory:')
    try {
      const source = sourceDatabase.createSource({
        name: 'React',
        url: 'https://react.dev/learn',
        mode: 'http',
        pageLimit: 500,
        scopePath: '/learn',
        schedule: null,
        httpConcurrency: 4,
        browserConcurrency: 2
      })
      sourceDatabase.saveDocument({
        sourceId: source.id,
        url: source.url,
        title: 'Learn React',
        markdown: '# Components',
        language: 'en',
        fetchMode: 'http',
        crawledAt: new Date().toISOString()
      })
      sourceDatabase.saveSettings({
        mcpPort: 41000,
        theme: 'dark',
        httpConcurrency: 12,
        browserConcurrency: 3,
        maxRetries: 4,
        batchIntervalSeconds: 100,
        serverUrl: 'https://docs.example.com',
        githubArchiveLimitMb: 200,
        githubMarkdownLimitMb: 100
      })
      const runId = sourceDatabase.startCrawlRun(source.id)
      sourceDatabase.finishCrawlRun(
        runId,
        'completed',
        {
          queued: 2,
          processed: 2,
          succeeded: 1,
          failed: 1,
          limitReached: false,
          failures: [
            {
              url: 'https://react.dev/missing',
              reason: 'http_error',
              message: 'Service Unavailable',
              retryable: true,
              statusCode: 503
            }
          ]
        },
        null
      )
      targetDatabase.createSource({
        name: 'Existing',
        url: 'https://example.com',
        mode: 'auto',
        pageLimit: 10,
        schedule: null,
        httpConcurrency: null,
        browserConcurrency: null
      })

      const backup = sourceDatabase.exportBackup()
      const invalid = structuredClone(backup)
      invalid.data.documents[0]!.source_id = 'missing-source'
      expect(() => targetDatabase.importBackup(invalid)).toThrow('引用的文档源不存在')
      expect(targetDatabase.listSources()[0]?.name).toBe('Existing')

      expect(targetDatabase.importBackup(backup)).toEqual({ sources: 1, documents: 1 })
      expect(targetDatabase.listSources()[0]).toMatchObject({
        name: 'React',
        pages: 1,
        httpConcurrency: 4,
        browserConcurrency: 2,
        scopePath: '/learn'
      })
      expect(targetDatabase.searchDocuments('Components')[0]?.title).toBe('Learn React')
      expect(targetDatabase.getSettings()).toMatchObject({
        mcpPort: 41000,
        theme: 'dark',
        maxRetries: 4,
        batchIntervalSeconds: 100
      })
      expect(targetDatabase.listCrawlFailures(runId)).toMatchObject([
        { runId, reason: 'http_error', statusCode: 503, retryable: true }
      ])
    } finally {
      sourceDatabase.close()
      targetDatabase.close()
    }
  })

  it('rolls back if validated rows violate a database constraint', () => {
    const sourceDatabase = createDatabase(':memory:')
    const targetDatabase = createDatabase(':memory:')
    try {
      const source = sourceDatabase.createSource({
        name: 'Source',
        url: 'https://example.com',
        mode: 'http',
        pageLimit: 10,
        schedule: null,
        httpConcurrency: null,
        browserConcurrency: null
      })
      sourceDatabase.saveDocument({
        sourceId: source.id,
        url: source.url,
        title: 'Page',
        markdown: 'Content',
        language: 'en',
        fetchMode: 'http',
        crawledAt: new Date().toISOString()
      })
      targetDatabase.createSource({
        name: 'Existing',
        url: 'https://existing.example.com',
        mode: 'auto',
        pageLimit: 10,
        schedule: null,
        httpConcurrency: null,
        browserConcurrency: null
      })

      const backup = sourceDatabase.exportBackup()
      const duplicate = structuredClone(backup.data.documents[0]!)
      duplicate.id = 'another-id'
      backup.data.documents.push(duplicate)

      expect(() => targetDatabase.importBackup(backup)).toThrow()
      expect(targetDatabase.listSources()[0]?.name).toBe('Existing')
    } finally {
      sourceDatabase.close()
      targetDatabase.close()
    }
  })
})
