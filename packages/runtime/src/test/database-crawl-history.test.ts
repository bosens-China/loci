import { describe, expect, it } from 'vitest'
import { createDatabase } from '../database.js'

describe('database crawl history', () => {
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
