import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CrawlProgress } from '@loci/core'
import { createDatabase } from '../database.js'
import { createLocalJobProgressWriter } from '../local-job-progress-writer.js'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

describe('本地任务进度写入', () => {
  it('持久化未知总量阶段和批次 checkpoint', () => {
    const root = mkdtempSync(join(tmpdir(), 'loci-job-progress-'))
    const database = createDatabase(join(root, 'loci.db'))
    cleanups.push(() => {
      database.close()
      rmSync(root, { recursive: true, force: true })
    })
    const source = database.createSource({
      name: 'OpenAPI',
      url: 'https://api.example.com/doc.html',
      mode: 'http',
      pageLimit: 100,
      schedule: null,
      httpConcurrency: null,
      browserConcurrency: null
    })
    const queued = database.enqueueSourceSync(source.id, 'ui').job
    const job = database.claimNextLocalJob('test-worker', 30_000)
    if (!job || job.id !== queued.id) throw new Error('本地任务未被测试 worker 领取')
    const writer = createLocalJobProgressWriter(database, { id: job.id, owner: 'test-worker' })
    const progress: CrawlProgress = {
      queued: 0,
      processed: 0,
      succeeded: 0,
      failed: 0,
      limitReached: false,
      node: {
        id: source.url,
        url: source.url,
        title: '正在探测 OpenAPI 规范',
        status: 'running'
      }
    }

    writer.report(progress, [], 0)
    expect(database.getLocalJob(job.id)?.result?.node?.title).toBe('正在探测 OpenAPI 规范')

    const generated = { ...progress, queued: 30, processed: 10, succeeded: 10 }
    writer.checkpoint(generated, [], 1024)
    expect(database.getLocalJob(job.id)?.result).toMatchObject({
      queued: 30,
      processed: 10,
      succeeded: 10
    })
  })
})
