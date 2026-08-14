import { describe, expect, it } from 'vitest'
import { createDatabase } from '../database.js'

describe('database source filters', () => {
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

  it('保存排除路径正则并立即删除命中文档', () => {
    const database = createDatabase(':memory:')
    try {
      const source = database.createSource({
        name: 'Docs',
        url: 'https://docs.example.com/guide/start',
        mode: 'http',
        pageLimit: 100,
        scopePath: '/',
        excludePathPattern: null,
        schedule: null,
        httpConcurrency: null,
        browserConcurrency: null
      })
      for (const url of [
        'https://docs.example.com/guide/start',
        'https://docs.example.com/zh/guide'
      ]) {
        database.saveDocument({
          sourceId: source.id,
          url,
          title: url,
          markdown: url,
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
        scopePath: source.scopePath,
        excludePathPattern: '^/zh(?:/|$)',
        schedule: null,
        httpConcurrency: null,
        browserConcurrency: null
      })

      expect(updated).toMatchObject({ excludePathPattern: '^/zh(?:/|$)', pages: 1 })
      expect(database.getSourceConfig(source.id).excludePathPattern).toBe('^/zh(?:/|$)')
      expect(database.listDocumentUrls(source.id)).toEqual(['https://docs.example.com/guide/start'])
      expect(database.searchDocuments('zh')).toEqual([])
    } finally {
      database.close()
    }
  })

  it('拒绝无效正则和会排除入口的规则', () => {
    const database = createDatabase(':memory:')
    try {
      const defaults = {
        name: 'Docs',
        url: 'https://docs.example.com/guide/start',
        mode: 'http' as const,
        pageLimit: 100,
        schedule: null,
        httpConcurrency: null,
        browserConcurrency: null
      }
      expect(() => database.createSource({ ...defaults, excludePathPattern: '[' })).toThrow(
        '格式无效'
      )
      expect(() =>
        database.createSource({ ...defaults, excludePathPattern: '^/guide(?:/|$)' })
      ).toThrow('起始页面不能')
    } finally {
      database.close()
    }
  })
})
