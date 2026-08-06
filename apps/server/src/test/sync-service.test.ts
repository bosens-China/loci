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
    expect((await sync.wait(job.id))?.status).toBe('canceled')
    expect(() => database.getSnapshot(library.id)).toThrow('尚未发布')
  })
})
