import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProgram } from '../../cli.js'
import { createCliRuntime } from '../../runtime.js'

const originalDataDir = process.env.LOCI_DATA_DIR
let dataDir = ''

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'loci-task-cli-'))
  process.env.LOCI_DATA_DIR = dataDir
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dataDir, { recursive: true, force: true })
  if (originalDataDir === undefined) delete process.env.LOCI_DATA_DIR
  else process.env.LOCI_DATA_DIR = originalDataDir
})

describe('本地任务命令', () => {
  it('可以用短 ID 查询并幂等取消 pending 任务', async () => {
    const runtime = createCliRuntime()
    const source = runtime.createSource({
      name: 'Docs',
      url: 'https://example.com/docs',
      mode: 'http',
      pageLimit: 10,
      schedule: null,
      httpConcurrency: null,
      browserConcurrency: null
    })
    const job = runtime.database.enqueueSourceSync(source.id, 'manual').job
    await runtime.close()

    await createProgram().parseAsync(['task', 'cancel', job.id.slice(0, 8)], { from: 'user' })
    await createProgram().parseAsync(['task', 'cancel', job.id], { from: 'user' })

    const verification = createCliRuntime()
    expect(verification.database.getLocalJob(job.id)).toMatchObject({
      status: 'cancelled',
      cancelRequested: true
    })
    await verification.close()
  })
})
