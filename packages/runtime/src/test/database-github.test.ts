import { describe, expect, it } from 'vitest'
import { createDatabase } from '../database.js'

describe('database GitHub sources', () => {
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

      database.updateResolvedSource(
        vue.id,
        vue.url,
        'http',
        null,
        {
          defaultBranch: 'main',
          revision: 'new'
        },
        'github'
      )
      expect(database.getSourceConfig(vue.id)).toMatchObject({
        githubDefaultBranch: 'main',
        githubRevision: 'new'
      })
      expect(database.listSources()[0]?.resolvedDiscovery).toBe('github')

      expect(() =>
        database.createSource({
          ...defaults,
          kind: 'web',
          name: 'Wrong kind',
          url: 'https://github.com/vuejs/core'
        })
      ).toThrow('普通站点不能使用 GitHub 仓库首页 URL')
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
})
