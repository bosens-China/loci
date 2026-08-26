import { describe, expect, it, vi } from 'vitest'
import type { CrawlRunState } from '@loci/shared'
import { createDatabase } from '../database.js'
import { createLocalJobRunner } from '../local-job-runner.js'
import { createLocalMcpServices } from '../local-mcp-services.js'
import type { LocalRuntime } from '../local-runtime.js'

describe('后台服务 MCP', () => {
  it('把 MCP 同步提交到持久队列并等待同一个 worker', async () => {
    const database = createDatabase(':memory:')
    const source = database.createSource({
      name: 'Vite',
      url: 'https://vite.dev',
      mode: 'http',
      pageLimit: 10,
      schedule: null,
      httpConcurrency: null,
      browserConcurrency: null
    })
    let state: CrawlRunState | undefined
    const progress = {
      queued: 1,
      processed: 1,
      succeeded: 1,
      failed: 0,
      limitReached: false
    }
    const crawlSource = vi.fn(async () => {
      state = {
        sourceId: source.id,
        progress,
        nodes: [],
        error: null,
        running: false,
        paused: false
      }
      return progress
    })
    const runtime = {
      database,
      crawlSource,
      isCrawling: () => false,
      getCrawlState: () => state,
      urlReviews: {
        start: vi.fn(),
        submit: vi.fn(),
        get: vi.fn(),
        getActive: vi.fn(),
        cancel: vi.fn()
      },
      createSource: vi.fn(),
      deleteSource: vi.fn()
    } as unknown as LocalRuntime
    const services = createLocalMcpServices(runtime, { durableJobs: true })
    const runner = createLocalJobRunner(runtime, { owner: 'mcp-worker', pollIntervalMs: 10_000 })

    const task = services.crawlSource(source.id)
    expect(services.isCrawling(source.id)).toBe(true)
    expect(await runner.runOnce()).toBe(1)
    await expect(task).resolves.toEqual(progress)
    expect(crawlSource).toHaveBeenCalledOnce()
    await runner.stop()
    database.close()
  })
})
