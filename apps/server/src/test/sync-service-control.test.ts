import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServerDatabase } from '../database.js'
import { SyncService } from '../sync-service.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})

function createLibrary(database: ServerDatabase, name: string, hostname = `${name}.example.com`) {
  return database.createLibrary({
    name,
    url: `https://${hostname}/${name}`,
    scopePath: `/${name}`,
    pageLimit: 10,
    schedule: null
  })
}

const fetchMarkdown: typeof fetch = async (input) =>
  String(input).endsWith('.txt') || String(input).endsWith('.xml')
    ? new Response('', { status: 404 })
    : new Response('# Guide', { headers: { 'content-type': 'text/markdown' } })

describe('Server 暂停与取消收尾', () => {
  it('暂停任务退出执行队列后，取消仍会清理首次同步的空库', async () => {
    const database = new ServerDatabase(':memory:')
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const sync = new SyncService(database, async (input, init) => {
      await gate
      return fetchMarkdown(input, init)
    })
    database.crawlSettings.save({ ...database.crawlSettings.get(), maxConcurrentJobs: 1 })
    cleanup.push(async () => {
      release()
      await sync.close()
      database.close()
    })
    const libraries = ['first', 'paused', 'last'].map((name) => createLibrary(database, name))
    const jobs = sync.startMany(libraries.map((library) => library.id))
    sync.pause(jobs[1]!.id)
    release()
    await vi.waitFor(() => expect(sync.getJob(jobs[2]!.id)?.status).toBe('completed'))

    sync.cancel(jobs[1]!.id)
    expect(() => database.getLibrary(libraries[1]!.id)).toThrow('文档库不存在')
    expect(() => sync.cancel(jobs[1]!.id)).not.toThrow()
  })

  it('暂停已落库但旧执行尚未退出时恢复，不会丢失重新入队请求', async () => {
    const database = new ServerDatabase(':memory:')
    let paused = false
    let jobId = ''
    const library = createLibrary(database, 'resume')
    const sync = new SyncService(database, async (input, init) => {
      await Promise.resolve()
      if (String(input) === library.url && !paused) {
        paused = true
        sync.pause(jobId)
      }
      return fetchMarkdown(input, init)
    })
    cleanup.push(async () => {
      await sync.close()
      database.close()
    })
    const releasePaused = database.syncJobs.releasePaused
    // 在持久暂停与执行收尾之间插入真实恢复请求，覆盖控制请求竞争。
    vi.spyOn(database.syncJobs, 'releasePaused').mockImplementation((id, owner) => {
      const persisted = releasePaused(id, owner)
      sync.resume(id)
      return persisted
    })
    jobId = sync.start(library.id).id

    await vi.waitFor(() => expect(sync.getJob(jobId)?.status).toBe('completed'))
    expect(database.listDocumentUrls(library.id)).toEqual([library.url])
    expect(sync.listJobs()).toHaveLength(1)
  })

  it.each([false, true])(
    '排队任务暂停后让出名额，恢复与重试复用原任务（远程控制：%s）',
    async (remote) => {
      const root = mkdtempSync(join(tmpdir(), 'loci-server-control-'))
      const filename = join(root, 'server.sqlite')
      const database = new ServerDatabase(filename)
      const remoteDatabase = new ServerDatabase(filename)
      database.crawlSettings.save({ ...database.crawlSettings.get(), maxConcurrentJobs: 1 })
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const owner = new SyncService(database, async (input, init) => {
        if (String(input).includes('first.example.com')) await gate
        return fetchMarkdown(input, init)
      })
      const other = new SyncService(remoteDatabase, fetchMarkdown)
      cleanup.push(async () => {
        release()
        await owner.close()
        await other.close()
        database.close()
        remoteDatabase.close()
        rmSync(root, { recursive: true, force: true })
      })
      const libraries = ['first', 'paused', 'last'].map((name) => createLibrary(database, name))
      const jobs = owner.startMany(libraries.map((library) => library.id))
      const controller = remote ? other : owner
      const pausedId = jobs[1]!.id
      expect(controller.pause(pausedId)?.paused).toBe(true)
      expect(controller.pause(pausedId)?.paused).toBe(true)
      release()

      await vi.waitFor(() => expect(owner.getJob(jobs[2]!.id)?.status).toBe('completed'))
      expect(owner.getJob(pausedId)).toMatchObject({ status: 'queued', paused: true })
      expect(database.listDocumentUrls(libraries[1]!.id)).toEqual([])

      expect(controller.resume(pausedId)?.id).toBe(pausedId)
      expect(controller.resume(pausedId)?.id).toBe(pausedId)
      await vi.waitFor(() => expect(owner.getJob(pausedId)?.status).toBe('completed'))
      expect(database.listDocumentUrls(libraries[1]!.id)).toEqual([libraries[1]!.url])
      expect(owner.listJobs()).toHaveLength(3)
    }
  )

  it('取消等待其他 Server 释放 hostname 的任务时正常收尾，并继续处理后续任务', async () => {
    const database = new ServerDatabase(':memory:')
    const sync = new SyncService(database, fetchMarkdown)
    cleanup.push(async () => {
      await sync.close()
      database.close()
    })
    const blockerLibrary = createLibrary(database, 'blocker', 'shared.example.com')
    const target = createLibrary(database, 'target', 'shared.example.com')
    database.saveDocument(target.id, {
      url: target.url,
      title: 'Existing',
      markdown: '# Existing',
      language: 'en',
      crawledAt: new Date().toISOString(),
      fetchMode: 'http'
    })
    const lease = new Date(Date.now() + 30_000).toISOString()
    const blocker = database.syncJobs.getOrCreate(blockerLibrary.id, 'other-server', lease).job
    database.syncJobs.markRunning(blocker.id, 'other-server', lease)
    const job = sync.start(target.id, 'scheduled')

    expect(sync.getJob(job.id)?.status).toBe('queued')
    expect(sync.cancel(job.id)?.status).toBe('canceled')
    expect(sync.cancel(job.id)?.status).toBe('canceled')
    await expect(sync.wait(job.id)).resolves.toMatchObject({ status: 'canceled' })
    expect(database.listDocumentUrls(target.id)).toEqual([target.url])

    const healthy = createLibrary(database, 'healthy')
    await expect(sync.wait(sync.start(healthy.id).id)).resolves.toMatchObject({
      status: 'completed'
    })
  })
})
