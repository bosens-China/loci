import { describe, expect, it } from 'vitest'
import { runCrawlQueue } from '../crawl.js'

describe('抓取任务控制', () => {
  it('检查点包含所有尚未完成的页面并逐页收敛', async () => {
    const checkpoints: string[][] = []

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
      onCheckpoint: ({ pendingUrls }) => {
        checkpoints.push(pendingUrls)
      },
      onDocument: () => undefined
    })

    expect(result).toMatchObject({ processed: 3, succeeded: 3 })
    expect(checkpoints).toEqual([
      [
        'https://docs.example.com/start',
        'https://docs.example.com/one',
        'https://docs.example.com/two'
      ],
      ['https://docs.example.com/one', 'https://docs.example.com/two'],
      ['https://docs.example.com/two'],
      []
    ])
  })

  it('暂停后不再执行下一个页面', async () => {
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
