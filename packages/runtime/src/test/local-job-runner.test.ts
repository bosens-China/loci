import { describe, expect, it, vi } from 'vitest'
import { createDatabase } from '../database.js'
import { createLocalJobRunner } from '../local-job-runner.js'
import type { LocalRuntime } from '../local-runtime.js'

describe('local job runner', () => {
  it('执行持久任务并复用同一资源的重复提交', async () => {
    const database = createDatabase(':memory:')
    const source = database.createSource({
      name: 'Vite',
      url: 'https://vite.dev',
      mode: 'http',
      pageLimit: 100,
      schedule: null,
      httpConcurrency: null,
      browserConcurrency: null
    })
    const crawlSource = vi.fn().mockResolvedValue({})
    const runtime = { database, crawlSource } as unknown as LocalRuntime
    const runner = createLocalJobRunner(runtime, { owner: 'test-worker', pollIntervalMs: 10_000 })

    try {
      const first = database.enqueueSourceSync(source.id, 'ui')
      const second = database.enqueueSourceSync(source.id, 'mcp')
      expect(second).toMatchObject({ reused: true, job: { id: first.job.id } })

      expect(await runner.runOnce()).toBe(1)
      await vi.waitFor(() => expect(database.getLocalJob(first.job.id)?.status).toBe('completed'))
      expect(crawlSource).toHaveBeenCalledTimes(1)
    } finally {
      await runner.stop()
      database.close()
    }
  })

  it('停止时把未完成任务释放回队列', async () => {
    const database = createDatabase(':memory:')
    const source = database.createSource({
      name: 'Vite',
      url: 'https://vite.dev',
      mode: 'http',
      pageLimit: 100,
      schedule: null,
      httpConcurrency: null,
      browserConcurrency: null
    })
    const crawlSource = vi.fn(
      (_id: string, _progress: unknown, _missing: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const runtime = { database, crawlSource } as unknown as LocalRuntime
    const runner = createLocalJobRunner(runtime, { owner: 'test-worker' })
    const job = database.enqueueSourceSync(source.id, 'background').job

    expect(await runner.runOnce()).toBe(1)
    await runner.stop()
    expect(database.getLocalJob(job.id)?.status).toBe('pending')
    database.close()
  })

  it('轮询时立即把持久取消请求传给运行中的抓取', async () => {
    const database = createDatabase(':memory:')
    const source = database.createSource({
      name: 'Vite',
      url: 'https://vite.dev',
      mode: 'http',
      pageLimit: 100,
      schedule: null,
      httpConcurrency: null,
      browserConcurrency: null
    })
    const crawlSource = vi.fn(
      (_id: string, _progress: unknown, _missing: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const runtime = { database, crawlSource } as unknown as LocalRuntime
    const runner = createLocalJobRunner(runtime, { owner: 'test-worker', pollIntervalMs: 10_000 })
    const job = database.enqueueSourceSync(source.id, 'ui').job

    expect(await runner.runOnce()).toBe(1)
    database.requestLocalJobCancellation(job.id)
    expect(await runner.runOnce()).toBe(0)
    await vi.waitFor(() => expect(database.getLocalJob(job.id)?.status).toBe('cancelled'))
    await runner.stop()
    database.close()
  })

  it('维护窗口停止认领新任务，完成后恢复执行', async () => {
    const database = createDatabase(':memory:')
    const source = database.createSource({
      name: 'Vite',
      url: 'https://vite.dev',
      mode: 'http',
      pageLimit: 100,
      schedule: null,
      httpConcurrency: null,
      browserConcurrency: null
    })
    const crawlSource = vi.fn().mockResolvedValue({})
    const runtime = { database, crawlSource } as unknown as LocalRuntime
    const runner = createLocalJobRunner(runtime, { owner: 'test-worker' })
    database.enqueueSourceSync(source.id, 'ui')
    let finishMaintenance: () => void = () => undefined
    const maintenance = runner.runMaintenance(
      () => new Promise<void>((resolve) => (finishMaintenance = resolve))
    )

    expect(await runner.runOnce()).toBe(0)
    finishMaintenance()
    await maintenance
    expect(await runner.runOnce()).toBe(1)
    await vi.waitFor(() => expect(crawlSource).toHaveBeenCalledOnce())
    await runner.stop()
    database.close()
  })

  it('存在运行中任务时拒绝进入维护窗口', async () => {
    const database = createDatabase(':memory:')
    const source = database.createSource({
      name: 'Vite',
      url: 'https://vite.dev',
      mode: 'http',
      pageLimit: 100,
      schedule: null,
      httpConcurrency: null,
      browserConcurrency: null
    })
    let finishCrawl: () => void = () => undefined
    const crawlSource = vi.fn(() => new Promise<void>((resolve) => (finishCrawl = resolve)))
    const runtime = { database, crawlSource } as unknown as LocalRuntime
    const runner = createLocalJobRunner(runtime, { owner: 'test-worker' })
    database.enqueueSourceSync(source.id, 'ui')

    expect(await runner.runOnce()).toBe(1)
    await expect(runner.runMaintenance(() => undefined)).rejects.toThrow('仍有同步任务正在执行')
    finishCrawl()
    await vi.waitFor(() => expect(runner.activeCount()).toBe(0))
    await runner.stop()
    database.close()
  })
})
