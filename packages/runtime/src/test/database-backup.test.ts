import { describe, expect, it } from 'vitest'
import { createBackupArchive } from '../database-backup-archive.js'
import { createDatabase } from '../database.js'

describe('database backup', () => {
  it('uses a checksummed ZIP index and restores the split archive', async () => {
    const sourceDatabase = createDatabase(':memory:')
    const targetDatabase = createDatabase(':memory:')
    try {
      sourceDatabase.createSource({
        name: 'ZIP Docs',
        category: '新分类',
        version: 'v1.2',
        url: 'https://zip.example.com/docs',
        mode: 'http',
        pageLimit: 10,
        httpConcurrency: null,
        browserConcurrency: null
      })
      sourceDatabase.deleteCategory('前端')
      sourceDatabase.createCategory('空分类')
      const archive = await sourceDatabase.exportBackupArchive()
      expect(archive.subarray(0, 2).toString()).toBe('PK')
      expect(await targetDatabase.importBackupArchive(archive, { replaceAll: true })).toMatchObject(
        {
          mode: 'replace',
          sources: 1,
          documents: 0
        }
      )
      expect(targetDatabase.listSources()[0]).toMatchObject({
        name: 'ZIP Docs',
        category: '新分类',
        version: 'v1.2'
      })
      expect(targetDatabase.listCategories()).toEqual(sourceDatabase.listCategories())

      const corrupted = archive.subarray(0, archive.length - 20)
      await expect(targetDatabase.importBackupArchive(corrupted)).rejects.toThrow()
    } finally {
      sourceDatabase.close()
      targetDatabase.close()
    }
  })

  it('validates and restores all searchable data', async () => {
    const sourceDatabase = createDatabase(':memory:')
    const targetDatabase = createDatabase(':memory:')
    try {
      const source = sourceDatabase.createSource({
        name: 'React',
        url: 'https://react.dev/learn',
        mode: 'http',
        pageLimit: 500,
        scopePath: '/learn',
        excludePathPattern: '^/learn/legacy(?:/|$)',
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
      sourceDatabase.updateResolvedSource(source.id, source.url, 'http', null, undefined, 'pages')
      sourceDatabase.saveSettings({
        theme: 'dark',
        httpConcurrency: 12,
        browserConcurrency: 3,
        maxRetries: 4,
        batchIntervalSeconds: 100,
        batchIntervalMaxSeconds: 300,
        githubArchiveLimitMb: 200,
        githubMarkdownLimitMb: 100
      })
      sourceDatabase.saveHostnameCrawlPolicy({
        hostname: 'react.dev',
        httpConcurrency: 2,
        browserConcurrency: null,
        batchIntervalMinSeconds: 100,
        batchIntervalMaxSeconds: 300
      })
      const runId = sourceDatabase.startCrawlRun(source.id, 'pages')
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
        httpConcurrency: null,
        browserConcurrency: null
      })

      const backup = sourceDatabase.exportBackup()
      delete backup.data.categories
      delete backup.data.sources[0]!.category
      delete backup.data.sources[0]!.version
      delete backup.data.documents[0]!.manual
      Object.assign(backup.data.settings!, {
        mcp_port: 41000,
        server_url: 'https://legacy.example'
      })
      Object.assign(backup.data.sources[0]!, {
        discovery_mode: 'agent_review',
        review_goal: '旧审查目标',
        schedule: '0 1 * * *'
      })
      Object.assign(backup.data, { operationLogs: [] })
      const invalid = structuredClone(backup)
      invalid.data.documents[0]!.source_id = 'missing-source'
      expect(() => targetDatabase.importBackup(invalid)).toThrow()
      const invalidRegex = structuredClone(backup)
      invalidRegex.data.sources[0]!.exclude_path_pattern = '['
      expect(() => targetDatabase.importBackup(invalidRegex)).toThrow()
      const invalidInterval = structuredClone(backup)
      invalidInterval.data.settings!.batch_interval_seconds = 300
      invalidInterval.data.settings!.batch_interval_max_seconds = 100
      expect(() => targetDatabase.importBackup(invalidInterval)).toThrow()
      expect(targetDatabase.listSources()[0]?.name).toBe('Existing')

      targetDatabase.deleteCategory('前端')
      expect(
        await targetDatabase.importBackupArchive(await createBackupArchive(backup, 20), {
          replaceAll: true
        })
      ).toMatchObject({ mode: 'replace', sources: 1, documents: 1 })
      expect(targetDatabase.listSources()).toHaveLength(1)
      expect(targetDatabase.listCategories().map((row) => row.name)).toContain('前端')
      expect(targetDatabase.listSources()[0]).toMatchObject({
        name: 'React',
        pages: 1,
        category: '未分类',
        version: 'latest',
        httpConcurrency: 4,
        browserConcurrency: 2,
        scopePath: '/learn',
        excludePathPattern: '^/learn/legacy(?:/|$)',
        resolvedDiscovery: 'pages'
      })
      expect(targetDatabase.searchDocuments('Components')[0]?.title).toBe('Learn React')
      expect(targetDatabase.getSettings()).toMatchObject({
        theme: 'dark',
        maxRetries: 4,
        batchIntervalSeconds: 100
      })
      expect(targetDatabase.listHostnameCrawlPolicies()).toMatchObject([
        {
          hostname: 'react.dev',
          httpConcurrency: 2,
          batchIntervalMinSeconds: 100,
          batchIntervalMaxSeconds: 300
        }
      ])
      expect(targetDatabase.getCrawlRun(runId)).toEqual(sourceDatabase.getCrawlRun(runId))
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
        url: source.url,
        mode: 'auto',
        pageLimit: 10,
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
