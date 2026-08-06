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

  it('在数据库层阻止本地文档源更新为重复 hostname', () => {
    const database = createDatabase(':memory:')
    try {
      const defaults = {
        mode: 'http' as const,
        pageLimit: 10,
        scopePath: '/',
        schedule: null,
        httpConcurrency: null,
        browserConcurrency: null
      }
      database.createSource({ ...defaults, name: 'Vite', url: 'https://vite.dev/guide' })
      const vue = database.createSource({
        ...defaults,
        name: 'Vue',
        url: 'https://vuejs.org/guide'
      })

      expect(() =>
        database.updateSource(vue.id, {
          ...defaults,
          name: 'Vue on Vite',
          url: 'https://vite.dev/api'
        })
      ).toThrow('这个域名已经存在于文档源中')
      expect(database.getSourceConfig(vue.id).hostname).toBe('vuejs.org')
    } finally {
      database.close()
    }
  })

  it('持久化抓取记录的文档源名称和页面失败明细', () => {
    const database = createDatabase(':memory:')
    try {
      const source = database.createSource({
        name: 'Docs',
        url: 'https://docs.example.com',
        mode: 'http',
        pageLimit: 10,
        schedule: null,
        httpConcurrency: null,
        browserConcurrency: null
      })
      const runId = database.startCrawlRun(source.id)
      database.finishCrawlRun(
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
              url: 'https://docs.example.com/missing',
              reason: 'http_error',
              message: 'Service Unavailable',
              retryable: true,
              statusCode: 503
            }
          ]
        },
        null
      )
      expect(database.listCrawlHistory(source.id)[0]).toMatchObject({
        sourceName: 'Docs',
        failed: 1
      })
      expect(database.listCrawlFailures(runId)).toEqual([
        {
          runId,
          url: 'https://docs.example.com/missing',
          reason: 'http_error',
          message: 'Service Unavailable',
          retryable: true,
          statusCode: 503
        }
      ])
    } finally {
      database.close()
    }
  })
})
