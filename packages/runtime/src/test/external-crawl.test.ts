import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { createLocalRuntime } from '../local-runtime.js'

describe('waitForExternalCrawl', () => {
  it('reuses a crawl run produced by another process and follows its progress', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-external-crawl-'))
    const filename = join(directory, 'loci.sqlite')
    const runtime = createLocalRuntime({ dataDir: directory, cacheDir: directory })
    const source = runtime.createSource({
      name: 'Vite',
      url: 'https://vite.dev/guide',
      mode: 'http',
      pageLimit: 10,
      scopePath: '/',
      httpConcurrency: null,
      browserConcurrency: null
    })
    const lockUrl = pathToFileURL(resolve('src/runtime-lock.ts')).href
    const script = `
      import { randomUUID } from 'node:crypto'
      import { DatabaseSync } from 'node:sqlite'
      import { acquireCrawlRuntimeLock } from ${JSON.stringify(lockUrl)}
      const database = new DatabaseSync(${JSON.stringify(filename)}, { timeout: 5000 })
      const lock = acquireCrawlRuntimeLock(${JSON.stringify(directory)}, ${JSON.stringify(source.id)}, '子进程')
      const runId = randomUUID()
      const now = new Date().toISOString()
      database.prepare("INSERT INTO crawl_runs (id, source_id, status, started_at, updated_at) VALUES (?, ?, 'running', ?, ?)").run(runId, ${JSON.stringify(source.id)}, now, now)
      const progress = { queued: 2, processed: 1, succeeded: 1, failed: 0, limitReached: false }
      database.prepare("UPDATE crawl_runs SET progress_json = ?, discovered_count = 2, success_count = 1, updated_at = ? WHERE id = ?").run(JSON.stringify(progress), now, runId)
      process.stdout.write('running\\n')
      setTimeout(() => {
        const completed = { ...progress, processed: 2, succeeded: 2 }
        const finished = new Date().toISOString()
        database.prepare("UPDATE crawl_runs SET status = 'completed', progress_json = ?, discovered_count = 2, success_count = 2, finished_at = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(completed), finished, finished, runId)
        lock.release()
        database.close()
        process.exit(0)
      }, 150)
    `
    const child = spawn(
      process.execPath,
      ['--experimental-transform-types', '--input-type=module', '--eval', script],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    try {
      let stderr = ''
      child.stderr!.setEncoding('utf8')
      child.stderr!.on('data', (chunk: string) => {
        stderr += chunk
      })
      await Promise.race([
        once(child.stdout!, 'data'),
        once(child, 'exit').then(([code]) => {
          throw new Error(`子进程在任务启动前退出（${String(code)}）：${stderr}`)
        })
      ])
      expect(runtime.getLibraryCrawlStatus(source.id)).toMatchObject({
        status: 'running',
        progress: { discovered: 2, processed: 1 }
      })
      const onProgress = vi.fn()
      const progress = await runtime.crawlSource(source.id, onProgress)
      expect(progress).toMatchObject({ processed: 2, succeeded: 2 })
      expect(runtime.listLibraryCrawlStatuses()).toMatchObject([
        {
          libraryId: source.id,
          status: 'completed',
          progress: { processed: 2 },
          finishedAt: expect.any(String)
        }
      ])
      if (child.exitCode === null) await once(child, 'exit')
    } finally {
      if (child.exitCode === null) child.kill()
      await runtime.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }, 15_000)
})
