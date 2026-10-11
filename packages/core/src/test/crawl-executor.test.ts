import { describe, expect, it } from 'vitest'
import { executeCrawlTasks } from '../crawl-executor.js'
import { runCrawlQueue } from '../crawl.js'

describe('Crawlee 执行边界', () => {
  it('异步写入期间并行发现的斜杠变体只保存一份相同正文', async () => {
    const saved: string[] = []
    const duplicates: string[] = []
    await runCrawlQueue({
      firstUrl: 'https://example.com/doc',
      initialUrls: ['https://example.com/doc/'],
      hostname: 'example.com',
      pageLimit: 2,
      concurrency: 2,
      fetchMode: 'http',
      fetchPage: async (url) => ({
        url,
        status: 200,
        page: { title: 'Doc', language: 'en', markdown: 'Same content', links: [] }
      }),
      onDocument: async (document) => {
        await new Promise((resolve) => setTimeout(resolve, 30))
        saved.push(document.url)
      },
      onDuplicate: ({ url }) => {
        duplicates.push(url)
      }
    })
    expect(saved).toEqual(['https://example.com/doc'])
    expect(duplicates).toEqual(['https://example.com/doc/'])
  })

  it('同一 URL 的并行运行互相隔离，重试后只记录一次终态', async () => {
    const results: string[][] = [[], []]
    const attempts = [0, 0]
    await Promise.all(
      results.map((saved, index) =>
        executeCrawlTasks({
          tasks: [{ url: 'https://example.com/docs' }],
          maxRetries: 1,
          handle: async ({ url }) => {
            attempts[index] += 1
            if (attempts[index] === 1) throw new Error('临时断网')
            saved.push(url)
          },
          onFailure: async (_task, error) => {
            throw error
          }
        })
      )
    )
    expect(results).toEqual([['https://example.com/docs'], ['https://example.com/docs']])
    expect(attempts).toEqual([2, 2])
  })

  it('取消会等待活动处理退出，检查点保留活动和未开始页面', async () => {
    const controller = new AbortController()
    const checkpoints: string[][] = []
    let entered: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    let active = false
    const running = executeCrawlTasks({
      tasks: [{ url: 'https://example.com/one' }, { url: 'https://example.com/two' }],
      concurrency: 1,
      signal: controller.signal,
      onCheckpoint: (urls) => {
        checkpoints.push(urls)
      },
      handle: async () => {
        active = true
        entered()
        try {
          await new Promise<void>((_resolve, reject) => {
            controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
              once: true
            })
          })
        } finally {
          active = false
        }
      },
      onFailure: async () => {
        throw new Error('取消不应写入页面失败')
      }
    })
    const rejected = expect(running).rejects.toThrow('取消抓取')
    await started
    controller.abort(new Error('取消抓取'))
    await rejected
    expect(active).toBe(false)
    expect(checkpoints.at(-1)).toEqual(['https://example.com/one', 'https://example.com/two'])
  })

  it('递归链接先过滤去重再严格占用页面额度，临时状态由框架重试', async () => {
    const saved: string[] = []
    let attempts = 0
    const progress = await runCrawlQueue({
      firstUrl: 'https://example.com/start',
      hostname: 'example.com',
      pageLimit: 2,
      concurrency: 2,
      fetchMode: 'http',
      maxRetries: 1,
      fetchPage: async (url) => {
        if (url.endsWith('/next') && ++attempts === 1) return { url, status: 503 }
        return {
          url,
          status: 200,
          page: {
            title: url,
            language: 'en',
            markdown: url,
            links: [
              'https://other.example/outside',
              'https://example.com/next#one',
              'https://example.com/next',
              'https://example.com/over-limit'
            ]
          }
        }
      },
      onDocument: (doc) => {
        saved.push(doc.url)
      }
    })
    expect(saved).toEqual(['https://example.com/start', 'https://example.com/next'])
    expect(progress).toMatchObject({
      queued: 2,
      processed: 2,
      succeeded: 2,
      failed: 0,
      limitReached: true
    })
    expect(attempts).toBe(2)
  })
})
