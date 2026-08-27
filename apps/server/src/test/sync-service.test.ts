import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServerDatabase } from '../database.js'
import { SyncService } from '../sync-service.js'

describe('SyncService 队列', () => {
  const cleanup: Array<() => void> = []

  afterEach(() => cleanup.splice(0).forEach((close) => close()))

  it('限制跨文档库并发并可取消排队任务', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetcher = vi.fn<typeof fetch>(async () => {
      await gate
      return new Response('', { status: 404 })
    })
    const database = new ServerDatabase(':memory:')
    const sync = new SyncService(database, fetcher, undefined, 2)
    cleanup.push(() => {
      sync.close()
      database.close()
    })
    const libraries = ['one.example.com', 'two.example.com', 'three.example.com'].map((hostname) =>
      database.createLibrary({
        name: hostname,
        url: `https://${hostname}/docs`,
        scopePath: '/docs',
        pageLimit: 10,
        schedule: null
      })
    )

    const jobs = sync.startMany(libraries.map((library) => library.id))
    await vi.waitFor(() => expect(jobs.filter((job) => job.status === 'running')).toHaveLength(2))
    expect(sync.start(libraries[0]!.id)).toBe(jobs[0])
    expect(jobs[2]?.status).toBe('queued')
    expect(sync.cancel(jobs[2]!.id)?.status).toBe('canceled')
    release()
    await Promise.all(jobs.map((job) => sync.wait(job.id)))
  })

  it('同 hostname 串行，不同 hostname 保持并发', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const database = new ServerDatabase(':memory:')
    const sync = new SyncService(
      database,
      async () => {
        await gate
        return new Response('', { status: 404 })
      },
      undefined,
      3
    )
    cleanup.push(() => {
      void sync.close()
      database.close()
    })
    const libraries = [
      ['Same A', 'https://docs.example.com/a', '/a'],
      ['Same B', 'https://docs.example.com/b', '/b'],
      ['Other', 'https://other.example.com/docs', '/docs']
    ].map(([name, url, scopePath]) =>
      database.createLibrary({
        name: name!,
        url: url!,
        scopePath: scopePath!,
        pageLimit: 10,
        schedule: null
      })
    )

    const jobs = sync.startMany(libraries.map((library) => library.id))
    await vi.waitFor(() => expect(jobs.filter((job) => job.status === 'running')).toHaveLength(2))
    expect(jobs[0]?.status).toBe('running')
    expect(jobs[1]?.status).toBe('queued')
    expect(jobs[2]?.status).toBe('running')
    release()
    await Promise.all(jobs.map((job) => sync.wait(job.id)))
  })

  it('手动启动同 hostname 的另一文档库时暂停原任务', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const database = new ServerDatabase(':memory:')
    const sync = new SyncService(database, async () => {
      await gate
      return new Response('', { status: 404 })
    })
    cleanup.push(() => {
      void sync.close()
      database.close()
    })
    const firstLibrary = database.createLibrary({
      name: 'First',
      url: 'https://same.example.com/first',
      scopePath: '/first',
      pageLimit: 10,
      schedule: null
    })
    const secondLibrary = database.createLibrary({
      name: 'Second',
      url: 'https://same.example.com/second',
      scopePath: '/second',
      pageLimit: 10,
      schedule: null
    })

    const first = sync.start(firstLibrary.id)
    await vi.waitFor(() => expect(first.status).toBe('running'))
    const second = sync.start(secondLibrary.id)

    expect(sync.getJob(first.id)?.pauseRequested).toBe(true)
    expect(second.status).toBe('queued')
    sync.cancel(first.id)
    release()
    await Promise.all([sync.wait(first.id), sync.wait(second.id)])
  })

  it('运行中的任务协作式取消后不发布快照', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const database = new ServerDatabase(':memory:')
    const sync = new SyncService(
      database,
      async () => {
        await gate
        return new Response('', { status: 404 })
      },
      undefined,
      1
    )
    cleanup.push(() => {
      sync.close()
      database.close()
    })
    const library = database.createLibrary({
      name: 'Docs',
      url: 'https://docs.example.com/start',
      scopePath: '/',
      pageLimit: 10,
      schedule: null
    })
    const job = sync.start(library.id)
    await vi.waitFor(() => expect(job.status).toBe('running'))
    expect(sync.cancel(job.id)?.status).toBe('canceling')
    release()
    await sync.wait(job.id)
    expect(() => database.getLibrary(library.id)).toThrow()
    expect(database.listDocumentUrls(library.id)).toEqual([])
  })

  it('两个 Server 实例同时启动同一文档库时复用持久任务', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-server-flight-'))
    const filename = join(directory, 'server.sqlite')
    const firstDatabase = new ServerDatabase(filename)
    const library = firstDatabase.createLibrary({
      name: 'Docs',
      url: 'https://docs.example.com/start',
      scopePath: '/',
      pageLimit: 10,
      schedule: null
    })
    const secondDatabase = new ServerDatabase(filename)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let manifestRequests = 0
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/llms.txt')) {
        manifestRequests += 1
        await gate
        return new Response('- [Guide](/guide.md)')
      }
      return new Response('# Guide', { headers: { 'content-type': 'text/markdown' } })
    })
    const first = new SyncService(firstDatabase, fetcher)
    const second = new SyncService(secondDatabase, fetcher)
    cleanup.push(() => {
      void first.close()
      void second.close()
      firstDatabase.close()
      secondDatabase.close()
      rmSync(directory, { recursive: true, force: true })
    })

    const firstJob = first.start(library.id)
    const secondJob = second.start(library.id)
    expect(secondJob.id).toBe(firstJob.id)
    release()
    await Promise.all([first.wait(firstJob.id), second.wait(secondJob.id)])
    expect(manifestRequests).toBe(1)
    expect(second.getJob(secondJob.id)?.status).toBe('completed')
  })

  it('失败任务结束后可以创建新的重试任务', async () => {
    const database = new ServerDatabase(':memory:')
    let fail = true
    const sync = new SyncService(database, async () => {
      if (fail) throw new Error('网络失败')
      return new Response('- [Guide](/guide.md)')
    })
    cleanup.push(() => {
      void sync.close()
      database.close()
    })
    const library = database.createLibrary({
      name: 'Retry',
      url: 'https://retry.example.com/start',
      scopePath: '/',
      pageLimit: 10,
      schedule: null
    })

    const failed = sync.start(library.id)
    expect((await sync.wait(failed.id))?.status).toBe('failed')
    fail = false
    const retried = sync.start(library.id)
    expect(retried.id).not.toBe(failed.id)
    expect((await sync.wait(retried.id))?.status).toBe('completed')
  })

  it('过期的跨进程租约会失败收口并允许接管', () => {
    const database = new ServerDatabase(':memory:')
    cleanup.push(() => database.close())
    const library = database.createLibrary({
      name: 'Lease',
      url: 'https://lease.example.com/start',
      scopePath: '/',
      pageLimit: 10,
      schedule: null
    })
    const expired = database.syncJobs.getOrCreate(
      library.id,
      'dead-process',
      new Date(0).toISOString()
    ).job
    const recovered = database.syncJobs.getOrCreate(
      library.id,
      'new-process',
      new Date(Date.now() + 30_000).toISOString()
    ).job

    expect(recovered.id).not.toBe(expired.id)
    expect(database.syncJobs.get(expired.id)).toMatchObject({
      status: 'failed',
      error: expect.any(String)
    })
  })

  it('另一个 Server 实例可以取消运行任务且不会提交内容', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-server-cancel-'))
    const filename = join(directory, 'server.sqlite')
    const ownerDatabase = new ServerDatabase(filename)
    const library = ownerDatabase.createLibrary({
      name: 'Cancel',
      url: 'https://cancel.example.com/start',
      scopePath: '/',
      pageLimit: 10,
      schedule: null
    })
    const remoteDatabase = new ServerDatabase(filename)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const owner = new SyncService(ownerDatabase, async () => {
      await gate
      return new Response('<main>content</main>')
    })
    const remote = new SyncService(remoteDatabase)
    cleanup.push(() => {
      void owner.close()
      void remote.close()
      ownerDatabase.close()
      remoteDatabase.close()
      rmSync(directory, { recursive: true, force: true })
    })

    const job = owner.start(library.id)
    await vi.waitFor(() => expect(owner.getJob(job.id)?.status).toBe('running'))
    expect(remote.cancel(job.id)?.status).toBe('canceling')
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    release()
    await owner.wait(job.id)
    expect(() => ownerDatabase.getLibrary(library.id)).toThrow()
    expect(ownerDatabase.listDocumentUrls(library.id)).toEqual([])
  })
})
