import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DOCUMENT_SOURCE_DEFAULTS } from '@loci/shared'
import { expect, it } from 'vitest'
import { createLocalRuntime } from '../local-runtime.js'

it('状态只列出本次运行最先记录的二十个失败页面', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'loci-failure-status-'))
  const runtime = createLocalRuntime({ dataDir: dir, cacheDir: dir })
  try {
    const source = runtime.createSource({ url: 'https://example.test' })
    const run = runtime.database.startCrawlRun(source.id)
    const failures = Array.from({ length: 24 }, (_, i) => ({
      url: `${source.url}/${i}`,
      message: `HTTP 404 at page ${i}`,
      reason: 'not_found' as const,
      retryable: false
    }))
    runtime.database.finishCrawlRun(
      run,
      'failed',
      { processed: 24, queued: 24, succeeded: 0, failed: 24, limitReached: false, failures },
      null
    )
    expect(runtime.getLibraryCrawlStatus(source.id)?.failures).toEqual(
      failures.slice(0, 20).map(({ url, message }) => ({ url, message }))
    )
    const retry = runtime.database.startCrawlRun(source.id)
    runtime.database.finishCrawlRun(
      retry,
      'completed',
      { processed: 1, queued: 1, succeeded: 1, failed: 0, limitReached: false },
      null
    )
    expect(runtime.getLibraryCrawlStatus(source.id)?.failures).toBeUndefined()
  } finally {
    await runtime.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

it('子进程中断后跨进程读取并收口僵尸记录，重启仍保留最后进度', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'loci-crawl-interrupt-'))
  const options = { dataDir: dir, cacheDir: dir }
  const runtime = createLocalRuntime(options)
  const { id } = runtime.createSource({
    ...DOCUMENT_SOURCE_DEFAULTS,
    name: 'Guide',
    url: 'https://example.test'
  })
  const script = `
    import { acquireCrawlRuntimeLock } from ${JSON.stringify(pathToFileURL(resolve('src/runtime-lock.ts')).href)}
    import { DatabaseSync } from 'node:sqlite'
    const [dir, id] = process.argv.slice(1)
    acquireCrawlRuntimeLock(dir, id, '抓取子进程')
    const db = new DatabaseSync(dir + '/loci.sqlite')
    db.prepare("INSERT INTO crawl_runs (id, source_id, status, started_at, progress_json) VALUES ('child',?,'running',?,?)").run(id, new Date().toISOString(), JSON.stringify({queued:5, processed:3, succeeded:2, failed:1, currentUrl:'https://example.test/p'}))
    process.send('ready')
    setInterval(() => {}, 10000)
  `
  const child = spawn(
    process.execPath,
    ['--experimental-transform-types', '--input-type=module', '--eval', script, dir, id],
    { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] }
  )
  const exit = once(child, 'exit')
  try {
    await Promise.race([
      once(child, 'message'),
      exit.then(() => {
        throw new Error('抓取子进程启动失败')
      })
    ])
    expect(runtime.getLibraryCrawlStatus(id)?.status).toBe('running')
    child.kill('SIGKILL')
    await exit
    const interrupted = runtime.getLibraryCrawlStatus(id)
    expect(interrupted).toMatchObject({
      runId: 'child',
      status: 'failed',
      error: expect.stringContaining('中断'),
      finishedAt: expect.any(String),
      progress: {
        discovered: 5,
        processed: 3,
        succeeded: 2,
        failed: 1,
        currentUrl: 'https://example.test/p'
      }
    })
    await runtime.close()
    const reopened = createLocalRuntime(options)
    try {
      expect(reopened.listLibraryCrawlStatuses()).toEqual([interrupted])
    } finally {
      await reopened.close()
    }
  } finally {
    child.kill('SIGKILL')
    await exit
    await runtime.close()
    rmSync(dir, { recursive: true, force: true })
  }
}, 15000)
