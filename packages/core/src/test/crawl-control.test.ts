import { describe, expect, it, vi } from 'vitest'
import { runCrawlQueue } from '../crawl.js'

describe('抓取批次控制', () => {
  it('每批重新读取策略并记录剩余 URL', async () => {
    const policies = [
      { concurrency: 1, batchIntervalMs: 20 },
      { concurrency: 2, batchIntervalMs: 0 }
    ]
    const checkpoints: string[][] = []
    const sleep = vi.fn(async () => undefined)

    const result = await runCrawlQueue({
      firstUrl: 'https://docs.example.com/start',
      hostname: 'docs.example.com',
      pageLimit: 3,
      initialUrls: ['https://docs.example.com/one', 'https://docs.example.com/two'],
      concurrency: 9,
      fetchMode: 'http',
      fetchPage: async (url) => ({
        url,
        status: 200,
        page: { title: url, language: 'en', markdown: `# ${url}`, links: [] }
      }),
      getBatchPolicy: () => policies.shift() ?? { concurrency: 2 },
      onCheckpoint: ({ pendingUrls }) => {
        checkpoints.push(pendingUrls)
      },
      onDocument: () => undefined,
      sleep
    })

    expect(result).toMatchObject({ processed: 3, succeeded: 3 })
    expect(checkpoints).toEqual([
      ['https://docs.example.com/one', 'https://docs.example.com/two'],
      []
    ])
    expect(sleep).toHaveBeenCalledWith(20)
  })

  it('批次之间可以暂停且不会领取下一批页面', async () => {
    let batches = 0
    const fetched: string[] = []

    await expect(
      runCrawlQueue({
        firstUrl: 'https://docs.example.com/start',
        hostname: 'docs.example.com',
        pageLimit: 2,
        initialUrls: ['https://docs.example.com/next'],
        concurrency: 1,
        fetchMode: 'http',
        fetchPage: async (url) => {
          fetched.push(url)
          return {
            url,
            status: 200,
            page: { title: url, language: 'en', markdown: '# Page', links: [] }
          }
        },
        waitIfPaused: async () => {
          batches += 1
          if (batches === 2) throw new Error('任务已暂停')
        },
        onDocument: () => undefined
      })
    ).rejects.toThrow('任务已暂停')

    expect(fetched).toEqual(['https://docs.example.com/start'])
  })
})
