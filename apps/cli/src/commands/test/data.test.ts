import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProgram } from '../../cli.js'
import { createCliRuntime } from '../../runtime.js'

let directory = ''
const originalDataDir = process.env.LOCI_DATA_DIR

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'loci-cli-data-'))
  process.env.LOCI_DATA_DIR = join(directory, 'data')
})

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.LOCI_DATA_DIR
  else process.env.LOCI_DATA_DIR = originalDataDir
  rmSync(directory, { recursive: true, force: true })
})

describe('CLI 数据备份', () => {
  it('非交互清理明确要求传入 --yes', async () => {
    await expect(
      createProgram().parseAsync(['data', 'clear-documents'], { from: 'user' })
    ).rejects.toThrow('非交互终端请传入 --yes')
  })

  it('导出后可在新的运行时恢复文档源和正文', async () => {
    const backup = join(directory, 'backup.json')
    const sourceRuntime = createCliRuntime()
    const source = sourceRuntime.createSource({
      name: 'Scheduled docs',
      url: 'https://example.com/docs',
      mode: 'auto',
      pageLimit: 1000,
      schedule: '0 2 * * *',
      httpConcurrency: null,
      browserConcurrency: null
    })
    sourceRuntime.database.saveDocument({
      sourceId: source.id,
      url: 'https://example.com/docs/guide',
      title: 'Guide',
      markdown: '# Guide',
      language: 'en',
      fetchMode: 'http',
      crawledAt: '2026-08-25T00:00:00.000Z'
    })
    await sourceRuntime.close()

    await createProgram().parseAsync(['data', 'export', backup], { from: 'user' })

    process.env.LOCI_DATA_DIR = join(directory, 'restored-data')
    const ensureService = vi.fn(async () => undefined)

    await createProgram({ ensureUserService: ensureService }).parseAsync(
      ['data', 'import', backup, '--yes'],
      { from: 'user' }
    )

    expect(ensureService).toHaveBeenCalledOnce()
    const restoredRuntime = createCliRuntime()
    const restoredSource = restoredRuntime.database.listSources()[0]
    expect(restoredSource).toMatchObject({
      name: 'Scheduled docs',
      url: 'https://example.com/docs',
      schedule: '0 2 * * *'
    })
    expect(restoredRuntime.database.listDocuments()).toMatchObject([
      {
        sourceId: source.id,
        url: 'https://example.com/docs/guide',
        title: 'Guide',
        content: '# Guide'
      }
    ])
    await restoredRuntime.close()
  })
})
