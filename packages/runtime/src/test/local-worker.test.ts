import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { startLocalService } from '../local-service.js'
import { readLocalServiceState } from '../local-service-state.js'
import { startLocalWorker } from '../local-worker.js'

describe('local worker', () => {
  it('不创建 HTTP 服务并在任务队列空闲后退出', async () => {
    const root = mkdtempSync(join(tmpdir(), 'loci-worker-'))
    const dataDir = join(root, 'data')
    const worker = startLocalWorker({
      dataDir,
      cacheDir: join(root, 'cache'),
      idleMs: 10,
      heartbeatMs: 10
    })
    try {
      expect(worker.state).toMatchObject({ pid: process.pid, mode: 'on-demand' })
      expect(readLocalServiceState(dataDir)).toMatchObject({ mode: 'on-demand' })
      expect('http' in worker).toBe(false)
      await worker.runUntilIdle()
    } finally {
      await worker.close()
      expect(readLocalServiceState(dataDir)).toBeNull()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('Web 会话关闭时不取消已经运行的 worker 任务', async () => {
    const root = mkdtempSync(join(tmpdir(), 'loci-worker-web-'))
    const dataDir = join(root, 'data')
    const cacheDir = join(root, 'cache')
    const worker = startLocalWorker({ dataDir, cacheDir, idleMs: 10 })
    const source = worker.runtime.createSource({
      name: 'Docs',
      url: 'https://example.com/docs',
      mode: 'http',
      pageLimit: 1,
      scopePath: '/',
      schedule: null,
      httpConcurrency: null,
      browserConcurrency: null,
      githubArchiveLimitMb: null,
      githubMarkdownLimitMb: null
    })
    let finish = (): void => undefined
    const crawl = vi.spyOn(worker.runtime, 'crawlSource').mockImplementation(
      () =>
        new Promise((resolvePromise) => {
          finish = () =>
            resolvePromise({
              queued: 1,
              processed: 1,
              succeeded: 1,
              failed: 0,
              limitReached: false
            })
        })
    )
    const job = worker.runtime.database.enqueueSourceSync(source.id, 'ui').job
    const task = worker.runUntilIdle()
    await vi.waitFor(() =>
      expect(worker.runtime.database.getLocalJob(job.id)?.status).toBe('running')
    )

    const web = await startLocalService({ dataDir, cacheDir })
    await web.close()
    expect(crawl).toHaveBeenCalledOnce()
    expect(worker.runtime.database.getLocalJob(job.id)?.status).toBe('running')

    finish()
    await task
    expect(worker.runtime.database.getLocalJob(job.id)?.status).toBe('completed')
    await worker.close()
    rmSync(root, { recursive: true, force: true })
  })
})
