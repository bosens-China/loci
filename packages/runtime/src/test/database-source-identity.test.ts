import { describe, expect, it } from 'vitest'
import { DOCUMENT_SOURCE_DEFAULTS, DOCUMENT_SOURCE_LIMITS } from '@loci/core'
import { createDatabase } from '../database.js'

describe('document source identity', () => {
  it('在领域层统一 GitHub 模式、路径和输入边界', () => {
    const database = createDatabase(':memory:')
    try {
      const source = database.createSource({
        name: 'x'.repeat(DOCUMENT_SOURCE_LIMITS.nameLength.max),
        url: 'https://github.com/vuejs/docs/tree/main/src',
        mode: 'browser',
        pageLimit: DOCUMENT_SOURCE_LIMITS.pageLimit.max,
        scopePath: '/src',
        schedule: null,
        httpConcurrency: DOCUMENT_SOURCE_LIMITS.concurrency.max,
        browserConcurrency: DOCUMENT_SOURCE_LIMITS.concurrency.max,
        githubArchiveLimitMb: DOCUMENT_SOURCE_LIMITS.githubSizeMb.max,
        githubMarkdownLimitMb: DOCUMENT_SOURCE_LIMITS.githubSizeMb.max
      })
      expect(source).toMatchObject({
        mode: DOCUMENT_SOURCE_DEFAULTS.mode,
        scopePath: DOCUMENT_SOURCE_DEFAULTS.scopePath
      })
      expect(
        database.updateSource(source.id, {
          name: 'Vue Docs',
          url: source.url,
          mode: 'http',
          pageLimit: DOCUMENT_SOURCE_DEFAULTS.pageLimit,
          scopePath: '/other',
          schedule: null,
          httpConcurrency: null,
          browserConcurrency: null
        })
      ).toMatchObject({
        mode: DOCUMENT_SOURCE_DEFAULTS.mode,
        scopePath: DOCUMENT_SOURCE_DEFAULTS.scopePath
      })
      expect(() =>
        database.createSource({
          name: 'x'.repeat(DOCUMENT_SOURCE_LIMITS.nameLength.max + 1),
          url: 'https://example.com/docs',
          mode: DOCUMENT_SOURCE_DEFAULTS.mode,
          pageLimit: DOCUMENT_SOURCE_DEFAULTS.pageLimit,
          schedule: null,
          httpConcurrency: null,
          browserConcurrency: null
        })
      ).toThrow(`文档源名称不能超过 ${DOCUMENT_SOURCE_LIMITS.nameLength.max} 个字符`)
    } finally {
      database.close()
    }
  })

  it('同域名可按收录范围拆库，但相同范围仍保持唯一', () => {
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
      const vite = database.createSource({
        ...defaults,
        name: 'Vite',
        url: 'https://vite.dev/guide'
      })
      const viteApi = database.createSource({
        ...defaults,
        name: 'Vite API',
        url: 'https://vite.dev/api',
        scopePath: '/api'
      })
      expect(viteApi.id).not.toBe(vite.id)
      expect(
        database.createSource({
          ...defaults,
          name: 'Vite Duplicate',
          url: 'https://vite.dev/start'
        }).id
      ).toBe(vite.id)

      const vue = database.createSource({
        ...defaults,
        name: 'Vue',
        url: 'https://vuejs.org/guide'
      })
      const moved = database.updateSource(vue.id, {
        ...defaults,
        name: 'Vue on Vite',
        url: 'https://vite.dev/config',
        scopePath: '/config'
      })
      expect(moved.scopePath).toBe('/config')
      expect(() =>
        database.updateSource(vue.id, {
          ...defaults,
          name: 'Vue on Vite root',
          url: 'https://vite.dev/other'
        })
      ).toThrow('这个域名和收录范围已经存在于文档源中')
      expect(database.getSourceConfig(vue.id)).toMatchObject({
        hostname: 'vite.dev',
        scopePath: '/config'
      })
    } finally {
      database.close()
    }
  })
})
