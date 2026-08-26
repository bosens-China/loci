import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalJobRunner } from '../local-job-runner.js'
import { createLocalRuntime } from '../local-runtime.js'

const directories: string[] = []

afterEach(() => {
  vi.unstubAllGlobals()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Agent Review 已收录页面刷新', () => {
  it('逐页写入持久任务事件', async () => {
    const fetchedUrls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : String(input)
        fetchedUrls.push(url)
        return new Response(`<html><title>${url}</title><main><h1>${url}</h1></main></html>`)
      })
    )
    const directory = mkdtempSync(join(tmpdir(), 'loci-reviewed-progress-'))
    directories.push(directory)
    const runtime = createLocalRuntime({ dataDir: directory, cacheDir: join(directory, 'cache') })
    const runner = createLocalJobRunner(runtime, { owner: 'reviewed-progress-test' })
    try {
      const source = runtime.createSource({
        name: 'Docs',
        url: 'https://docs.example.com/one',
        mode: 'http',
        pageLimit: 10,
        schedule: null,
        httpConcurrency: 1,
        browserConcurrency: null,
        discoveryMode: 'agent_review',
        reviewGoal: '只收录参考文档'
      })
      for (const url of ['https://docs.example.com/one', 'https://docs.example.com/two']) {
        runtime.database.saveDocument({
          sourceId: source.id,
          url,
          title: url,
          markdown: '# old',
          language: 'en',
          fetchMode: 'http',
          crawledAt: '2026-01-01T00:00:00.000Z'
        })
      }
      runtime.database.registerExplicitPageTargets(source.id, [
        'https://docs.example.com/one',
        'https://docs.example.com/target-only'
      ])

      const { job } = runtime.database.enqueueSourceSync(source.id, 'manual')
      expect(await runner.runOnce()).toBe(1)
      await vi.waitFor(() => expect(runtime.database.getLocalJob(job.id)?.status).toBe('completed'))

      const events = runtime.database.listLocalJobEvents(job.id)
      const expectedUrls = [
        'https://docs.example.com/one',
        'https://docs.example.com/target-only',
        'https://docs.example.com/two'
      ]
      expect(events.map((event) => event.node.url).sort()).toEqual(expectedUrls)
      expect([...fetchedUrls].sort()).toEqual(expectedUrls)
      expect(events.at(-1)?.progress).toMatchObject({
        queued: 3,
        processed: 3,
        succeeded: 3,
        failed: 0
      })
      expect(runtime.database.listExplicitPageTargets(source.id)).toMatchObject([
        { url: 'https://docs.example.com/one', status: 'current' },
        { url: 'https://docs.example.com/target-only', status: 'current' }
      ])
    } finally {
      await runner.stop()
      await runtime.close()
    }
  })
})
