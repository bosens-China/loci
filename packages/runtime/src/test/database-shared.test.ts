import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../database'

describe('shared database', () => {
  it('makes CLI writes visible to an already-open desktop connection', () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-shared-db-'))
    const path = join(directory, 'loci.sqlite')
    const desktop = createDatabase(path)
    const cli = createDatabase(path)
    try {
      const source = cli.createSource({
        name: 'React',
        url: 'https://react.dev/learn',
        mode: 'http',
        pageLimit: 10,
        schedule: null,
        httpConcurrency: null,
        browserConcurrency: null
      })
      expect(desktop.listSources()).toEqual([source])

      const runId = cli.startCrawlRun(source.id)
      cli.finishCrawlRun(runId, 'completed', { queued: 1, succeeded: 1, failed: 0 }, null)
      expect(desktop.listCrawlHistory(source.id)[0]).toMatchObject({
        sourceId: source.id,
        status: 'completed',
        succeeded: 1
      })
    } finally {
      cli.close()
      desktop.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
