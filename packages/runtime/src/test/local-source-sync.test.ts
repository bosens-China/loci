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
})
