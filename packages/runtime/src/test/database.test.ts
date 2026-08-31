import { describe, expect, it } from 'vitest'
import { createDatabase } from '../database.js'

describe('createDatabase', () => {
  it('OpenAPI 完整快照会删除本次未生成的旧文档', () => {
    const database = createDatabase(':memory:')
    try {
      const source = database.createSource({
        name: '接口文档',
        url: 'https://api.example.com/doc.html',
        mode: 'auto',
        pageLimit: 10,
        schedule: null,
        httpConcurrency: null,
        browserConcurrency: null
      })
      database.saveDocument({
        sourceId: source.id,
        url: 'https://api.example.com/v3/api-docs/all#old',
        title: 'a.md',
        markdown: '# 已删除接口',
        language: 'und',
        fetchMode: 'http',
        relativePath: 'all/a.md',
        crawledAt: '2026-08-30T00:00:00.000Z'
      })

      expect(
        database.commitSourceCrawl(source.id, {
          documents: [
            {
              sourceId: source.id,
              url: 'https://api.example.com/v3/api-docs/all#current',
              title: '当前接口',
              markdown: '# 当前接口',
              language: 'und',
              fetchMode: 'http',
              relativePath: 'all/当前接口.md',
              crawledAt: '2026-08-31T00:00:00.000Z'
            }
          ],
          deletedUrls: [],
          replaceAll: true,
          resolution: {
            firstUrl: source.url,
            mode: 'http',
            iconUrl: null,
            discovery: 'openapi'
          }
        })
      ).toBe(true)

      expect(database.listDocuments()).toMatchObject([
        { title: '当前接口', relativePath: 'all/当前接口.md' }
      ])
      expect(database.searchDocuments('已删除接口')).toEqual([])
      expect(database.listSources()[0]?.pages).toBe(1)
    } finally {
      database.close()
    }
  })

  it('OpenAPI 新快照写入失败时回滚并保留旧文档', () => {
    const database = createDatabase(':memory:')
    try {
      const source = database.createSource({
        name: '接口文档',
        url: 'https://api.example.com/doc.html',
        mode: 'auto',
        pageLimit: 10,
        schedule: null,
        httpConcurrency: null,
        browserConcurrency: null
      })
      database.saveDocument({
        sourceId: source.id,
        url: 'https://api.example.com/v3/api-docs/all#old',
        title: '旧接口',
        markdown: '# 旧接口',
        language: 'und',
        fetchMode: 'http',
        relativePath: 'all/旧接口.md',
        crawledAt: '2026-08-30T00:00:00.000Z'
      })
      const duplicatePathDocuments = ['first', 'second'].map((name) => ({
        sourceId: source.id,
        url: `https://api.example.com/v3/api-docs/all#${name}`,
        title: name,
        markdown: `# ${name}`,
        language: 'und',
        fetchMode: 'http' as const,
        relativePath: 'all/重复.md',
        crawledAt: '2026-08-31T00:00:00.000Z'
      }))

      expect(() =>
        database.commitSourceCrawl(source.id, {
          documents: duplicatePathDocuments,
          deletedUrls: [],
          replaceAll: true,
          resolution: {
            firstUrl: source.url,
            mode: 'http',
            iconUrl: null,
            discovery: 'openapi'
          }
        })
      ).toThrow()
      expect(database.listDocuments()).toMatchObject([
        { title: '旧接口', relativePath: 'all/旧接口.md' }
      ])
    } finally {
      database.close()
    }
  })

  it('模糊搜索多个关键词时始终限制在指定来源', () => {
    const database = createDatabase(':memory:')
    try {
      const createSource = (name: string, url: string) =>
        database.createSource({
          name,
          url,
          mode: 'http',
          pageLimit: 10,
          schedule: null,
          httpConcurrency: null,
          browserConcurrency: null
        })
      const first = createSource('First', 'https://first.example.com')
      const second = createSource('Second', 'https://second.example.com')
      for (const [sourceId, url, title] of [
        [first.id, 'https://first.example.com/alpha', 'alpha'],
        [second.id, 'https://second.example.com/beta', 'beta']
      ]) {
        database.saveDocument({
          sourceId,
          url,
          title,
          markdown: '# body',
          language: 'en',
          fetchMode: 'http',
          crawledAt: '2026-08-22T00:00:00.000Z'
        })
      }

      expect(database.searchDocumentSummaries('alpha beta', second.id, 'fuzzy')).toMatchObject([
        { sourceId: second.id, title: 'beta' }
      ])
    } finally {
      database.close()
    }
  })

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
        'https://docs.react.dev/favicon.ico',
        undefined,
        'llms'
      )
      expect(database.getSourceConfig(source.id)).toMatchObject({
        firstUrl: 'https://docs.react.dev/learn',
        hostname: 'docs.react.dev',
        fetchMode: 'http'
      })
      expect(database.listSources()[0]?.resolvedDiscovery).toBe('llms')
      expect(database.listDocuments()).toHaveLength(1)
      expect(database.listDocumentSummaries(source.id)).toEqual([
        expect.objectContaining({ id: expect.any(String), title: 'Learn React' })
      ])
      expect(database.listDocumentSummaries(source.id)[0]).not.toHaveProperty('content')
      expect(database.getDocument(database.listDocumentSummaries(source.id)[0]!.id)?.content).toBe(
        markdown
      )
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
        batchIntervalMaxSeconds: 0,
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
          batchIntervalMaxSeconds: 300,
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
        batchIntervalMaxSeconds: 300,
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
        batchIntervalMaxSeconds: 300,
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
          batchIntervalMaxSeconds: 0,
          serverUrl: 'http://localhost:7001',
          githubArchiveLimitMb: 200,
          githubMarkdownLimitMb: 100
        })
      ).toThrow()
    } finally {
      database.close()
    }
  })
})
