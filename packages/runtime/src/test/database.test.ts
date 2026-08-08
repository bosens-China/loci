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
        mcpPort: 37373,
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
          mcpPort: 41000,
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
      expect(database.getSettings()).toEqual({
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
          serverUrl: 'http://localhost:7001',
          githubArchiveLimitMb: 200,
          githubMarkdownLimitMb: 100
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

  it('允许同一 GitHub 域名的不同仓库，并事务性替换仓库文档快照', () => {
    const database = createDatabase(':memory:')
    try {
      const defaults = {
        mode: 'auto' as const,
        pageLimit: 1000,
        scopePath: '/',
        schedule: null,
        httpConcurrency: null,
        browserConcurrency: null,
        githubArchiveLimitMb: null,
        githubMarkdownLimitMb: null
      }
      const vue = database.createSource({
        ...defaults,
        name: 'Vue Docs',
        url: 'https://github.com/vuejs/docs/tree/main/src'
      })
      database.createSource({
        ...defaults,
        name: 'Vite Docs',
        url: 'https://github.com/vitejs/vite'
      })
      expect(database.listSources()).toHaveLength(2)
      expect(vue).toMatchObject({
        url: 'https://github.com/vuejs/docs',
        kind: 'github',
        scopePath: '/'
      })
      expect(
        database.createSource({
          ...defaults,
          name: 'Duplicate',
          url: 'https://github.com/VueJS/Docs.git'
        })
      ).toMatchObject({ id: vue.id, name: 'Vue Docs' })

      database.replaceSourceDocuments(vue.id, [
        {
          sourceId: vue.id,
          title: 'old.md',
          url: 'https://github.com/vuejs/docs/blob/old/guide/old.md',
          relativePath: 'guide/old.md',
          markdown: '# Old',
          language: 'und',
          fetchMode: 'http',
          crawledAt: new Date().toISOString()
        }
      ])
      database.replaceSourceDocuments(vue.id, [
        {
          sourceId: vue.id,
          title: 'new.md',
          url: 'https://github.com/vuejs/docs/blob/new/guide/new.md',
          relativePath: 'guide/new.md',
          markdown: '# New',
          language: 'und',
          fetchMode: 'http',
          crawledAt: new Date().toISOString()
        }
      ])
      expect(database.listDocuments()).toMatchObject([{ title: 'new.md', folder: 'guide' }])
      expect(database.searchDocuments('Old')).toEqual([])

      database.updateResolvedSource(vue.id, vue.url, 'http', null, {
        defaultBranch: 'main',
        revision: 'new'
      })
      expect(database.getSourceConfig(vue.id)).toMatchObject({
        githubDefaultBranch: 'main',
        githubRevision: 'new'
      })
      const runId = database.startCrawlRun(vue.id)
      database.finishCrawlRun(
        runId,
        'completed',
        {
          queued: 1,
          processed: 1,
          succeeded: 0,
          failed: 1,
          limitReached: false,
          failures: [
            {
              url: 'https://github.com/vuejs/docs/blob/new/lfs.md',
              reason: 'git_lfs_unsupported',
              message: 'Git LFS Markdown 不受支持',
              retryable: false
            }
          ]
        },
        null
      )
      expect(database.listCrawlFailures(runId)[0]?.reason).toBe('git_lfs_unsupported')
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
