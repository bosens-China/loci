import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProgram } from '../../cli.js'
import { createCliRuntime } from '../../runtime.js'
import { formatBatchIntervalHint } from '../config.js'

const originalDataDir = process.env.LOCI_DATA_DIR
let dataDir = ''

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'loci-config-dx-'))
  process.env.LOCI_DATA_DIR = dataDir
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
  if (originalDataDir === undefined) delete process.env.LOCI_DATA_DIR
  else process.env.LOCI_DATA_DIR = originalDataDir
})

describe('CLI 共享设置', () => {
  it('保存显式提供的设置值', async () => {
    await createProgram().parseAsync(['config', 'set', 'max-retries', '4'], { from: 'user' })

    const runtime = createCliRuntime()
    expect(runtime.database.getSettings().maxRetries).toBe(4)
    await runtime.close()
  })

  it('把批次秒数解释成人类可读时间', () => {
    expect(formatBatchIntervalHint('0')).toContain('不额外等待')
    expect(formatBatchIntervalHint('120')).toContain('约 2 分钟')
    expect(formatBatchIntervalHint('50')).toContain('100 到 3000')
  })
})
