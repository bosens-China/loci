import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ui.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ui.js')>()),
  askSelect: vi.fn(),
  confirmAction: vi.fn(
    async (_message: string, yes: boolean | undefined, nonInteractiveMessage: string) => {
      if (yes) return true
      if (!process.stdin.isTTY) {
        throw Object.assign(new Error(nonInteractiveMessage), { exitCode: 2 })
      }
      return true
    }
  )
}))

vi.mock('../../service-manager.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../service-manager.js')>()),
  ensureLocalJobWorkerRunning: vi.fn(async () => undefined)
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

    await createProgram().parseAsync(['task', 'cancel', job.id.slice(0, 8), '--yes'], {
      from: 'user'
    })
    await createProgram().parseAsync(['task', 'cancel', job.id, '--yes'], { from: 'user' })

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

  it('支持暂停、恢复、结束、批量控制和优先级调整', async () => {
    const runtime = createCliRuntime()
    const source = runtime.createSource({
      name: 'Control Docs',
      url: 'https://control.example.com/docs',
      mode: 'http',
      pageLimit: 10,
      schedule: null,
      httpConcurrency: null,
      browserConcurrency: null
    })
    const first = runtime.database.enqueueSourceSync(source.id, 'manual').job
    await runtime.close()

    await createProgram().parseAsync(['task', 'priority', '50', first.id, '--yes'], {
      from: 'user'
    })
    await createProgram().parseAsync(['task', 'pause', first.id, '--yes'], { from: 'user' })
    await createProgram().parseAsync(['task', 'resume', first.id, '--yes'], { from: 'user' })
    await createProgram().parseAsync(['task', 'pause-all', 'control.example.com', '--yes'], {
      from: 'user'
    })
    await createProgram().parseAsync(['task', 'resume-all', 'control.example.com', '--yes'], {
      from: 'user'
    })
    await createProgram().parseAsync(['task', 'stop', first.id, '--yes'], { from: 'user' })

    const verification = createCliRuntime()
    expect(verification.database.getLocalJob(first.id)).toMatchObject({
      priority: 50,
      stopRequested: true
    })
    await verification.close()
  })

  it('非交互任务控制要求显式确认', async () => {
    const runtime = createCliRuntime()
    const source = runtime.createSource({
      name: 'Confirm Docs',
      url: 'https://confirm.example.com/docs',
      mode: 'http',
      pageLimit: 10,
      schedule: null,
      httpConcurrency: null,
      browserConcurrency: null
    })
    const job = runtime.database.enqueueSourceSync(source.id, 'manual').job
    await runtime.close()

    await expect(
      createProgram().parseAsync(['task', 'pause', job.id], { from: 'user' })
    ).rejects.toMatchObject({
      message: '非交互终端执行任务控制必须传入 --yes',
      exitCode: 2
    })
  })
})
