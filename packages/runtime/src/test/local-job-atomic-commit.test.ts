import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { afterEach, describe, expect, it } from 'vitest'
import { createDatabase, type LociDatabase, type SourceCrawlCommit } from '../database.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('local job atomic commit', () => {
  it('拒绝异源任务、异源运行和已结束运行', () => {
    const database = createDatabase(':memory:')
    try {
      const firstSourceId = createSource(database, 'Vite', 'https://vite.dev')
      const secondSourceId = createSource(database, 'React', 'https://react.dev')
      const job = database.enqueueSourceSync(firstSourceId, 'background').job
      expect(database.claimNextLocalJob('worker-a', 30_000)?.id).toBe(job.id)
      const firstRunId = database.startCrawlRun(firstSourceId)
      const secondRunId = database.startCrawlRun(secondSourceId)

      expect(
        database.commitSourceCrawl(
          firstSourceId,
          sourceCommit(firstSourceId, job.id, secondRunId, 'worker-a')
        )
      ).toBe(false)
      expect(
        database.commitSourceCrawl(
          secondSourceId,
          sourceCommit(secondSourceId, job.id, secondRunId, 'worker-a')
        )
      ).toBe(false)

      database.finishCrawlRun(firstRunId, 'failed', undefined, '测试收口')
      expect(
        database.commitSourceCrawl(
          firstSourceId,
          sourceCommit(firstSourceId, job.id, firstRunId, 'worker-a')
        )
      ).toBe(false)
      expect(database.listDocuments()).toEqual([])
      expect(database.getLocalJob(job.id)?.status).toBe('running')
      expect(database.getCrawlRun(firstRunId)?.status).toBe('failed')
      expect(database.getCrawlRun(secondRunId)?.status).toBe('running')
    } finally {
      database.close()
    }
  })

  it('抓取运行重复收口保持第一次终态', () => {
    const database = createDatabase(':memory:')
    try {
      const sourceId = createSource(database, 'Vite', 'https://vite.dev')
      const runId = database.startCrawlRun(sourceId)
      database.finishCrawlRun(
        runId,
        'completed',
        {
          queued: 2,
          processed: 2,
          succeeded: 1,
          failed: 1,
          limitReached: false,
          failures: [
            {
              url: 'https://vite.dev/missing',
              reason: 'http_error',
              message: 'Not Found',
              retryable: false,
              statusCode: 404
            }
          ]
        },
        null
      )

      database.finishCrawlRun(runId, 'failed', crawlProgress, '重复收口')
      database.finishCrawlRun('missing-run', 'failed', undefined, '不存在')
      expect(database.getCrawlRun(runId)).toMatchObject({
        status: 'completed',
        progress: { processed: 2, succeeded: 1, failed: 1 },
        error: null
      })
      expect(database.listCrawlFailures(runId)).toEqual([
        expect.objectContaining({ url: 'https://vite.dev/missing', statusCode: 404 })
      ])
    } finally {
      database.close()
    }
  })

  it('重复 commit 和 complete 不覆写成功终态', () => {
    const database = createDatabase(':memory:')
    try {
      const sourceId = createSource(database, 'Vite', 'https://vite.dev')
      const job = database.enqueueSourceSync(sourceId, 'background').job
      expect(database.claimNextLocalJob('worker-a', 30_000)?.id).toBe(job.id)
      const runId = database.startCrawlRun(sourceId)
      const commit = sourceCommit(sourceId, job.id, runId, 'worker-a')

      expect(database.commitSourceCrawl(sourceId, commit)).toBe(true)
      expect(database.commitSourceCrawl(sourceId, commit)).toBe(false)
      expect(database.completeLocalJob(job.id, 'worker-a', crawlProgress)).toBe(false)
      expect(database.listDocumentUrls(sourceId)).toEqual(['https://vite.dev/guide'])
      expect(database.getCrawlRun(runId)?.status).toBe('completed')
      expect(database.getLocalJob(job.id)).toMatchObject({
        status: 'completed',
        result: { processed: 1, succeeded: 1 }
      })
    } finally {
      database.close()
    }
  })

  it('两个连接同时取消与提交时只保留获胜事务的终态', async () => {
    const { database, filename, sourceId } = createFileDatabase()
    const job = database.enqueueSourceSync(sourceId, 'background').job
    expect(database.claimNextLocalJob('worker-a', 30_000)?.id).toBe(job.id)
    const runId = database.startCrawlRun(sourceId)
    const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
    const barrierView = new Int32Array(barrier)
    const worker = new Worker(cancellationWorker, {
      eval: true,
      workerData: { barrier, filename, jobId: job.id }
    })

    try {
      expect(await nextWorkerMessage(worker)).toEqual({ type: 'ready' })
      const cancellation = nextWorkerMessage(worker)
      Atomics.store(barrierView, 0, 1)
      Atomics.notify(barrierView, 0)
      const committed = database.commitSourceCrawl(
        sourceId,
        sourceCommit(sourceId, job.id, runId, 'worker-a')
      )
      const message = await cancellation
      expect(message.type).toBe('done')

      if (committed) {
        expect(message).toEqual({ type: 'done', changes: 0 })
        expect(database.listDocumentUrls(sourceId)).toEqual(['https://vite.dev/guide'])
        expect(database.getCrawlRun(runId)?.status).toBe('completed')
        expect(database.getLocalJob(job.id)).toMatchObject({
          status: 'completed',
          cancelRequested: false,
          result: { processed: 1, succeeded: 1 }
        })
      } else {
        expect(message).toEqual({ type: 'done', changes: 1 })
        expect(database.listDocuments()).toEqual([])
        expect(database.getCrawlRun(runId)?.status).toBe('running')
        expect(database.getLocalJob(job.id)).toMatchObject({
          status: 'running',
          cancelRequested: true,
          result: null
        })
      }
    } finally {
      await worker.terminate()
      database.close()
    }
  })
})

const crawlProgress = {
  queued: 1,
  processed: 1,
  succeeded: 1,
  failed: 0,
  limitReached: false
}

function createFileDatabase(): { database: LociDatabase; filename: string; sourceId: string } {
  const directory = mkdtempSync(join(tmpdir(), 'loci-job-atomic-'))
  directories.push(directory)
  const filename = join(directory, 'loci.sqlite')
  const database = createDatabase(filename)
  const sourceId = createSource(database, 'Vite', 'https://vite.dev')
  return { database, filename, sourceId }
}

function createSource(database: LociDatabase, name: string, url: string): string {
  return database.createSource({
    name,
    url,
    mode: 'http',
    pageLimit: 100,
    schedule: null,
    httpConcurrency: null,
    browserConcurrency: null
  }).id
}

function sourceCommit(
  sourceId: string,
  jobId: string,
  runId: string,
  owner: string
): SourceCrawlCommit {
  return {
    documents: [
      {
        sourceId,
        url: 'https://vite.dev/guide',
        title: 'Guide',
        markdown: '# Guide',
        language: 'en',
        fetchMode: 'http',
        crawledAt: '2026-08-25T00:00:00.000Z'
      }
    ],
    deletedUrls: [],
    replaceAll: false,
    localJob: { id: jobId, owner, runId, result: crawlProgress },
    resolution: {
      firstUrl: 'https://vite.dev',
      mode: 'http',
      iconUrl: null,
      discovery: 'pages'
    }
  }
}

interface WorkerMessage {
  type: 'ready' | 'done' | 'error'
  changes?: number
  message?: string
}

function nextWorkerMessage(worker: Worker): Promise<WorkerMessage> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      worker.off('message', handleMessage)
      worker.off('error', handleError)
    }
    const handleMessage = (message: unknown): void => {
      cleanup()
      resolve(message as WorkerMessage)
    }
    const handleError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    worker.once('message', handleMessage)
    worker.once('error', handleError)
  })
}

const cancellationWorker = `
  const { DatabaseSync } = require('node:sqlite')
  const { parentPort, workerData } = require('node:worker_threads')
  const barrier = new Int32Array(workerData.barrier)
  const database = new DatabaseSync(workerData.filename, { timeout: 5000 })
  database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
  parentPort.postMessage({ type: 'ready' })
  Atomics.wait(barrier, 0, 0)
  try {
    const now = new Date().toISOString()
    const result = database.prepare(
      "UPDATE local_jobs SET cancel_requested = 1, " +
      "status = CASE WHEN status = 'pending' THEN 'cancelled' ELSE status END, " +
      "finished_at = CASE WHEN status = 'pending' THEN ? ELSE finished_at END, " +
      "error_message = CASE WHEN status = 'pending' THEN '任务已取消' ELSE NULL END, " +
      "result_json = NULL, updated_at = ? " +
      "WHERE id = ? AND status IN ('pending', 'running')"
    ).run(now, now, workerData.jobId)
    parentPort.postMessage({ type: 'done', changes: Number(result.changes) })
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error)
    })
  } finally {
    database.close()
  }
`
