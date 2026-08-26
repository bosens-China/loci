import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createDatabase } from '../database.js'
import { createLocalJobRunner } from '../local-job-runner.js'
import type { LocalRuntime } from '../local-runtime.js'
import { runDurableSourceSync } from '../local-source-sync.js'

describe('持久同步等待', () => {
  it('从另一个数据库连接读取 worker 保存的最终结果', async () => {
    const root = mkdtempSync(join(tmpdir(), 'loci-source-sync-'))
    const filename = join(root, 'loci.sqlite')
    const workerDatabase = createDatabase(filename)
    const source = workerDatabase.createSource({
      name: 'Vite',
      url: 'https://vite.dev',
      mode: 'http',
      pageLimit: 10,
      schedule: null,
      httpConcurrency: null,
      browserConcurrency: null
    })
    const callerDatabase = createDatabase(filename)
    const progress = {
      queued: 1,
      processed: 1,
      succeeded: 1,
      failed: 0,
      limitReached: false
    }
    const worker = {
      database: workerDatabase,
      crawlSource: vi.fn().mockResolvedValue(progress)
    } as unknown as LocalRuntime
    const caller = {
      database: callerDatabase,
      getCrawlState: () => undefined
    } as unknown as LocalRuntime
    const runner = createLocalJobRunner(worker, { owner: 'other-process' })

    try {
      const task = runDurableSourceSync(caller, source.id, 'mcp')
      expect(await runner.runOnce()).toBe(1)
      await expect(task).resolves.toEqual(progress)
      expect(callerDatabase.listLocalJobs()[0]).toMatchObject({
        status: 'completed',
        result: progress
      })
    } finally {
      await runner.stop()
      callerDatabase.close()
      workerDatabase.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('跨连接逐页读取 worker 保存的全部完成事件', async () => {
    const root = mkdtempSync(join(tmpdir(), 'loci-source-events-'))
    const filename = join(root, 'loci.sqlite')
    const workerDatabase = createDatabase(filename)
    const source = createSource(workerDatabase)
    const callerDatabase = createDatabase(filename)
    const pages = Array.from({ length: 501 }, (_, index) =>
      pageProgress(`https://vite.dev/page-${index + 1}`, `Page ${index + 1}`, index + 1, 501)
    )
    const worker = {
      database: workerDatabase,
      crawlSource: vi.fn(async (_id, onProgress: (progress: (typeof pages)[number]) => void) => {
        for (const progress of pages) onProgress(progress)
        return pages.at(-1)!
      })
    } as unknown as LocalRuntime
    const caller = { database: callerDatabase } as unknown as LocalRuntime
    const runner = createLocalJobRunner(worker, { owner: 'other-process' })
    const received: string[] = []

    try {
      const task = runDurableSourceSync(caller, source.id, 'mcp', (progress) => {
        if (progress.node) received.push(progress.node.title)
      })
      expect(await runner.runOnce()).toBe(1)
      await expect(task).resolves.toMatchObject({ processed: 501 })
      expect(received).toHaveLength(501)
      expect(received.at(0)).toBe('Page 1')
      expect(received.at(-1)).toBe('Page 501')
    } finally {
      await runner.stop()
      callerDatabase.close()
      workerDatabase.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('请求取消只停止本次调用拥有的任务', async () => {
    const database = createDatabase(':memory:')
    const source = createSource(database)
    const runtime = { database } as unknown as LocalRuntime
    const ownedController = new AbortController()
    const owned = runDurableSourceSync(runtime, source.id, 'mcp', undefined, ownedController.signal)
    const ownedJob = database.listLocalJobs()[0]!
    const ownedCancellation = new Error()
    ownedController.abort(ownedCancellation)
    await expect(owned).rejects.toBe(ownedCancellation)
    expect(database.getLocalJob(ownedJob.id)).toMatchObject({
      status: 'cancelled',
      cancelRequested: true
    })

    const existing = database.enqueueSourceSync(source.id, 'background').job
    const followerController = new AbortController()
    const follower = runDurableSourceSync(
      runtime,
      source.id,
      'mcp',
      undefined,
      followerController.signal
    )
    const followerCancellation = new Error()
    followerController.abort(followerCancellation)
    await expect(follower).rejects.toBe(followerCancellation)
    expect(database.getLocalJob(existing.id)).toMatchObject({
      status: 'pending',
      cancelRequested: false
    })
    database.close()
  })
})

function createSource(database: ReturnType<typeof createDatabase>) {
  return database.createSource({
    name: 'Vite',
    url: 'https://vite.dev',
    mode: 'http',
    pageLimit: 10,
    schedule: null,
    httpConcurrency: null,
    browserConcurrency: null
  })
}

function pageProgress(url: string, title: string, processed: number, queued: number) {
  return {
    queued,
    processed,
    succeeded: processed,
    failed: 0,
    limitReached: false,
    node: { id: url, url, title, status: 'success' as const }
  }
}
