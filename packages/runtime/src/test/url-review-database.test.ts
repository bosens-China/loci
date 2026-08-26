import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../database.js'
import { commitUrlReview } from '../url-review-commit.js'

function createReviewSource(database: ReturnType<typeof createDatabase>, pageLimit = 20) {
  return database.createSource({
    name: 'Example API',
    url: 'https://example.com/docs',
    mode: 'http',
    pageLimit,
    schedule: null,
    httpConcurrency: null,
    browserConcurrency: null,
    discoveryMode: 'agent_review',
    reviewGoal: '只收录 API 与组件文档'
  })
}

describe('UrlReviewDatabase', () => {
  it('同一来源复用活动运行，并以排除清单原子批准剩余 URL', () => {
    const database = createDatabase(':memory:')
    try {
      const source = createReviewSource(database)
      const first = database.startUrlReview(source.id, source.reviewGoal!, source.url)
      const duplicate = database.startUrlReview(source.id, '另一个目标', source.url)
      expect(duplicate.id).toBe(first.id)

      database.addUrlReviewCandidates(first.id, [
        { url: 'https://example.com/api', title: 'API', titleSource: 'link_text' },
        { url: 'https://example.com/blog', title: 'Blog', titleSource: 'link_text' }
      ])
      const batch = database.assignUrlReviewBatch(first.id, 50)
      expect(batch.candidates.map((item) => item.title)).toEqual(['API', 'Blog'])
      expect(
        database.submitUrlReviewBatch(first.id, batch.batchId!, ['https://example.com/blog'])
      ).toBe(true)
      expect(
        database.submitUrlReviewBatch(first.id, batch.batchId!, ['https://example.com/blog'])
      ).toBe(false)
      expect(() =>
        database.submitUrlReviewBatch(first.id, batch.batchId!, ['https://example.com/api'])
      ).toThrow()
      expect(database.listApprovedUrlReviewCandidates(first.id)).toEqual([
        expect.objectContaining({ url: 'https://example.com/api', decision: 'approved' })
      ])
      expect(database.listUrlReviewDeletedUrls(first.id)).toEqual(['https://example.com/blog'])
    } finally {
      database.close()
    }
  })

  it('取消等待中的运行后允许创建下一次审查', () => {
    const database = createDatabase(':memory:')
    try {
      const source = createReviewSource(database)
      const first = database.startUrlReview(source.id, source.reviewGoal!, source.url)
      expect(database.cancelUrlReview(first.id)).toBe(true)
      expect(database.cancelUrlReview(first.id)).toBe(false)
      expect(database.startUrlReview(source.id, source.reviewGoal!, source.url).id).not.toBe(
        first.id
      )
    } finally {
      database.close()
    }
  })

  it('取消是终态，并拒绝迟到的发现、候选完成与结束写入', () => {
    const database = createDatabase(':memory:')
    try {
      const source = createReviewSource(database)
      const run = database.startUrlReview(source.id, source.reviewGoal!, source.url)
      database.addUrlReviewCandidates(run.id, [
        {
          url: 'https://example.com/api',
          title: 'API',
          titleSource: 'link_text',
          decision: 'approved'
        }
      ])
      const [candidate] = database.listApprovedUrlReviewCandidates(run.id)
      expect(candidate).toBeDefined()
      expect(database.cancelUrlReview(run.id)).toBe(true)

      database.addUrlReviewCandidates(run.id, [
        { url: 'https://example.com/late', title: 'Late', titleSource: 'link_text' }
      ])
      database.updateUrlReviewDiscovery(run.id, 'pages', 'browser', source.url, null)
      database.completeUrlReviewCandidate(
        candidate!.id,
        {
          url: candidate!.url,
          title: candidate!.title,
          language: 'und',
          markdown: '# Late',
          crawledAt: new Date().toISOString(),
          fetchMode: 'http'
        },
        undefined,
        [{ url: 'https://example.com/nested', title: 'Nested', titleSource: 'link_text' }]
      )
      database.finishUrlReview(run.id, false)
      database.failUrlReview(run.id, 'late failure')

      expect(database.getUrlReviewSnapshot(run.id)).toMatchObject({
        run: { status: 'cancelled', discovery: 'new', fetchMode: 'auto', error: null },
        discoveredCount: 1,
        processedCount: 0
      })
      expect(database.listUrlReviewDocuments(run.id)).toEqual([])
    } finally {
      database.close()
    }
  })

  it('正文提交与审查终态在同一事务内竞争', () => {
    const database = createDatabase(':memory:')
    try {
      const source = createReviewSource(database)
      const run = database.startUrlReview(source.id, source.reviewGoal!, source.url)
      expect(database.cancelUrlReview(run.id)).toBe(true)

      expect(
        database.commitSourceCrawl(source.id, {
          documents: [
            {
              sourceId: source.id,
              url: source.url,
              title: 'Late document',
              markdown: '# Late',
              language: 'en',
              fetchMode: 'http',
              crawledAt: new Date().toISOString()
            }
          ],
          deletedUrls: [],
          replaceAll: false,
          urlReview: { runId: run.id, limitReached: false },
          resolution: {
            firstUrl: source.url,
            mode: 'http',
            iconUrl: null,
            discovery: 'pages'
          }
        })
      ).toBe(false)
      expect(database.listDocuments()).toEqual([])
      expect(database.getUrlReview(run.id)?.status).toBe('cancelled')
    } finally {
      database.close()
    }
  })

  it('不会提交 Agent 从 OpenAPI 批次排除的预生成正文', () => {
    const database = createDatabase(':memory:')
    try {
      const source = createReviewSource(database)
      const run = database.startUrlReview(source.id, source.reviewGoal!, source.url)
      database.updateUrlReviewDiscovery(run.id, 'openapi', 'http', source.url, null)
      const keptUrl = 'https://example.com/openapi/kept'
      const excludedUrl = 'https://example.com/openapi/excluded'
      database.addUrlReviewCandidates(run.id, [
        openApiCandidate(keptUrl, 'Kept'),
        openApiCandidate(excludedUrl, 'Excluded')
      ])
      const batch = database.assignUrlReviewBatch(run.id, 50)
      database.submitUrlReviewBatch(run.id, batch.batchId!, [excludedUrl])
      const approved = database.listApprovedUrlReviewCandidates(run.id)[0]!
      database.completeUrlReviewCandidate(approved.id, approved.document, undefined, [])

      expect(database.listUrlReviewDocuments(run.id)).toMatchObject([{ url: keptUrl }])
      expect(commitUrlReview(database, run, database.getSourceConfig(source.id), false)).toBe(true)
      expect(database.listDocumentUrls(source.id)).toEqual([keptUrl])
      expect(database.listSources()[0]?.resolvedDiscovery).toBe('openapi')
    } finally {
      database.close()
    }
  })

  it('达到页面上限时不提交仍待审的 OpenAPI 预生成正文', () => {
    const database = createDatabase(':memory:')
    try {
      const source = createReviewSource(database, 1)
      const run = database.startUrlReview(source.id, source.reviewGoal!, source.url)
      database.updateUrlReviewDiscovery(run.id, 'openapi', 'http', source.url, null)
      const approvedUrl = 'https://example.com/openapi/approved'
      const pendingUrl = 'https://example.com/openapi/pending'
      database.addUrlReviewCandidates(run.id, [
        openApiCandidate(approvedUrl, 'Approved'),
        openApiCandidate(pendingUrl, 'Pending')
      ])
      const batch = database.assignUrlReviewBatch(run.id, 1)
      database.submitUrlReviewBatch(run.id, batch.batchId!, [])
      const approved = database.listApprovedUrlReviewCandidates(run.id)[0]!
      database.completeUrlReviewCandidate(approved.id, approved.document, undefined, [])

      expect(commitUrlReview(database, run, database.getSourceConfig(source.id), true)).toBe(true)
      expect(database.listDocumentUrls(source.id)).toEqual([approvedUrl])
      expect(database.getUrlReview(run.id)).toMatchObject({
        status: 'completed',
        limitReached: true
      })
    } finally {
      database.close()
    }
  })

  it.each([
    ['llms', 'llms'],
    ['pages', 'pages'],
    ['sitemap', 'pages']
  ] as const)('把 %s 审查发现路径持久化为 %s', (discovery, expected) => {
    const database = createDatabase(':memory:')
    try {
      const source = createReviewSource(database)
      const run = database.startUrlReview(source.id, source.reviewGoal!, source.url)
      database.updateUrlReviewDiscovery(run.id, discovery, 'http', source.url, null)

      expect(commitUrlReview(database, run, database.getSourceConfig(source.id), false)).toBe(true)
      expect(database.listSources()[0]?.resolvedDiscovery).toBe(expected)
    } finally {
      database.close()
    }
  })

  it('不同数据库进程视角复用同一活动运行', () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-url-review-db-'))
    const filename = join(directory, 'loci.sqlite')
    const firstDatabase = createDatabase(filename)
    const source = createReviewSource(firstDatabase)
    const secondDatabase = createDatabase(filename)
    try {
      const first = firstDatabase.startUrlReview(source.id, source.reviewGoal!, source.url)
      const second = secondDatabase.startUrlReview(source.id, source.reviewGoal!, source.url)
      expect(second.id).toBe(first.id)
      firstDatabase.addUrlReviewCandidates(first.id, [
        { url: 'https://example.com/api', title: 'API', titleSource: 'link_text' }
      ])
      expect(secondDatabase.assignUrlReviewBatch(first.id, 50)).toMatchObject({
        run: { id: first.id, status: 'awaiting_review' },
        candidates: [{ url: 'https://example.com/api' }]
      })
    } finally {
      secondDatabase.close()
      firstDatabase.close()
      rmSync(directory, { recursive: true })
    }
  })
})

function openApiCandidate(url: string, title: string) {
  return {
    url,
    title,
    titleSource: 'openapi' as const,
    document: {
      url,
      title,
      language: 'und',
      markdown: `# ${title}`,
      crawledAt: new Date().toISOString(),
      fetchMode: 'http' as const
    }
  }
}
