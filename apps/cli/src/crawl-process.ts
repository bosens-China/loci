import { fork } from 'node:child_process'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import {
  acquireRuntimeLock,
  crawlRequestKey,
  readRuntimeLock,
  requestCrawlCancellation,
  RuntimeLockedError
} from '@loci/runtime'
import { withCancellation, withRuntime } from './command-runtime.js'
import { errorMessage } from './errors.js'
import type { CliRuntime } from './runtime.js'

export interface CrawlTarget {
  pages?: string[]
  additionalUrls?: string[]
}

const startupTimeout = 30_000

/** 拿到锁后再等待对应的 runId 入库。已有终态也说明该次启动成功。 */
async function observeRun(runtime: CliRuntime, id: string, runId: string, requestKey: string) {
  const deadline = Date.now() + startupTimeout
  while (true) {
    const run = runtime.database.getCrawlRun(runId)
    if (run) {
      if (run.requestKey !== requestKey)
        throw new RuntimeLockedError('文档库已有其他抓取正在运行，完成后可重新提交', null)
      return runId
    }
    if (readRuntimeLock(runtime.dataDir, `crawl-${id}`)?.crawlRunId !== runId) {
      if (runtime.database.getCrawlRun(runId)) continue
      throw new Error('抓取进程在登记运行记录前退出')
    }
    if (Date.now() >= deadline) throw new Error('等待抓取运行记录超时')
    await delay(25)
  }
}

/** 启动锁覆盖检查、派生、握手三个步骤。不同文档库使用独立的锁。 */
export async function launchCrawl(runtime: CliRuntime, id: string, target: CrawlTarget) {
  const key = `launch-${id}`
  const requestKey = target.pages
    ? crawlRequestKey('pages', target.pages)
    : crawlRequestKey('sync', target.additionalUrls)
  const previous = runtime.database.getLatestCrawlRun(id)?.id
  const active = readRuntimeLock(runtime.dataDir, `crawl-${id}`)?.crawlRunId
  if (active) return { reused: true, runId: await observeRun(runtime, id, active, requestKey) }
  const deadline = Date.now() + startupTimeout
  let lock
  while (!lock) {
    try {
      lock = acquireRuntimeLock(runtime.dataDir, key, 'CLI 启动抓取')
    } catch (error) {
      if (!(error instanceof RuntimeLockedError) || Date.now() >= deadline) throw error
      await delay(25)
    }
  }
  try {
    const holder = readRuntimeLock(runtime.dataDir, `crawl-${id}`)
    if (holder?.crawlRunId)
      return { reused: true, runId: await observeRun(runtime, id, holder.crawlRunId, requestKey) }
    const latest = runtime.database.getLatestCrawlRun(id)
    // 等待启动锁时，相同请求可能已经完成并释放抓取锁。
    if (latest?.requestKey === requestKey && latest.id !== previous)
      return { reused: true, runId: latest.id }
    return await forkCrawl(id, target)
  } finally {
    lock.release()
  }
}

function forkCrawl(id: string, target: CrawlTarget) {
  const source = fileURLToPath(import.meta.url).endsWith('.ts')
  const entry = new URL(source ? './index.ts' : './index.js', import.meta.url)
  const args = target.pages
    ? ['--pages', ...target.pages]
    : ['--additional', ...(target.additionalUrls ?? [])]
  const child = fork(entry, ['__crawl', id, ...args], {
    detached: true,
    stdio: 'ignore',
    execArgv: source ? ['--import', createRequire(import.meta.url).resolve('tsx')] : []
  })
  return new Promise<{ runId: string; reused: boolean }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('等待抓取子进程启动超时'))
    }, startupTimeout)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      reject(new Error(`抓取子进程在启动期间退出 (${signal ?? code})`))
    })
    child.once('message', (message: unknown) => {
      clearTimeout(timeout)
      if (child.connected) child.disconnect()
      if (
        message &&
        typeof message === 'object' &&
        'runId' in message &&
        typeof message.runId === 'string'
      )
        resolve({ runId: message.runId, reused: 'reused' in message && message.reused === true })
      else
        reject(
          new Error(
            message && typeof message === 'object' && 'error' in message
              ? String(message.error)
              : '抓取子进程握手失败'
          )
        )
    })
  }).finally(() => child.unref())
}

/** 子进程仅在持久化初始进度后确认，后续错误与取消均由运行时写入抓取记录。 */
export async function runCrawlWorker([id, mode, ...urls]: string[]) {
  if (!process.send || !id || (mode !== '--pages' && mode !== '--additional'))
    throw new Error('无效的抓取子进程调用')
  let sent: Promise<void> | undefined
  function notify(message: object) {
    sent ??= new Promise<void>((resolve) => {
      if (!process.connected || !process.send) return resolve()
      process.send(message, () => resolve())
    })
  }
  try {
    await withCancellation((signal) =>
      withRuntime(async (runtime) => {
        const ready = () => {
          if (!sent) notify({ runId: runtime.database.getActiveCrawlRun(id)?.id })
        }
        try {
          if (mode === '--pages') await runtime.fetchPages(id, urls, undefined, signal, ready)
          else await runtime.crawlSource(id, ready, undefined, signal, urls)
        } catch (error) {
          if (!(error instanceof RuntimeLockedError) || !error.record?.crawlRunId) throw error
          const key = crawlRequestKey(mode === '--pages' ? 'pages' : 'sync', urls)
          notify({
            reused: true,
            runId: await observeRun(runtime, id, error.record.crawlRunId, key)
          })
        }
      }, true)
    )
  } catch (error) {
    notify({ error: errorMessage(error) })
  } finally {
    await sent
  }
}

export async function cancelCrawl(runtime: CliRuntime, libraryId: string) {
  const key = `crawl-${libraryId}`
  const record = readRuntimeLock(runtime.dataDir, key)
  const runId = record?.crawlRunId
  const latest = () => runtime.getLibraryCrawlStatus(libraryId)?.status ?? 'idle'
  if (!runId) {
    const status = latest()
    if (record && status === 'running') throw new Error('此抓取由旧版进程持有，请在原终端取消')
    return { libraryId, cancelled: false, status }
  }
  await requestCrawlCancellation(runtime.dataDir, libraryId, runId)
  const cancelled = runtime.database.getCrawlRun(runId)?.cancelled === true
  return { libraryId, cancelled, status: cancelled ? 'cancelled' : latest() }
}
