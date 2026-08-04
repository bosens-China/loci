import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProgram } from '../../cli.js'
import { CliError } from '../../errors.js'
import { createCliRuntime } from '../../runtime.js'

const originalDataDir = process.env.LOCI_DATA_DIR
let dataDir = ''

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'loci-source-defaults-'))
  process.env.LOCI_DATA_DIR = dataDir
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dataDir, { recursive: true, force: true })
  if (originalDataDir === undefined) delete process.env.LOCI_DATA_DIR
  else process.env.LOCI_DATA_DIR = originalDataDir
})

describe('文档源最短输入', () => {
  it('只提供 URL 时采用共享名称和抓取默认值', async () => {
    await createProgram().parseAsync(
      ['source', 'add', 'https://rspress.rs/guide/introduction.html'],
      {
        from: 'user'
      }
    )

    const runtime = createCliRuntime()
    const source = runtime.database.listSources()[0]
    await runtime.close()
    expect(source).toMatchObject({
      name: 'rspress',
      url: 'https://rspress.rs/guide/introduction.html',
      mode: 'auto',
      pageLimit: 1000,
      scopePath: '/',
      httpConcurrency: null,
      browserConcurrency: null
    })
  })

  it('部分更新保留没有显式提供的字段', async () => {
    const isTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
    try {
      await createProgram().parseAsync(
        ['source', 'add', 'https://rspress.rs/guide/introduction.html'],
        { from: 'user' }
      )
      await createProgram().parseAsync(['source', 'update', 'rspress', '--page-limit', '300'], {
        from: 'user'
      })
    } finally {
      if (isTTYDescriptor) Object.defineProperty(process.stdin, 'isTTY', isTTYDescriptor)
      else Reflect.deleteProperty(process.stdin, 'isTTY')
    }

    const runtime = createCliRuntime()
    const source = runtime.database.listSources()[0]
    await runtime.close()
    expect(source).toMatchObject({
      name: 'rspress',
      url: 'https://rspress.rs/guide/introduction.html',
      mode: 'auto',
      pageLimit: 300,
      scopePath: '/'
    })
  })

  it('非交互环境不接受没有修改项的空更新', async () => {
    await createProgram().parseAsync(
      ['source', 'add', 'https://rspress.rs/guide/introduction.html'],
      {
        from: 'user'
      }
    )

    const error = await createProgram()
      .parseAsync(['source', 'update', 'rspress'], { from: 'user' })
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(CliError)
    expect((error as CliError).message).toContain('至少提供一个')
  })
})
