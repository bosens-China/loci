import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createDatabase } from '../database.js'
import { createLocalJobRunner } from '../local-job-runner.js'
import type { LocalRuntime } from '../local-runtime.js'
import { acquireCrawlRuntimeLock, acquireMaintenanceRuntimeLock } from '../runtime-lock.js'

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

  it('取消请求与 worker 停止并发时仍收口为 cancelled', async () => {
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
    const job = database.enqueueSourceSync(source.id, 'mcp').job

    expect(await runner.runOnce()).toBe(1)
    database.requestLocalJobCancellation(job.id)
    await runner.stop()
    expect(database.getLocalJob(job.id)?.status).toBe('cancelled')
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

  it('跨连接遇到维护锁时把任务放回队列并在维护后恢复', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-job-maintenance-'))
    const filename = join(directory, 'loci.sqlite')
    const first = createDatabase(filename)
    const source = first.createSource({
      name: 'Vite',
      url: 'https://vite.dev',
      mode: 'http',
      pageLimit: 100,
      schedule: null,
      httpConcurrency: null,
      browserConcurrency: null
    })
    const second = createDatabase(filename)
    const maintenance = acquireMaintenanceRuntimeLock(directory, 'backup')
    const result = { queued: 1, processed: 1, succeeded: 1, failed: 0, limitReached: false }
    const crawlSource = vi.fn(async () => {
      const lock = acquireCrawlRuntimeLock(directory, source.id, 'test-worker')
      lock.release()
      return result
    })
    const runtime = { database: second, crawlSource } as unknown as LocalRuntime
    const runner = createLocalJobRunner(runtime, { owner: 'test-worker' })
    const job = first.enqueueSourceSync(source.id, 'background').job

    try {
      expect(await runner.runOnce()).toBe(1)
      await vi.waitFor(() =>
        expect(first.getLocalJob(job.id)).toMatchObject({
          status: 'pending',
          error: expect.stringContaining('任务等待重试')
        })
      )

      maintenance.release()
      expect(await runner.runOnce()).toBe(1)
      await vi.waitFor(() => expect(first.getLocalJob(job.id)?.status).toBe('completed'))
      expect(crawlSource).toHaveBeenCalledTimes(2)
    } finally {
      maintenance.release()
      await runner.stop()
      first.close()
      second.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
