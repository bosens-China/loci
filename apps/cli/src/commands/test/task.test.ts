import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ui.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ui.js')>()),
  askSelect: vi.fn()
}))

import { createProgram } from '../../cli.js'
import { createCliRuntime } from '../../runtime.js'
import { askSelect } from '../../ui.js'

const originalDataDir = process.env.LOCI_DATA_DIR
const isTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
let dataDir = ''

beforeEach(() => {
  vi.clearAllMocks()
  dataDir = mkdtempSync(join(tmpdir(), 'loci-task-cli-'))
  process.env.LOCI_DATA_DIR = dataDir
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false })
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dataDir, { recursive: true, force: true })
  if (originalDataDir === undefined) delete process.env.LOCI_DATA_DIR
  else process.env.LOCI_DATA_DIR = originalDataDir
  if (isTtyDescriptor) Object.defineProperty(process.stdin, 'isTTY', isTtyDescriptor)
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

  it('非交互终端省略任务 ID 时明确拒绝', async () => {
    const program = createProgram()

    await expect(program.parseAsync(['task', 'status'], { from: 'user' })).rejects.toMatchObject({
      message: '非交互终端必须指定任务 ID',
      exitCode: 2
    })
    await expect(
      program.parseAsync(['task', 'follow', '--format', 'jsonl'], { from: 'user' })
    ).rejects.toMatchObject({ message: '非交互终端必须指定任务 ID', exitCode: 2 })
    await expect(program.parseAsync(['task', 'cancel'], { from: 'user' })).rejects.toMatchObject({
      message: '非交互终端必须指定任务 ID',
      exitCode: 2
    })
  })

  it('交互终端可选择任务执行状态、取消和跟随', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
    const runtime = createCliRuntime()
    const source = runtime.createSource({
      name: 'Interactive Docs',
      url: 'https://example.com/interactive',
      mode: 'http',
      pageLimit: 10,
      schedule: null,
      httpConcurrency: null,
      browserConcurrency: null
    })
    const job = runtime.database.enqueueSourceSync(source.id, 'manual').job
    await runtime.close()
    vi.mocked(askSelect).mockResolvedValue(job.id)

    const program = createProgram()
    await program.parseAsync(['task', 'status'], { from: 'user' })
    await program.parseAsync(['task', 'cancel'], { from: 'user' })
    await program.parseAsync(['task', 'follow', '--format', 'jsonl'], { from: 'user' })

    expect(askSelect).toHaveBeenCalledTimes(3)
    const verification = createCliRuntime()
    expect(verification.database.getLocalJob(job.id)).toMatchObject({
      status: 'cancelled',
      cancelRequested: true
    })
    await verification.close()
  })
})
