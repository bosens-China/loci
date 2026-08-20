import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../database.js'

describe('shared database', () => {
  it('makes CLI writes visible to an already-open service connection', () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-shared-db-'))
    const path = join(directory, 'loci.sqlite')
    const service = createDatabase(path)
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
      expect(service.listSources()).toEqual([source])

      const runId = cli.startCrawlRun(source.id)
      cli.finishCrawlRun(
        runId,
        'completed',
        { queued: 1, processed: 1, succeeded: 1, failed: 0, limitReached: false },
        null
      )
      expect(service.listCrawlHistory(source.id)[0]).toMatchObject({
        sourceId: source.id,
        status: 'completed',
        succeeded: 1
      })
    } finally {
      cli.close()
      service.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
